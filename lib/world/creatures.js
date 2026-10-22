import { db } from "sdk";
import { creatures } from "schema";
import { generateNarration } from "lib/ai/aiClient";
import { resolveSkillCheck } from "lib/core/skillCheck";
import { SKILL_ABILITY_MAP, abilityModifier } from "lib/core/dndData";
import { rollD20 } from "lib/core/dice";
import { degreeFor } from "lib/core/degrees";
import { parseJson, toIndex } from "lib/core/utils";

// ---------- نقش‌های کلی NPC (فهرست بسته) ----------

export const ROLE_MENU = ["guard", "commoner", "merchant", "cleric"];

export const ROLE_LABELS = {
  guard: "نگهبان",
  commoner: "مردم عادی",
  merchant: "تاجر",
  cleric: "مقام دینی یا جادوگر",
};

export function buildRoleMenuText() {
  const lines = ROLE_MENU.map((k, i) => `${i + 1}) ${ROLE_LABELS[k]}`).join(
    "\n",
  );
  return `فهرست نقش حریف (اگه این دور تقابل رودررو با یک شخصیت غیرقابل‌بازی لازمه، شماره‌ی نزدیک‌ترین نقش رو بده؛ در غیر این صورت این فیلد رو ننویس):\n${lines}`;
}

// ---------- سطح توانایی‌های NPC (فهرست بسته، AI هر بار انتخاب می‌کنه) ----------

const ABILITY_ORDER = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
const ABILITY_LABELS_FA = ["قدرت", "چابکی", "سرسختی", "هوش", "خرد", "کاریزما"];
const LEVEL_LABELS = ["ضعیف", "متوسط", "خوب", "عالی", "استثنایی"];

// هر پله‌ی سطح ۲ نمره اضافه می‌کنه؛ هر سطح‌خطر مکان (tier) هم پایه رو ۲ نمره بالا می‌بره
function scoreFor(tier, levelIndex) {
  return 8 + 2 * levelIndex + 2 * ((tier || 1) - 1);
}

// همه‌ی موجودات این نسخه به یک اندازه در مهارت‌هاشون مهارت دارن (بدون تمایز نقش)
export const PROFICIENCY_BY_TIER = { 1: 2, 2: 2, 3: 3, 4: 3 };

function buildAbilityMenuText() {
  const lines = LEVEL_LABELS.map((l, i) => `${i + 1}) ${l}`).join("\n");
  return `فهرست سطح توانایی (برای هر کدوم از این ۶ توانایی به همین ترتیب یک عدد بده: ${ABILITY_LABELS_FA.join("، ")}):\n${lines}`;
}

// خروجی: { levels: [شش عدد ۰ تا ۴] , problems, fatal }
// اگه طول آرایه درست نبود fatal (نیاز به دوباره‌پرسی)؛ اگه فقط یکی‌دو تا عدد نامعتبر بود، همون‌ها متوسط می‌شن.
function validateCreatureDraft(data) {
  const problems = [];
  const raw = data?.abilities;
  if (!Array.isArray(raw) || raw.length !== 6) {
    return {
      levels: null,
      problems: ["abilities باید آرایه‌ای با دقیقاً ۶ عدد باشد"],
      fatal: true,
    };
  }
  const levels = raw.map((v, i) => {
    const idx = toIndex(v, LEVEL_LABELS.length);
    if (idx < 0) {
      problems.push(`سطح توانایی شماره ${i + 1} در فهرست نیست`);
      return 1; // پیش‌فرض: متوسط
    }
    return idx;
  });
  return { levels, problems, fatal: false };
}

async function generateCreatureLevels(role, tier, contextText, forceProvider) {
  let note = "";
  let best = null;
  const menu = buildAbilityMenuText();

  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      const raw = await generateNarration(
        "creature_builder",
        [
          {
            role: "user",
            content: `${contextText}\n\n${menu}${note}\n\nبرای نقش «${ROLE_LABELS[role]}» در این مکان (سطح خطر ${tier}) آمار بساز.`,
          },
        ],
        forceProvider,
        { temperature: 0.6, jsonMode: true },
      );
      result = validateCreatureDraft(parseJson(raw));
    } catch (err) {
      console.warn("⚠️  Creature: خروجی AI معتبر نبود:", err.message);
      result = {
        levels: null,
        problems: ["خروجی JSON معتبر نبود"],
        fatal: true,
      };
    }

    if (!result.fatal) {
      if (!best || result.problems.length === 0) best = result;
      if (result.problems.length === 0) break;
    }
    note = `\n\nپاسخ قبلی تو مشکل داشت: ${result.problems.join("؛ ")}. دوباره جواب بده و فقط از شماره‌های موجود در فهرست استفاده کن.`;
  }

  // اگه AI هیچ‌وقت جواب معتبر نداد، یک NPC متوسط می‌سازیم تا تقابل بدون تاس نمونه
  return best ? best.levels : [1, 1, 1, 1, 1, 1];
}

// اگه skill بازیکن یکی از این‌هاست، حریف با مهارت مقابلش (نه همون مهارت) مقاومت می‌کنه
const CONTEST_MAP = {
  Deception: "Insight",
  Persuasion: "Insight",
  Intimidation: "Insight",
  Stealth: "Perception",
  "Sleight of Hand": "Perception",
};

// ---------- تقابل رودررو ----------
// چک بازیکن (با resolveContestedCheck) در برابر یک NPC که هر بار تازه ساخته میشه.
// تاس و آمار NPC هیچ‌وقت به بازیکن نشون داده نمیشه؛ فقط توی لاگ می‌مونه.
export async function rollContest({
  character,
  skill,
  role,
  tier,
  chatId,
  locationId,
  contextText,
  forceProvider,
  mode = "normal",
  levelsCache = null,
}) {
  // در یک دور، چند تقابل با «همان نقش» (مثلاً چند نفر در برابر همان نگهبان) فقط یک
  // بار AI صدا می‌زنن؛ بقیه از levelsCache می‌خونن (صرفه‌جویی در توکن و زمان)
  let levels = levelsCache?.get(role);
  if (!levels) {
    levels = await generateCreatureLevels(
      role,
      tier,
      contextText,
      forceProvider,
    );
    levelsCache?.set(role, levels);
  }
  const abilities = ABILITY_ORDER.reduce((acc, key, i) => {
    acc[key] = scoreFor(tier, levels[i]);
    return acc;
  }, {});
  const profBonus = PROFICIENCY_BY_TIER[tier] || 2;

  const oppSkill = CONTEST_MAP[skill] || skill;
  const oppAbility = SKILL_ABILITY_MAP[oppSkill] || "WIS";
  const oppMod = abilityModifier(abilities[oppAbility]);
  const oppRoll = rollD20();
  const npcModifier = oppMod + profBonus;
  const npcTotal = oppRoll + npcModifier;

  const r = resolveSkillCheck(character, skill, 0, mode); // dc اینجا استفاده نمیشه، فقط تاس خود بازیکن رو می‌گیریم
  const margin = r.total - npcTotal;
  const degree = degreeFor(margin);

  console.log(
    `🎭 NPC (${ROLE_LABELS[role]}, سطح ${tier}) | ${oppSkill} | ${oppRoll}+${oppMod}+${profBonus}=${npcTotal} | بازیکن ${r.total} | فاصله ${margin} → ${degree.key}`,
  );

  return {
    ability: r.ability,
    roll: r.roll,
    rolls: r.rolls,
    mode: r.mode,
    mod: r.mod,
    profBonus: r.profBonus,
    opponentLabel: ROLE_LABELS[role],
    margin,
    degree,
    // ثبت در جدول creatures بعداً و همراه بقیه‌ی تغییرهای دور انجام میشه (نه در PLAN)
    creature: {
      locationId,
      role,
      tier,
      abilities,
      proficiencyBonus: profBonus,
    },
  };
}
