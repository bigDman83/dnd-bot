import { db } from "sdk";
import { eq } from "sdk/db";
import { characters } from "schema";
import { generateNarration } from "lib/ai/aiClient";
import { resolveSkillCheck, netMode } from "lib/core/skillCheck";
import {
  locationModifier,
  DISTANCE_MENU,
  buildDistanceMenuText,
} from "lib/world/locations";
import { ROLE_MENU, buildRoleMenuText, rollContest } from "lib/world/creatures";
import { degreeFor } from "lib/core/degrees";
import { summarizeGroups } from "lib/core/groups";
import { skillXpFor } from "lib/core/xp";
import { parseJson, toIndex } from "lib/core/utils";
import { SCENE_TYPES, DEFAULT_SCENE_TYPE } from "lib/game/blocks";
import {
  monsterMenuText,
  monsterByIndex,
  clampCount,
} from "lib/combat/monsters";
import {
  SKILL_ABILITY_MAP,
  SKILL_DESC_FA,
  DC_TABLE,
  ABILITY_FA,
  TOOL_LABELS_FA,
  xpToNext,
} from "lib/core/dndData";
import {
  ACTION_TYPES,
  DEFAULT_ACTION_INDEX,
  actionTypeByIndex,
  buildActionTypeMenuText,
  finalDc,
  DIFFICULTY_ANCHORS_FA,
} from "lib/core/actions";
import {
  checkFeasibility,
  issueByIndex,
  buildIssueMenuText,
} from "lib/core/feasibility";

// ---------- جدول‌های مرجع (منبع واحد برای پرامپت و اعتبارسنجی) ----------
// فهرست مهارت‌ها و سختی‌ها از همان SKILL_ABILITY_MAP و DC_TABLE ساخته می‌شود؛
// پس اگه یکی از اون‌ها عوض شد، منوی AI و اعتبارسنجی خودکار هماهنگ می‌مونن.

export const SKILL_MENU = Object.keys(SKILL_ABILITY_MAP);
export const DIFFICULTY_MENU = Object.keys(DC_TABLE);

const DIFFICULTY_FA = {
  veryEasy: "خیلی آسان",
  easy: "آسان",
  medium: "متوسط",
  hard: "سخت",
  veryHard: "خیلی سخت",
  nearlyImpossible: "تقریباً غیرممکن",
};

// اسم کوتاه فارسی مهارت‌ها (برای خط تاس)
const SKILL_NAME_FA = {
  Acrobatics: "آکروباتیک",
  "Animal Handling": "رام‌کردن حیوان",
  Arcana: "دانش جادو",
  Athletics: "ورزشکاری",
  Deception: "فریبکاری",
  History: "تاریخ",
  Insight: "بینش",
  Intimidation: "ارعاب",
  Investigation: "کاوش",
  Medicine: "پزشکی",
  Nature: "طبیعت",
  Perception: "ادراک",
  Performance: "اجرا",
  Persuasion: "متقاعدسازی",
  Religion: "دین",
  "Sleight of Hand": "دست‌بازی",
  Stealth: "مخفی‌کاری",
  Survival: "بقا",
};

// ---------- منوی شماره‌دار برای AI ----------

// سقف تعداد اقدام تحلیل‌شده برای هر بازیکن در یک دور (برای جلوگیری از اسپم AI)
export const MAX_ENTRIES_PER_PLAYER = 5;
// سقف مرحله‌های یک زنجیره‌ی وابسته (parameters.md)؛ مرحله‌ی بعد از آن به دور بعد می‌ره
export const CHAIN_CAP = 5;

// منوی «ریسک» (Risk Gate): AI فقط شماره می‌ده
export const RISK_MENU = ["risk", "none"];
export function buildRiskMenuText() {
  return (
    "فهرست ریسک (برای هر اقدام؛ اگه مطمئن نیستی شماره‌ی 1):\n" +
    "1) ریسک واقعی شکست با پیامد معنادار هست (چک لازمه)\n" +
    "2) ریسکی نیست یا شکستش پیامد معناداری نداره (طبیعی انجام میشه، بدون تاس)"
  );
}

export function buildMenuText(eligible, chars = new Map()) {
  const players = eligible
    .map((p, i) => {
      const spells = chars.get(p.characterId)?.spellsKnown;
      const spellPart =
        Array.isArray(spells) && spells.length > 0
          ? ` — اسپل‌های این بازیکن: ${spells.join(", ")}`
          : "";
      return `${i + 1}) ${p.name}${spellPart}`;
    })
    .join("\n");
  const skills = SKILL_MENU.map(
    (s, i) =>
      `${i + 1}) ${s}${SKILL_DESC_FA[s] ? ` — ${SKILL_DESC_FA[s]}` : ""}`,
  ).join("\n");
  const diffs = DIFFICULTY_MENU.map(
    (d, i) =>
      `${i + 1}) ${DIFFICULTY_FA[d] || d}${DIFFICULTY_ANCHORS_FA[d] ? ` — ${DIFFICULTY_ANCHORS_FA[d]}` : ""}`,
  ).join("\n");
  const mediumNo = DIFFICULTY_MENU.indexOf("medium") + 1;
  return (
    `فهرست بازیکن‌ها:\n${players}\n\n` +
    `فهرست مهارت‌ها:\n${skills}\n\n` +
    `فهرست سختی‌ها (اگه مطمئن نیستی، شماره‌ی ${mediumNo} یعنی متوسط):\n${diffs}\n\n` +
    `${buildActionTypeMenuText()}\n\n` +
    `${buildRiskMenuText()}\n\n` +
    buildIssueMenuText()
  );
}

// ---------- منوی نبرد و استراحت ----------

export const REST_MENU = ["short", "long"];
const REST_LABELS_FA = {
  short: "استراحت کوتاه (حدود یک ساعت)",
  long: "استراحت طولانی (یک شب کامل، حدود ۸ ساعت)",
};

export function buildCombatMenuText(tier) {
  return `فهرست هیولاها (فقط اگه این دور نبرد شروع میشه، شماره‌ی مناسب‌ترین هیولا رو بده؛ در غیر این صورت این فهرست رو نادیده بگیر):\n${monsterMenuText(tier)}`;
}

export function buildRestMenuText() {
  const lines = REST_MENU.map((k, i) => `${i + 1}) ${REST_LABELS_FA[k]}`).join(
    "\n",
  );
  return `فهرست استراحت (فقط اگه گروه در این دور واقعاً استراحت کرده؛ در غیر این صورت این فیلد رو ننویس):\n${lines}`;
}

// ---------- اعتبارسنجی خروجی AI ----------

// موقعیت (moved/distance) جدا از type اعتبارسنجی میشه؛ اگه نامعتبر بود فقط
// بی‌صدا false/پیش‌فرض می‌گیره، چون کم‌اهمیت‌تر از چکه و نباید باعث دوباره‌پرسی بشه.
function readTravel(data) {
  const moved = data?.moved === true;
  if (!moved) return { moved: false, distanceIndex: null };
  let di = toIndex(data?.distance, DISTANCE_MENU.length);
  if (di < 0) di = 1; // پیش‌فرض: چند ساعت
  return { moved: true, distanceIndex: di };
}

// استراحت هم مثل سفر بی‌صدا خوانده میشه؛ نامعتبر = بدون استراحت
function readRest(data) {
  const i = toIndex(data?.rest, REST_MENU.length);
  return i >= 0 ? REST_MENU[i] : null;
}
// ---------- منوی زمان (timeCost): AI فقط شماره می‌ده ----------

export const TIME_MENU = [
  { key: "instant", hours: 0, label: "فوری (بدون گذشت زمان محسوس)" },
  { key: "minutes", hours: 0.25, label: "چند دقیقه" },
  { key: "hour", hours: 1, label: "حدود یک ساعت" },
  { key: "halfDay", hours: 6, label: "نیم‌روز" },
  { key: "day", hours: 24, label: "یک روز" },
];
export const DEFAULT_TIME_INDEX = 1; // دقایق

export function buildTimeMenuText() {
  const lines = TIME_MENU.map((t, i) => `${i + 1}) ${t.label}`).join("\n");
  return `فهرست زمان گذشته در این دور (اگه مطمئن نیستی شماره‌ی ${DEFAULT_TIME_INDEX + 1} یعنی چند دقیقه):\n${lines}`;
}

// مثل سفر و استراحت بی‌صدا خونده میشه؛ نامعتبر یا ننوشتن = دقایق
function readTime(data) {
  const i = toIndex(data?.time, TIME_MENU.length);
  return i >= 0 ? i : DEFAULT_TIME_INDEX;
}
// ---------- منوی نوع صحنه: AI فقط شماره می‌ده (سفر و استراحت را کد تعیین می‌کند) ----------
export const SCENE_MENU = ["explore", "social", "crisis", "mystery"];

export function buildSceneTypeMenuText() {
  const lines = SCENE_MENU.map(
    (k, i) => `${i + 1}) ${SCENE_TYPES[k].label}`,
  ).join("\n");
  return `فهرست نوع صحنه (اگه مطمئن نیستی شماره‌ی 1 یعنی اکتشاف):\n${lines}`;
}

function readSceneType(data) {
  const i = toIndex(data?.sceneType, SCENE_MENU.length);
  return i >= 0 ? SCENE_MENU[i] : DEFAULT_SCENE_TYPE;
}

export function validateDecision(
  data,
  eligible,
  { tier = 1, partySize = eligible.length, chars = new Map() } = {},
) {
  // نبرد از همه چیز مهم‌تره: اگه معتبر بود، چک/سفر/استراحت این دور نادیده گرفته میشن
  if (data && data.type === "combat") {
    const entry = monsterByIndex(tier, data.combat?.monster);
    const reason = String(data.combat?.reason || "")
      .trim()
      .slice(0, 80);
    const problems = [];
    if (!entry) problems.push("شماره‌ی هیولا در فهرست نیست");
    if (!reason) problems.push("دلیل شروع نبرد (reason) نوشته نشده");
    const noTravel = {
      moved: false,
      distanceIndex: null,
      timeIndex: DEFAULT_TIME_INDEX,
      sceneType: DEFAULT_SCENE_TYPE,
    };
    if (problems.length > 0) {
      return {
        checks: [],
        blocked: [],
        autos: [],
        combat: null,
        rest: null,
        problems,
        ...noTravel,
      };
    }
    const count = clampCount(entry, data.combat?.count, partySize, tier);
    return {
      checks: [],
      blocked: [],
      autos: [],
      combat: { entry, count, reason },
      rest: null,
      problems: [],
      ...noTravel,
    };
  }

  const travel = {
    ...readTravel(data),
    timeIndex: readTime(data),
    sceneType: readSceneType(data),
  };
  const rest = readRest(data);
  if (!data || data.type !== "checks") {
    return {
      checks: [],
      blocked: [],
      autos: [],
      combat: null,
      rest,
      problems: [],
      ...travel,
    };
  }
  if (!Array.isArray(data.checks)) {
    return {
      checks: [],
      blocked: [],
      autos: [],
      combat: null,
      rest,
      problems: ["فیلد checks باید آرایه باشد"],
      ...travel,
    };
  }

  const checks = [];
  const blocked = [];
  const autos = [];
  const helps = [];
  const problems = [];
  const perPlayer = new Map();
  // ثبت هر مورد برای زنجیره‌ها: شماره‌ی مورد (از 1) ← { kind, entry, player, label, after }
  const reg = new Map();
  const overflow = []; // مورد‌های بیش از سقف هر بازیکن

  data.checks.forEach((c, i) => {
    const src = i + 1;
    const afterN = Number(c?.after);
    const after =
      Number.isInteger(afterN) && afterN >= 1 && afterN < src ? afterN : null;
    const pi = toIndex(c?.player, eligible.length);
    if (pi < 0) {
      problems.push(`اقدام ${i + 1}: شماره‌ی بازیکن در فهرست نیست`);
      return;
    }
    const player = eligible[pi];
    const reason = String(c?.reason || "")
      .trim()
      .slice(0, 80);
    const count = perPlayer.get(pi) || 0;
    if (count >= MAX_ENTRIES_PER_PLAYER) {
      // بیش از سقف: بی‌صدا حذف نمیشه؛ به دور بعد می‌ره (طبق طراحی بخش 12)
      overflow.push({
        player,
        actionKey: null,
        actionId: `a${src}`,
        text: reason,
        parentText: "",
        why: "deferred",
        step: null,
        total: null,
        chainId: null,
      });
      return;
    }
    perPlayer.set(pi, count + 1);
    const oi = toIndex(c?.opponent, ROLE_MENU.length);

    // نوع اقدام و مشکل اقدام: نامعتبر = پیش‌فرض امن (سایر / مشکلی نیست)، بی‌صدا
    const actionType =
      actionTypeByIndex(c?.action) || ACTION_TYPES[DEFAULT_ACTION_INDEX];
    const issue = issueByIndex(c?.issue);
    // تقابل با NPC همیشه ریسک داره؛ فقط اگه نامعتبر/ننوشته بود، ریسک واقعی فرض میشه
    const riskNone = oi < 0 && Number(c?.risk) === 2;

    // Feasibility (کد): وضعیت شخصیت، قوانین دنیا، اسپل، ابزار
    const feas = checkFeasibility({
      actionType,
      character: chars.get(player.characterId) || {},
      issue,
      riskNone,
    });

    if (feas.outcome === "impossible" || feas.outcome === "missing") {
      const bEntry = {
        ...feas,
        player,
        actionKey: actionType.key,
        actionFa: actionType.fa,
        text: reason,
        srcIndex: src,
        actionId: `a${src}`,
      };
      blocked.push(bEntry);
      reg.set(src, {
        kind: "blocked",
        entry: bEntry,
        player,
        label: reason,
        after,
      });
      return;
    }
    // Help: کمک به بازیکن دیگه (بعد از حلقه به‌صورت برتری به چک اون وصل میشه)
    const hi = toIndex(c?.help, eligible.length);
    if (hi >= 0 && hi !== pi) {
      helps.push({ helper: player, target: eligible[hi], text: reason });
      reg.set(src, { kind: "help", entry: null, player, label: reason, after });
      return;
    }

    if (feas.outcome === "auto") {
      const aEntry = {
        player,
        actionKey: actionType.key,
        reason,
        srcIndex: src,
        actionId: `a${src}`,
      };
      autos.push(aEntry);
      reg.set(src, {
        kind: "auto",
        entry: aEntry,
        player,
        label: reason,
        after,
      });
      return;
    }

    // نیازمند چک
    const si = toIndex(c?.skill, SKILL_MENU.length);
    if (si < 0) {
      problems.push(`اقدام ${i + 1}: شماره‌ی مهارت در فهرست نیست`);
      return;
    }
    let di = toIndex(c?.difficulty, DIFFICULTY_MENU.length);
    if (di < 0) di = DIFFICULTY_MENU.indexOf("medium");
    const cEntry = {
      player,
      skill: SKILL_MENU[si],
      difficulty: DIFFICULTY_MENU[di],
      opponentRole: oi >= 0 ? ROLE_MENU[oi] : null,
      reason,
      actionKey: actionType.key,
      actionId: `a${src}`,
      srcIndex: src,
      parentKey: null,
      parentReason: "",
      chain: null,
      disadvantage: feas.disadvantage || [],
      advantage: [],
      groupFlag: oi < 0 && Number(c?.group) === 1,
    };
    checks.push(cEntry);
    reg.set(src, {
      kind: "check",
      entry: cEntry,
      player,
      label: reason,
      after,
    });
  });

  // ---- زنجیره‌ی مراحل وابسته (طراحی V07، بخش 12): هر مرحله فقط وقتی اجرا میشه
  // که مرحله‌ی قبلی (همون بازیکن، مورد قبلی) موفق باشه
  const skipped = [];
  const removed = new Set();
  const status = new Map(); // شماره ← check | blocked | auto | help | skipped
  const depth = new Map();
  const root = new Map();
  const ordered = [...reg.entries()].sort((a, b) => a[0] - b[0]);
  for (const [src, r] of ordered) status.set(src, r.kind);
  for (const [src, r] of ordered) {
    const parent = r.after ? reg.get(r.after) : null;
    if (!parent || parent.player !== r.player) {
      depth.set(src, 1);
      root.set(src, src);
      continue; // مستقل
    }
    const d = depth.get(r.after) + 1;
    depth.set(src, d);
    root.set(src, root.get(r.after));
    r.depth = d;
    if (r.kind !== "check") continue;
    const base = {
      player: r.player,
      actionKey: r.entry.actionKey,
      actionId: r.entry.actionId,
      text: r.label,
      parentText: parent.label,
      step: d,
    };
    if (d > CHAIN_CAP) {
      removed.add(r.entry);
      skipped.push({ ...base, why: "deferred", srcIndex: src });
      status.set(src, "skipped");
      continue;
    }
    if (
      status.get(r.after) === "blocked" ||
      status.get(r.after) === "skipped"
    ) {
      removed.add(r.entry);
      skipped.push({ ...base, why: "parent_blocked", srcIndex: src });
      status.set(src, "skipped");
      continue;
    }
    // والد چک نیست (auto یا Help) ← شرطی در کار نیست؛ والد چکه ← بعد از تاس والد
    r.entry.parentKey = parent.kind === "check" ? r.after : null;
    r.entry.parentReason = parent.label;
  }
  // شماره‌ی مرحله و تعداد کل مرحله‌های هر زنجیره (فقط زنجیره‌های دو مرحله‌ای به بالا)
  const members = new Map();
  for (const [src] of ordered) {
    if (status.get(src) !== "check" && status.get(src) !== "skipped") continue;
    const rt = root.get(src);
    members.set(rt, (members.get(rt) || 0) + 1);
  }
  for (const [src, r] of ordered) {
    const rt = root.get(src);
    const total = members.get(rt) || 1;
    if (total < 2) continue;
    const chain = { id: `c${rt}`, step: depth.get(src), total };
    if (r.kind === "check" && !removed.has(r.entry)) r.entry.chain = chain;
  }
  for (const sk of skipped) {
    const rt = root.get(sk.srcIndex);
    sk.chainId = `c${rt}`;
    sk.total = members.get(rt) || null;
  }
  skipped.push(...overflow);
  const liveChecks = checks.filter((x) => !removed.has(x));
  checks.length = 0;
  checks.push(...liveChecks);

  // وصل‌کردن Help: برتری برای اولین چک بازیکنِ کمک‌شده (برتری روی هم جمع نمیشه)
  const helpsOut = helps.map((h) => {
    const target = checks.find((x) => x.player === h.target);
    if (target && !target.advantage.some((a) => a.by === h.helper.name)) {
      target.advantage.push({ source: "help", by: h.helper.name });
    }
    return {
      helperTgId: h.helper.tgId,
      helperName: h.helper.name,
      targetTgId: h.target.tgId,
      targetName: h.target.name,
      used: !!target,
    };
  });

  // Group Check: چک‌های هم‌مهارت و هم‌سختیِ حداقل دو بازیکن که AI علامت group زده
  const buckets = new Map();
  for (const x of checks) {
    if (!x.groupFlag) continue;
    const key = `${x.skill}|${x.difficulty}`;
    if (!buckets.has(key)) buckets.set(key, []);
    const arr = buckets.get(key);
    if (!arr.some((y) => y.player === x.player)) arr.push(x);
  }
  let groupNo = 0;
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    groupNo += 1;
    for (const x of arr) x.groupId = `g${groupNo}`;
  }
  for (const x of checks) delete x.groupFlag;

  return {
    checks,
    blocked,
    autos,
    skipped,
    helps: helpsOut,
    combat: null,
    rest,
    problems,
    ...travel,
  };
}

// ---------- تصمیم AI: این دور چک لازم داره یا فقط روایت؟ ----------

// کارنامهٔ بازیکن‌ها برای Feasibility (ابزار، اسپل، HP، مرده‌بودن)
async function loadEligibleCharacters(eligible) {
  const map = new Map();
  for (const p of eligible) {
    if (!p.characterId || map.has(p.characterId)) continue;
    const row = await db
      .select()
      .from(characters)
      .where(eq(characters.id, p.characterId))
      .get();
    if (row) map.set(p.characterId, row);
  }
  return map;
}

function entryCount(r) {
  return (
    (r?.checks?.length || 0) +
    (r?.blocked?.length || 0) +
    (r?.autos?.length || 0)
  );
}

export async function decideRound(
  contextText,
  state,
  forceProvider = null,
  location = null,
) {
  // بازیکن‌هایی که Skip کردن هیچ‌وقت چک نمی‌گیرن
  const eligible = state.players.filter(
    (p) => p.action && p.action.kind !== "skip",
  );
  const empty = {
    checks: [],
    blocked: [],
    autos: [],
    combat: null,
    rest: null,
    moved: false,
    distanceIndex: null,
    timeIndex: DEFAULT_TIME_INDEX,
    sceneType: DEFAULT_SCENE_TYPE,
  };
  if (eligible.length === 0) return empty;

  const tier = location?.tier || 1;
  const partySize = state.players.length;
  const chars = await loadEligibleCharacters(eligible);
  const menu =
    `${buildMenuText(eligible, chars)}\n\n${buildDistanceMenuText()}\n\n${buildRoleMenuText()}` +
    `\n\n${buildCombatMenuText(tier)}\n\n${buildRestMenuText()}\n\n${buildTimeMenuText()}\n\n${buildSceneTypeMenuText()}`;
  let note = "";
  let best = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      const raw = await generateNarration(
        "round_resolver",
        [
          {
            role: "user",
            content: `${contextText}\n\n${menu}${note}\n\nتصمیم بگیر.`,
          },
        ],
        forceProvider,
        { temperature: 0.2, jsonMode: true },
      );
      result = validateDecision(parseJson(raw), eligible, {
        tier,
        partySize,
        chars,
      });
    } catch (err) {
      console.warn("⚠️  Resolver: خروجی AI معتبر نبود:", err.message);
      result = { ...empty, problems: ["خروجی JSON معتبر نبود"] };
    }

    if (
      !best ||
      result.problems.length === 0 ||
      entryCount(result) >= entryCount(best)
    ) {
      best = result;
    }
    if (result.problems.length === 0) break;

    note = `\n\nپاسخ قبلی تو مشکل داشت: ${result.problems.join("؛ ")}. دوباره جواب بده و فقط از شماره‌های موجود در فهرست‌ها استفاده کن.`;
  }

  // این لاگ‌ها فقط برای تست توی wrangler tail ـه
  if (best?.combat) {
    console.log(
      `⚔️ Resolver: نبرد | ${best.combat.entry.fa} × ${best.combat.count} | دلیل: ${best.combat.reason}`,
    );
  }
  for (const b of best?.blocked || []) {
    console.log(
      `🚫 Resolver: ${b.player.name} | ${b.actionFa} | ${b.outcome}${b.kind ? `/${b.kind}` : ""}${b.text ? ` (${b.text})` : ""}`,
    );
  }
  for (const a of best?.autos || []) {
    console.log(`✅ Resolver: ${a.player.name} | بدون ریسک، بدون تاس`);
  }
  if (best?.rest) console.log(`🛏️ Resolver: استراحت ${best.rest}`);
  if (best && !best.combat) {
    console.log(
      `🕐 Resolver: زمان ${TIME_MENU[best.timeIndex]?.label} | نوع صحنه ${SCENE_TYPES[best.sceneType]?.label}`,
    );
  }
  return best || empty;
}

// ---------- تاس‌ریختن (کدمحور و قطعی) ----------

export async function rollChecks(checks, location = null, ctx = {}) {
  const {
    chatId,
    contextText = "",
    forceProvider = null,
    skippedOut = null,
  } = ctx;
  const results = [];
  const levelsCache = new Map(); // نقش ← سطح توانایی‌های NPC (یک بار AI در هر دور)
  const xpRunning = new Map(); // شخصیت ← XP او بعد از چک‌های قبلی همین دور (برای «XP تا سطح بعد»)
  for (const c of checks) {
    // مرحله‌ی وابسته: فقط اگه مرحله‌ی قبلی تاس شده و موفق (فاصله ≥ ۰) بوده
    if (c.parentKey) {
      const pr = results.find((r) => r.srcIndex === c.parentKey);
      if (!pr || pr.margin < 0) {
        skippedOut?.push({
          player: c.player,
          actionKey: c.actionKey,
          actionId: c.actionId,
          text: c.reason,
          parentText: c.parentReason,
          why: "parent_failed",
          step: c.chain?.step ?? null,
          total: c.chain?.total ?? null,
          chainId: c.chain?.id ?? null,
        });
        console.log(
          `⛔ ${c.player.name} | ${c.skill} | مرحله‌ی ${c.chain?.step ?? "?"} انجام نشد (مرحله‌ی قبل موفق نشد)`,
        );
        continue;
      }
    }
    const character = await db
      .select()
      .from(characters)
      .where(eq(characters.id, c.player.characterId))
      .get();
    if (!character) continue;

    // اثر قواعد مکان روی تاس بازیکن (مثلاً تاریکی: ادراک ۲−، مخفی‌کاری ۲+)
    const env = locationModifier(location, c.skill);

    // برتری/ضعف: منبع‌ها از Feasibility و Help می‌آیند؛ کد خالصشون می‌کنه
    const advSources = c.advantage || [];
    const disSources = c.disadvantage || [];
    const mode = netMode(advSources, disSources);
    const modeLog =
      mode === "normal" ? "" : ` [${mode === "advantage" ? "برتری" : "ضعف"}]`;

    if (c.opponentRole) {
      // تقابل رودررو: به‌جای عدد سختی ثابت، در برابر یک NPC تازه‌ساخته‌شده
      const contest = await rollContest({
        character,
        skill: c.skill,
        role: c.opponentRole,
        tier: location?.tier || 1,
        chatId,
        locationId: location?.id || null,
        contextText,
        forceProvider,
        mode,
        levelsCache,
      });
      const total = contest.roll + contest.mod + contest.profBonus + env.total;
      const envLog2 = env.total
        ? `${env.total > 0 ? "+" : ""}${env.total}`
        : "";
      console.log(
        `🎲 ${c.player.name} | ${c.skill} (تقابل با ${contest.opponentLabel})${modeLog} | ${contest.roll}+${contest.mod}+${contest.profBonus}${envLog2}=${total} | فاصله ${contest.margin + env.total} → ${degreeFor(contest.margin + env.total).key}`,
      );
      results.push({
        name: c.player.name,
        skill: c.skill,
        reason: c.reason,
        ability: contest.ability,
        roll: contest.roll,
        rolls: contest.rolls,
        mode,
        advSources,
        disSources,
        mod: contest.mod,
        profBonus: contest.profBonus,
        env: env.applied,
        total,
        opponentLabel: contest.opponentLabel,
        characterId: character.id,
        tgId: c.player.tgId ?? null,
        xp: 0, // تقابل DC ندارد، XP چک مهارت هم نمی‌گیرد
        actionKey: c.actionKey || null,
        actionId: c.actionId || null,
        srcIndex: c.srcIndex ?? null,
        chain: c.chain || null,
        margin: contest.margin + env.total,
        degree: degreeFor(contest.margin + env.total),
        creature: contest.creature,
      });
      continue;
    }

    // DC نهایی = لنگر سختی + تعدیل Tier مکان (Tier ۳ و ۴: +۵، سقف ۳۰)
    const fd = finalDc(c.difficulty, location?.tier || 1);
    const dc = fd.dc;
    const r = resolveSkillCheck(character, c.skill, dc, mode);
    const total = r.total + env.total;
    const margin = total - dc;
    // XP چک مهارت: فقط DC نهایی ≥ ۱۵ و چک موفق؛ به همان شخصیت
    const xp = skillXpFor({ dc, margin });
    const xpBefore = xpRunning.has(character.id)
      ? xpRunning.get(character.id)
      : Number(character.xp) || 0;
    xpRunning.set(character.id, xpBefore + xp);
    const xpFields = {
      characterId: character.id,
      tgId: c.player.tgId ?? null,
      xp,
      xpNext: xpToNext(character.level, xpBefore + xp).remaining,
    };
    const degree = degreeFor(margin);

    // این لاگ فقط برای تست توی wrangler tail ـه؛ عددها توی روایت نمیان
    const envLog = env.total ? `${env.total > 0 ? "+" : ""}${env.total}` : "";
    console.log(
      `🎲 ${c.player.name} | ${c.skill}${modeLog} | ${r.roll}+${r.mod}+${r.profBonus}${envLog}=${total} vs ${dc} | فاصله ${margin} → ${degree.key}`,
    );

    results.push({
      name: c.player.name,
      skill: c.skill,
      reason: c.reason,
      ability: r.ability,
      roll: r.roll,
      rolls: r.rolls,
      mode,
      advSources,
      disSources,
      mod: r.mod,
      profBonus: r.profBonus,
      env: env.applied,
      total,
      dc,
      dcBase: fd.base,
      tierBonus: fd.tierBonus,
      actionKey: c.actionKey || null,
      actionId: c.actionId || null,
      srcIndex: c.srcIndex ?? null,
      chain: c.chain || null,
      groupId: c.groupId || null,
      margin,
      degree,
      ...xpFields,
    });
  }
  return results;
}

// ---------- متن‌ها ----------

// بلوکی که به راوی داده میشه (بدون عدد؛ فقط درجه و توضیحش)
export function checksToNarratorText(results) {
  if (results.length === 0) return "";
  const lines = results
    .filter((r) => !r.groupId)
    .map(
      (r) =>
        `- ${r.actionId ? `[${r.actionId}] ` : ""}${r.name}${r.reason ? ` (${r.reason})` : ""}: ${r.degree.label} — ${r.degree.hint}`,
    );
  // چک گروهی: فقط نتیجه‌ی گروه به راوی داده میشه، نه نتیجه‌ی تک‌تک اعضا
  for (const g of summarizeGroups(results)) {
    lines.push(
      `- گروه (${g.members.join("، ")}) با هم${g.reason ? ` (${g.reason})` : ""}: ${g.label} — ${g.hint}`,
    );
  }
  return `\n\nنتیجه‌ی قطعی تلاش‌ها در این دور (غیرقابل‌تغییر):\n${lines.join("\n")}`;
}

// نام فارسی منبع برتری/ضعف برای نمایش
function sourceLabel(src) {
  if (src?.source === "help") return `کمک ${src.by}`;
  if (src?.source === "no_tool") {
    return `بدون ${TOOL_LABELS_FA[src.tool] || "ابزار مناسب"}`;
  }
  return "";
}

// بخش «تاس N» خط تاس: با برتری/ضعف هر دو تاس و دلیل رو نشون میده
export function rollPartFor(r) {
  const adv = (r.advSources || []).map(sourceLabel).filter(Boolean).join("، ");
  const dis = (r.disSources || []).map(sourceLabel).filter(Boolean).join("، ");
  if (r.mode === "advantage" && r.rolls?.length === 2) {
    return `${r.roll} (${r.rolls[0]} و ${r.rolls[1]}، با برتری: ${adv})`;
  }
  if (r.mode === "disadvantage" && r.rolls?.length === 2) {
    return `${r.roll} (${r.rolls[0]} و ${r.rolls[1]}، با ضعف: ${dis})`;
  }
  if ((r.advSources || []).length > 0 && (r.disSources || []).length > 0) {
    return `${r.roll} (برتری و ضعف همدیگه رو خنثی کردن)`;
  }
  return `${r.roll}`;
}

// تکه‌های یک خط تاس: سرِ خط، محاسبهٔ کامل و نتیجه (منبع واحد برای نمایش قدیم و جدید)
function checkPieces(r, results) {
  const abilityName = ABILITY_FA[r.ability] || r.ability;
  const modPart =
    r.mod === 0
      ? ""
      : r.mod > 0
        ? ` + ${abilityName} ${r.mod}`
        : ` − ${abilityName} ${Math.abs(r.mod)}`;
  const profPart = r.profBonus > 0 ? ` + مهارت ${r.profBonus}` : "";
  const envPart = (r.env || [])
    .map((e) =>
      e.delta > 0
        ? ` + ${e.label} ${e.delta}`
        : ` − ${e.label} ${Math.abs(e.delta)}`,
    )
    .join("");
  const dcPart = r.opponentLabel
    ? `در برابر ${r.opponentLabel}`
    : `در برابر ${r.dc}`;
  // اگه یک بازیکن چند چک داره یا مرحله‌ای از یک زنجیره‌ست، شرح تلاش و شماره‌ی مرحله هم میاد
  const multi = results.filter((x) => x.name === r.name).length > 1;
  const tag = [
    multi && r.reason ? r.reason : null,
    r.chain ? `مرحله ${r.chain.step} از ${r.chain.total}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tagPart = tag ? ` (${tag})` : "";
  return {
    head: `${r.name} — ${SKILL_NAME_FA[r.skill] || r.skill}${tagPart}`,
    math: `تاس ${rollPartFor(r)}${modPart}${profPart}${envPart} = ${r.total} ${dcPart}`,
    outcome: r.groupId ? (r.margin >= 0 ? "موفق" : "ناموفق") : r.degree.label,
  };
}

function groupLinesFor(results) {
  return summarizeGroups(results).map(
    (g) =>
      `👥 نتیجه‌ی گروهی (${g.members.join("، ")}): ${g.label} — ${g.successes} از ${g.total} نفر موفق شدند`,
  );
}

// خط‌های تاس به شکل قدیمی (یک خط کامل برای هر چک)؛ برای صحنه‌های قبل از V08 و بازپخش
export function checksToDiceText(results) {
  const memberLines = results.map((r) => {
    const p = checkPieces(r, results);
    return `🎲 ${p.head}: ${p.math} ← ${p.outcome}`;
  });
  return [...memberLines, ...groupLinesFor(results)].join("\n");
}

// شکل بلوکی (V08): خط ساده برای هر چک + جزئیات کامل که داخل بخش قابل‌جمع‌شدن می‌رود
export function checksToDiceParts(results) {
  const pieces = results.map((r) => ({ r, p: checkPieces(r, results) }));
  const groupLines = groupLinesFor(results);
  const own = pieces.filter(({ r }) => !r.groupId && r.actionId);
  const rest = pieces.filter(({ r }) => r.groupId || !r.actionId);
  return {
    lines: [
      ...pieces.map(({ r, p }) => `🎲 ${p.head}: ${r.total} ← ${p.outcome}`),
      ...groupLines,
    ],
    details: pieces.map(({ r, p }) => `${r.name}: ${p.math}`),
    // برای چیدمان: هر چکِ مستقل با شناسه‌ی اقدامش کنار روایت همان اقدام می‌نشیند
    items: own.map(({ r, p }) => ({
      id: r.actionId,
      line: `🎲 ${p.head}: ${r.total} ← ${p.outcome}`,
      detail: `${r.name}: ${p.math}`,
    })),
    // چک گروهی (و بدون شناسه) در بلوک سیستم بعد از روایت می‌ماند
    extraLines: [
      ...rest.map(({ r, p }) => `🎲 ${p.head}: ${r.total} ← ${p.outcome}`),
      ...groupLines,
    ],
    extraDetails: rest.map(({ r, p }) => `${r.name}: ${p.math}`),
  };
}
