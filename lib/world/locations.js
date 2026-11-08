import { db } from "sdk";
import { eq } from "sdk/db";
import {
  locations,
  locationLinks,
  gameSessions,
  sessionLog,
  worldLore,
  worldClock,
} from "schema";
import { generateNarration } from "lib/ai/aiClient";
import { parseJson, toIndex } from "lib/core/utils";
import { ROLE_MENU, ROLE_LABELS } from "lib/world/creatures";
// ---------- برچسب‌های قواعد مکان (فهرست بسته) ----------
// mods = اثر روی تاس بازیکن در همین مکان: عدد مثبت = کمک، عدد منفی = مانع
// (کلیدها باید دقیقاً اسم مهارت‌های SKILL_ABILITY_MAP باشن)

export const RULE_TAGS = {
  darkness: {
    label: "تاریکی",
    hint: "تاریکی غلیظی همه‌جا را گرفته و دیدن سخت است",
    mods: { Perception: -2, Investigation: -2, Stealth: 2 },
  },
  hostileCrowd: {
    label: "جمعیت خصمانه",
    hint: "مردم اطراف نسبت به غریبه‌ها خصمانه‌اند",
    mods: { Persuasion: -2, Deception: -2 },
  },
  friendlyFolk: {
    label: "مردم خوش‌برخورد",
    hint: "مردم اینجا مهربان و خوش‌برخوردند",
    mods: { Persuasion: 2 },
  },
  treacherousTerrain: {
    label: "زمین خطرناک",
    hint: "زمین ناهموار، لغزنده و پرخطر است",
    mods: { Athletics: -2, Acrobatics: -2 },
  },
  denseCover: {
    label: "پوشش انبوه",
    hint: "مه یا درختان انبوه میدان دید را بسته و جای پنهان‌شدن زیاد است",
    mods: { Stealth: 2, Perception: -2 },
  },
  harshWilderness: {
    label: "طبیعت سخت",
    hint: "طبیعت وحشی و بی‌رحم است",
    mods: { Survival: -2 },
  },
  strictGuards: {
    label: "نگهبانان سخت‌گیر",
    hint: "نگهبانان سخت‌گیر و هوشیار همه‌چیز را زیر نظر دارند",
    mods: { Deception: -2, "Sleight of Hand": -2, Stealth: -2 },
  },
  ancientMagic: {
    label: "جادوی کهن",
    hint: "جادوی کهن در فضا موج می‌زند",
    mods: { Arcana: 2 },
  },
};

export const RULE_MENU = Object.keys(RULE_TAGS);
const MAX_RULES = 2;

// اثر قواعد مکان روی تاس یک مهارت. خروجی: مجموع + فهرست اثرها (برای نمایش توی خط تاس)
export function locationModifier(location, skill) {
  const applied = [];
  let total = 0;
  for (const key of location?.rules || []) {
    const delta = RULE_TAGS[key]?.mods?.[skill];
    if (delta) {
      total += delta;
      applied.push({ label: RULE_TAGS[key].label, delta });
    }
  }
  return { total, applied };
}

// ---------- کمکی‌ها ----------

export function buildRuleMenuText() {
  const lines = RULE_MENU.map(
    (k, i) => `${i + 1}) ${RULE_TAGS[k].label} — ${RULE_TAGS[k].hint}`,
  ).join("\n");
  return `فهرست ویژگی‌های محیط (صفر تا ${MAX_RULES} مورد، فقط اگه واقعاً به مکان می‌خوره):\n${lines}`;
}

// خط‌های پروفایل مکان که به راوی می‌رسن (محیط و جمعیت).
// tier و hostility عمداً اینجا نیستن: DM-Only‌اند و نباید به راوی/بازیکن درز کنن.
export function profileLines(loc) {
  const lines = [];
  const envs = (loc?.environments || [])
    .map((k) => ENVIRONMENT_LABELS[k])
    .filter(Boolean);
  if (envs.length) lines.push(`نوع محیط: ${envs.join("، ")}`);
  const pop = populationText(loc?.population);
  if (pop) lines.push(pop);
  return lines;
}

// متنی که به Resolver و راوی داده میشه
export function locationContextText(location) {
  if (!location) return "";
  const hints = (location.rules || [])
    .map((k) => RULE_TAGS[k]?.hint)
    .filter(Boolean);
  return (
    `مکان فعلی: ${location.name} — ${location.theme}` +
    (hints.length ? `\nویژگی‌های محیط: ${hints.join("؛ ")}` : "") +
    profileLines(location)
      .map((l) => `\n${l}`)
      .join("")
  );
}

// ---------- اعتبارسنجی پیش‌نویس مکانی که AI نوشته ----------
// fatal = اسم یا تم خراب (بدون اون‌ها مکان بی‌معنیه). خطای rules فقط اون مورد رو حذف می‌کنه.

// سطح‌های مجاز مکان (فهرست بسته برای منوی سطح در سفر)
export const LEVEL_LABELS = {
  1: "آرام و کم‌خطر",
  2: "کمی خطرناک",
  3: "خطرناک",
  4: "بسیار خطرناک و مرگبار",
};

export function buildLevelMenuText() {
  const lines = Object.entries(LEVEL_LABELS)
    .map(([n, label]) => `${n}) ${label}`)
    .join("\n");
  return `فهرست سطح خطر مکان مقصد:\n${lines}`;
}

// ---------- Location Profile (V09) ----------
// مالک مفهوم: world_building.md بخش 25.6 (tier + hostility + environments + rules + storyTags).
// AI فقط شماره از فهرست‌های بسته می‌ده؛ عدد جمعیت رو کد می‌سازه.

export const ENVIRONMENTS = [
  "forest",
  "snow",
  "mountain",
  "desert",
  "swamp",
  "ruins",
  "dungeon",
  "urban",
  "coast",
  "plains",
];

export const ENVIRONMENT_LABELS = {
  forest: "جنگل",
  snow: "برفزار",
  mountain: "کوهستان",
  desert: "بیابان",
  swamp: "باتلاق",
  ruins: "ویرانه",
  dungeon: "سیاه‌چال یا غار",
  urban: "شهر یا آبادی",
  coast: "ساحل",
  plains: "دشت",
};

export const MAX_ENVIRONMENTS = 4;

// خصومت = حضور موجود خصمانه (نه جمعیت و نه خصومت اجتماعی hostileCrowd)
export const HOSTILITY_LEVELS = ["none", "low", "moderate", "high"];
const HOSTILITY_HINTS = [
  "هیچ — موجود خصمانه‌ای اینجا نیست (مکان امن)",
  "کم — شاید گاهی موجودی سرگردان پیدا بشه",
  "متوسط — برخورد با موجودات خصمانه محتمله",
  "زیاد — اینجا لانه یا قلمرو موجودات خصمانه‌ست",
];
// مکان شروع بازی حداکثر «کم» (اندیس ۱)
export const START_MAX_HOSTILITY_INDEX = 1;

// نردبان مقیاس جمعیت (world_building.md 24.2)
export const POPULATION_STEPS = [
  { label: "خالی", min: 0, max: 0 },
  { label: "تک‌نفر", min: 1, max: 3 },
  { label: "کم", min: 4, max: 9 },
  { label: "گروه", min: 10, max: 20 },
  { label: "جمع", min: 21, max: 50 },
  { label: "انبوه", min: 51, max: 100 },
  { label: "شلوغ", min: 101, max: 150 },
];
export const POPULATION_CAP = 150; // سقف مطلق
export const MAX_COMPOSITION_ROLES = 3;
// سهم نقش‌ها به ترتیب رتبه (AI فقط ترتیب نقش‌ها رو می‌گه، درصد رو کد می‌ده)
const COMPOSITION_SHARES = { 1: [100], 2: [70, 30], 3: [60, 30, 10] };

export function buildProfileMenuText() {
  const env = ENVIRONMENTS.map(
    (k, i) => `${i + 1}) ${ENVIRONMENT_LABELS[k]}`,
  ).join("\n");
  const host = HOSTILITY_HINTS.map((h, i) => `${i + 1}) ${h}`).join("\n");
  const pop = POPULATION_STEPS.map(
    (s, i) =>
      `${i + 1}) ${s.label}` +
      (s.max > 0 ? ` (حدود ${s.min} تا ${s.max} نفر)` : " (کسی نیست)"),
  ).join("\n");
  const roles = ROLE_MENU.map((k, i) => `${i + 1}) ${ROLE_LABELS[k]}`).join(
    "\n",
  );
  return (
    `فهرست نوع محیط (environments: یک تا ${MAX_ENVIRONMENTS} شماره‌ی مناسب مکان):\n${env}\n\n` +
    `فهرست خصومت (hostility: یک شماره):\n${host}\n\n` +
    `فهرست جمعیت (pop: یک شماره، با توجه به نوع مکان و ساعت روز):\n${pop}\n\n` +
    `فهرست نقش آدم‌های مکان (roles: صفر تا ${MAX_COMPOSITION_ROLES} شماره، از بیشترین سهم به کمترین؛ اگه pop خالیه ننویس):\n${roles}`
  );
}

// عدد دقیق جمعیت داخل پله رو کد می‌سازه (rng فقط برای تست قابل‌تعویضه)
export function buildPopulation(
  stepIndex,
  roleKeys = [],
  { hours = null, rng = Math.random } = {},
) {
  const step = POPULATION_STEPS[stepIndex];
  if (!step) return null;
  const max = Math.min(step.max, POPULATION_CAP);
  const min = Math.min(step.min, max);
  const count = min + Math.floor(rng() * (max - min + 1));

  const composition = [];
  if (count > 0) {
    let roles = [...new Set(roleKeys)]
      .filter((k) => ROLE_MENU.includes(k))
      .slice(0, MAX_COMPOSITION_ROLES);
    if (!roles.length) roles = ["commoner"];
    const shares = COMPOSITION_SHARES[roles.length];
    const counts = shares.map((sh) => Math.floor((count * sh) / 100));
    counts[0] += count - counts.reduce((a, b) => a + b, 0); // باقی‌مانده به نقش اول
    roles.forEach((role, i) => {
      if (counts[i] > 0) composition.push({ role, count: counts[i] });
    });
  }
  return { step: stepIndex + 1, label: step.label, count, composition, hours };
}

// Registered + Crowd ≤ Population: چند نفر هنوز Crowd (بی‌نام) هستن
export function crowdLeft(population, registeredCount = 0) {
  return Math.max(0, (population?.count || 0) - registeredCount);
}

// متن جمعیت برای راوی؛ بدون snapshot (مکان قدیمی) چیزی نمی‌گه
export function populationText(population) {
  if (!population || typeof population.count !== "number") return "";
  if (population.count === 0) return "جمعیت حاضر: کسی اینجا نیست.";
  const parts = (population.composition || [])
    .map((c) => `${ROLE_LABELS[c.role] || c.role}: ${c.count}`)
    .join("، ");
  return (
    `جمعیت حاضر: حدود ${population.count} نفر` +
    (parts ? ` (${parts})` : "") +
    ". فقط درون همین جمعیت آدم توصیف کن و بیشتر از این تعداد نیاور."
  );
}

// ته‌مانده‌ی مکان: حداکثر ۳ خط، جدیدترین آخر؛ خط تازه جای قدیمی‌ترین رو می‌گیره
export const MAX_RESIDUE = 3;
export function addResidue(residue, line) {
  const lines = (Array.isArray(residue) ? residue : []).filter(
    (l) => typeof l === "string" && l.trim(),
  );
  const text = String(line ?? "")
    .trim()
    .slice(0, 120);
  if (!text) return lines.slice(-MAX_RESIDUE);
  return [...lines.filter((l) => l !== text), text].slice(-MAX_RESIDUE);
}

// Location Profile = tier + hostility + environments + rules + storyTags
// storyTags از بیرونه (Flagها، V13)؛ تا اون موقع خالی
export function locationProfile(location, storyTags = []) {
  return {
    tier: location?.tier || 1,
    hostility: location?.hostility || "none",
    environments: location?.environments || [],
    rules: location?.rules || [],
    storyTags,
  };
}

// پیش‌نویس معتبرشده ← فیلدهای نهایی برای ذخیره (کد خصومت مکان شروع رو محدود و جمعیت رو می‌سازه)
export function finalizeProfile(
  draft,
  { hours = null, isStart = false, rng = Math.random } = {},
) {
  let h = Math.max(0, HOSTILITY_LEVELS.indexOf(draft?.hostility));
  if (isStart) h = Math.min(h, START_MAX_HOSTILITY_INDEX);
  return {
    hostility: HOSTILITY_LEVELS[h],
    environments: draft?.environments || [],
    population:
      draft?.popStep == null
        ? null
        : buildPopulation(draft.popStep, draft.roles || [], { hours, rng }),
  };
}

export function validateLocationDraft(
  data,
  { askTier = false, askProfile = false } = {},
) {
  const problems = [];
  let fatal = false;

  const name = typeof data?.name === "string" ? data.name.trim() : "";
  const theme = typeof data?.theme === "string" ? data.theme.trim() : "";
  if (!name || name.length > 40) {
    problems.push("اسم مکان باید بین ۱ تا ۴۰ حرف باشد");
    fatal = true;
  }
  if (theme.length < 10 || theme.length > 400) {
    problems.push("تم مکان باید بین ۱۰ تا ۴۰۰ حرف باشد");
    fatal = true;
  }

  const rules = [];
  const raw = data?.rules == null ? [] : data.rules;
  if (!Array.isArray(raw)) {
    problems.push("rules باید آرایه باشد");
  } else {
    for (const r of raw) {
      const i = toIndex(r, RULE_MENU.length);
      if (i < 0) {
        problems.push(`شماره‌ی ویژگی ${r} در فهرست نیست`);
      } else if (!rules.includes(RULE_MENU[i])) {
        rules.push(RULE_MENU[i]);
      }
    }
  }

  let tier = null;
  if (askTier) {
    const n = Number(data?.tier);
    if (Number.isInteger(n) && n >= 1 && n <= 4) {
      tier = n;
    } else {
      problems.push(`شماره‌ی سطح ${data?.tier} در فهرست نیست`);
    }
  }

  const environments = [];
  let hostility = "none";
  let popStep = null;
  const roles = [];

  if (askProfile) {
    // نوع محیط: حداکثر ۴ شماره‌ی منحصربه‌فرد؛ خالی مجازه (فیلتر دشمن Fallback داره)
    const envRaw = data?.environments == null ? [] : data.environments;
    if (!Array.isArray(envRaw)) {
      problems.push("environments باید آرایه باشد");
    } else {
      for (const e of envRaw) {
        const i = toIndex(e, ENVIRONMENTS.length);
        if (i < 0) {
          problems.push(`شماره‌ی محیط ${e} در فهرست نیست`);
        } else if (!environments.includes(ENVIRONMENTS[i])) {
          environments.push(ENVIRONMENTS[i]);
        }
      }
      if (environments.length > MAX_ENVIRONMENTS) {
        problems.push(`حداکثر ${MAX_ENVIRONMENTS} محیط مجازه`);
      }
    }

    // خصومت: نامعتبر ← «هیچ» (امن‌ترین پیش‌فرض)
    const hi = toIndex(data?.hostility, HOSTILITY_LEVELS.length);
    if (hi >= 0) {
      hostility = HOSTILITY_LEVELS[hi];
    } else {
      problems.push(`شماره‌ی خصومت ${data?.hostility} در فهرست نیست`);
    }

    // جمعیت: نامعتبر ← بدون snapshot (مثل مکان قدیمی)
    const pi = toIndex(data?.pop, POPULATION_STEPS.length);
    if (pi >= 0) {
      popStep = pi;
    } else {
      problems.push(`شماره‌ی جمعیت ${data?.pop} در فهرست نیست`);
    }

    const rolesRaw = data?.roles == null ? [] : data.roles;
    if (!Array.isArray(rolesRaw)) {
      problems.push("roles باید آرایه باشد");
    } else {
      for (const r of rolesRaw) {
        const i = toIndex(r, ROLE_MENU.length);
        if (i < 0) {
          problems.push(`شماره‌ی نقش ${r} در فهرست نیست`);
        } else if (!roles.includes(ROLE_MENU[i])) {
          roles.push(ROLE_MENU[i]);
        }
      }
    }
  }

  return {
    draft: {
      name,
      theme,
      rules: rules.slice(0, MAX_RULES),
      tier,
      environments: environments.slice(0, MAX_ENVIRONMENTS),
      hostility,
      popStep,
      roles: roles.slice(0, MAX_COMPOSITION_ROLES),
    },
    problems,
    fatal,
  };
}

async function generateLocationDraft(
  contextText,
  forceProvider,
  { askTier = false, hours = null } = {},
) {
  let note = "";
  let best = null;
  // ساعت روز برای تخمین جمعیت (مثلاً میخانه شب شلوغ‌تره)
  const timeLine =
    hours == null
      ? ""
      : `\n\nساعت روز هنگام ورود به این مکان: ${TIME_OF_DAY_FA[timeOfDayFor(hours)]}`;
  const menu =
    buildRuleMenuText() +
    `\n\n${buildProfileMenuText()}` +
    (askTier ? `\n\n${buildLevelMenuText()}` : "");

  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      const raw = await generateNarration(
        "location_builder",
        [
          {
            role: "user",
            content: `${contextText}${timeLine}\n\n${menu}${note}\n\nمکان رو طراحی کن.`,
          },
        ],
        forceProvider,
        { temperature: 0.7, jsonMode: true },
      );
      result = validateLocationDraft(parseJson(raw), {
        askTier,
        askProfile: true,
      });
    } catch (err) {
      console.warn("⚠️  Location: خروجی AI معتبر نبود:", err.message);
      result = {
        draft: null,
        problems: ["خروجی JSON معتبر نبود"],
        fatal: true,
      };
    }

    if (!result.fatal) {
      if (!best || result.problems.length === 0) best = result;
      if (result.problems.length === 0) break;
    }
    note = `\n\nپاسخ قبلی تو مشکل داشت: ${result.problems.join("؛ ")}. دوباره جواب بده و فقط از شماره‌های موجود در فهرست‌ها استفاده کن.`;
  }

  return best ? best.draft : null;
}

// ---------- مکان فعلی گروه ----------

export async function getCurrentLocation(chatId) {
  const session = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
  if (!session || !session.currentLocationId) return null;
  const row = await db
    .select()
    .from(locations)
    .where(eq(locations.id, session.currentLocationId))
    .get();
  return row || null;
}

async function setCurrentLocation(chatId, locationId) {
  await db
    .update(gameSessions)
    .set({ currentLocationId: locationId })
    .where(eq(gameSessions.chatId, chatId))
    .run();
}

// اگه گروه هنوز مکان فعلی نداره، اولین مکان (سطح ۱) رو از روی دنیا و صحنه‌ی افتتاحیه می‌سازه.
// اگه AI خطا بده null برمی‌گردونه و دور بدون مکان ادامه پیدا می‌کنه (دور بعد دوباره امتحان میشه).
export async function ensureStartLocation(chatId, forceProvider = null) {
  try {
    const current = await getCurrentLocation(chatId);
    if (current) return current;

    // مکان هست ولی مکان فعلی ست نشده: اولین مکان
    const first = await db
      .select()
      .from(locations)
      .where(eq(locations.chatId, chatId))
      .get();
    if (first) {
      await setCurrentLocation(chatId, first.id);
      return first;
    }

    const world = await db
      .select()
      .from(worldLore)
      .where(eq(worldLore.chatId, chatId))
      .get();
    const logs = await db
      .select()
      .from(sessionLog)
      .where(eq(sessionLog.chatId, chatId))
      .all();
    const lastScene = [...logs].reverse().find((l) => l.role === "narrator");

    const contextText =
      `دنیا: ${world ? world.loreText : "(نامشخص)"}\n` +
      `آخرین صحنه‌ی بازی (مکان باید با همین هماهنگ باشه):\n${lastScene ? lastScene.content : "(هنوز صحنه‌ای نیست)"}`;

    const { elapsedHours } = await readClock(chatId);
    const draft = await generateLocationDraft(contextText, forceProvider, {
      hours: elapsedHours,
    });
    if (!draft) return null;
    // خصومت مکان شروع حداکثر «کم»؛ جمعیت با ساعت شروع بازی تخمین زده میشه
    const profile = finalizeProfile(draft, {
      hours: elapsedHours,
      isStart: true,
    });

    const row = await db
      .insert(locations)
      .values({
        chatId,
        name: draft.name,
        tier: 1, // مکان شروع همیشه سطح ۱
        theme: draft.theme,
        rules: draft.rules,
        hostility: profile.hostility,
        environments: profile.environments,
        population: profile.population,
      })
      .returning()
      .get();

    await setCurrentLocation(chatId, row.id);
    return row;
  } catch (err) {
    console.error("❌ ensureStartLocation شکست خورد:", err.message);
    return null;
  }
}

// ---------- سفر بین مکان‌ها ----------
// فاصله فقط از این فهرست میاد (منطبق با چیزی که Resolver انتخاب می‌کنه)

export const DISTANCE_MENU = [
  { hours: 1, label: "حدود یک ساعت" },
  { hours: 4, label: "چند ساعت" },
  { hours: 12, label: "نیم روز" },
  { hours: 24, label: "یک روز" },
  { hours: 72, label: "دو تا سه روز" },
  { hours: 168, label: "یک هفته" },
];

export function buildDistanceMenuText() {
  const lines = DISTANCE_MENU.map((d, i) => `${i + 1}) ${d.label}`).join("\n");
  return `فهرست فاصله‌ی سفر تا مکان جدید:\n${lines}`;
}

const TIME_OF_DAY = ["morning", "afternoon", "evening", "night"];

// ساعت ۰ = ۰۰:۰۰ روز ۱. روز با طلوع (۶ صبح) عوض میشه تا «شب» وسط دو روز تکه نشه.
export const DAWN_HOUR = 6;
// ساعتِ شروع پیش‌فرض، وقتی هنوز ردیف ساعتی نیست (صحنه‌ی افتتاحیه ساعت واقعی رو می‌نویسه)
export const DEFAULT_START_HOUR = 8;

// بازه‌ی روز از ساعت: صبح ۶–۱۲، ظهر ۱۲–۱۷، عصر ۱۷–۲۱، شب ۲۱–۶
export function timeOfDayFor(elapsed) {
  const h = ((elapsed % 24) + 24) % 24;
  if (h >= 6 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

// روز و بازه از ساعت (مقدار آماده برای نوشتن توی world_clock)
export function clockFields(elapsed) {
  return {
    currentDay: Math.max(1, Math.floor((elapsed - DAWN_HOUR) / 24) + 1),
    timeOfDay: timeOfDayFor(elapsed),
    elapsedHours: elapsed,
  };
}

// ساعت بازی = ساعت‌های گذشته از ۰۰:۰۰ روز ۱ (elapsed_hours، اعشاری).
// بدون ردیف: ساعت پیش‌فرض. ردیف قدیمی بدون elapsed_hours: از روز/بازه حساب میشه.
function clockToHours(row) {
  if (row?.elapsedHours != null) return row.elapsedHours;
  if (!row) return DEFAULT_START_HOUR;
  const day = row.currentDay || 1;
  const idx = Math.max(0, TIME_OF_DAY.indexOf(row.timeOfDay || "morning"));
  return (day - 1) * 24 + DAWN_HOUR + idx * 6;
}

export async function readClock(chatId) {
  const row = await db
    .select()
    .from(worldClock)
    .where(eq(worldClock.chatId, chatId))
    .get();
  return {
    elapsedHours: clockToHours(row),
    lastLongRestHours: row?.lastLongRestHours ?? null,
  };
}

// ---------- نمایش زمان ----------

const TIME_OF_DAY_FA = {
  morning: "صبح",
  afternoon: "ظهر",
  evening: "عصر",
  night: "شب",
};

// «روز ۴، شب»
export function timeLabel(elapsed) {
  const c = clockFields(elapsed);
  return `روز ${c.currentDay}، ${TIME_OF_DAY_FA[c.timeOfDay]}`;
}

// خط زمان بالای پیام صحنه
export function timeLine(elapsed) {
  return `🕐 ${timeLabel(elapsed)}`;
}

// یادداشت زمان برای راوی (بدون ساعت دقیق و عدد)
// passedLabel: فقط وقتی گذر زمان قابل‌توجهه (مثلاً «حدود نیم‌روز»)، وگرنه null
export function timeNarratorNote(elapsedAfter, passedLabel = null) {
  const passed = passedLabel
    ? ` در این دور ${passedLabel} گذشت و روایت باید این گذر زمان رو حس بده.`
    : "";
  return (
    `\n\nزمان جهان در پایان این دور: ${timeLabel(elapsedAfter)}.${passed} ` +
    "روایت نباید با این بازه‌ی روز تناقض داشته باشه (مثلاً توی شب نباید آفتاب بالای آسمان باشه) و نباید ساعت دقیق یا عدد بگه."
  );
}
// ---------- ساعت شروع بازی (صحنه‌ی افتتاحیه انتخاب می‌کنه) ----------

export const START_TIME_MENU = [
  { key: "morning", hour: 8, label: "صبح" },
  { key: "afternoon", hour: 13, label: "ظهر" },
  { key: "evening", hour: 18, label: "عصر" },
  { key: "night", hour: 22, label: "شب" },
];

export function buildStartTimeMenuText() {
  const lines = START_TIME_MENU.map((t, i) => `${i + 1}) ${t.label}`).join(
    "\n",
  );
  return `فهرست زمان شروع صحنه:\n${lines}`;
}

// آیا برای این گروه از قبل ردیف ساعتی هست؟
export async function hasClock(chatId) {
  const row = await db
    .select()
    .from(worldClock)
    .where(eq(worldClock.chatId, chatId))
    .get();
  return !!row;
}

// ساعت شروع رو فقط وقتی می‌نویسه که هنوز ردیف ساعتی نباشه.
// شماره‌ی نامعتبر = صبح (پیش‌فرض امن)
export async function ensureStartClock(chatId, timeIndex) {
  if (await hasClock(chatId)) {
    return { elapsed: (await readClock(chatId)).elapsedHours, created: false };
  }
  const i = toIndex(timeIndex, START_TIME_MENU.length);
  const hour = START_TIME_MENU[i >= 0 ? i : 0].hour;
  await db
    .insert(worldClock)
    .values({ chatId, ...clockFields(hour) })
    .onConflictDoNothing()
    .run();
  return { elapsed: hour, created: true };
}
// مرحله‌ی برنامه‌ریزی سفر: فقط مکان مقصد رو با AI پیش‌نویس می‌کنه؛ هیچ‌چیز توی دیتابیس نمی‌نویسه
export async function planTravel(
  decision,
  contextText,
  currentLocation,
  forceProvider = null,
) {
  if (!decision?.moved) return null;

  const dist = DISTANCE_MENU[decision.distanceIndex] || DISTANCE_MENU[1];
  // ساعت رسیدن: همون گردکردن سفر به مضرب ۶ ساعت که computeClock (events.js) داره
  let arrival = null;
  if (currentLocation?.chatId != null) {
    const { elapsedHours } = await readClock(currentLocation.chatId);
    arrival = elapsedHours + Math.max(1, Math.round(dist.hours / 6)) * 6;
  }
  const draft = await generateLocationDraft(
    `${contextText}\n\nگروه از مکان قبلی خارج شده و به مکان تازه‌ای رسیده.`,
    forceProvider,
    { askTier: true, hours: arrival },
  );
  if (!draft) {
    console.warn("⚠️  Travel: مکان جدید ساخته نشد، مکان قبلی می‌مونه");
    return null;
  }

  const prevTier = currentLocation?.tier || 1;
  let tier = draft.tier || prevTier;
  if (tier > prevTier + 1) tier = prevTier + 1;
  if (tier < 1) tier = 1;
  if (tier > 4) tier = 4;

  const profile = finalizeProfile(draft, { hours: arrival });

  return {
    traveled: true,
    distanceLabel: dist.label,
    hours: dist.hours,
    arrivalHour: arrival, // ساعت جهان هنگام رسیدن (برای Roll Gate دشمن)
    fromLocationId: currentLocation?.id ?? null,
    location: {
      name: draft.name,
      tier,
      theme: draft.theme,
      rules: draft.rules,
      hostility: profile.hostility,
      environments: profile.environments,
      population: profile.population,
    },
  };
}

// متنی که به round_narrator اضافه میشه تا سفر و رسیدن به مقصد رو روایت کنه
export function travelNarratorNote(travel) {
  if (!travel?.traveled) return "";
  const loc = travel.location;
  const hints = (loc.rules || [])
    .map((k) => RULE_TAGS[k]?.hint)
    .filter(Boolean);
  return (
    `\n\nگروه در همین دور سفر کرد (${travel.distanceLabel}) و به مکان تازه‌ای رسید: ${loc.name} — ${loc.theme}` +
    (hints.length ? `\nویژگی‌های محیط مقصد: ${hints.join("؛ ")}` : "") +
    profileLines(loc)
      .map((l) => `\n${l}`)
      .join("") +
    "\nروایت باید همین سفر و رسیدن به مقصد را نشان بدهد."
  );
}
