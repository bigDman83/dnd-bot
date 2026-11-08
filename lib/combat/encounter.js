// Roll Gate دشمن (V10): تصمیم‌ها همه کدمحورند و AI فقط از «فهرست بسته» شماره می‌دهد
// این فایل خالص است (بدون دیتابیس)؛ نوشتن Snapshot در COMMIT دور سفر انجام می‌شود
import { generateNarration } from "lib/ai/aiClient";
import { parseJson } from "lib/core/utils";
import { fetchMonsterByKey } from "lib/api/monsterApi";
import { COMBAT_MENU, menuForTier, clampCount } from "lib/combat/monsters";

// ── ثابت‌ها ──────────────────────────────────────────────────────────────
// Reset مکان پاک‌شده (روز جهان) بر اساس Tier: parameters.md
export const RESET_DAYS = { 1: 2, 2: 4, 3: 7, 4: 10 };
// Cooldown بین دو Encounter: ۱ ساعت جهان یا ۳ دور، هرکدام زودتر تمام شود
export const COOLDOWN_HOURS = 1;
export const COOLDOWN_ROUNDS = 3;
// اگر بعد از فیلتر محیط کمتر از این تعداد هیولا بماند، فقط فیلتر محیط کنار می‌رود
export const MIN_POOL_AFTER_ENV = 3;

// سختی‌ها ← کلاس بودجه (Boss فقط با مجوز Story Engine؛ تا V13 هرگز)
export const DIFFICULTY_TABLE = [
  { max: 5, key: "easy", label: "ساده", budgetClass: "low" },
  { max: 10, key: "medium", label: "متوسط", budgetClass: "moderate" },
  { max: 15, key: "hard", label: "سخت", budgetClass: "high" },
  { max: 20, key: "very_hard", label: "خیلی سخت", budgetClass: "high" },
];

function normTier(tier) {
  const t = Math.floor(Number(tier));
  return t >= 1 && t <= 4 ? t : 1;
}

// ── Snapshot ─────────────────────────────────────────────────────────────
// status: Unrolled | Rolled | Cleared | Dormant (Dormant رزرو است)
// null یا ناشناخته = Unrolled (مکان‌های قدیمی)
export function readSnapshot(raw) {
  const s = raw && typeof raw === "object" ? raw : null;
  if (!s || !["Unrolled", "Rolled", "Cleared", "Dormant"].includes(s.status)) {
    return {
      status: "Unrolled",
      resetCount: 0,
      composition: [],
      engaged: false,
      awareness: "unaware",
    };
  }
  return {
    status: s.status,
    band: s.band ?? null,
    difficulty: s.difficulty ?? null,
    d20: s.d20 ?? null,
    dl: s.dl ?? null,
    composition: Array.isArray(s.composition) ? s.composition : [],
    engaged: !!s.engaged,
    awareness: s.awareness === "noticed" ? "noticed" : "unaware",
    noticeMode: s.noticeMode ?? null,
    outcome: s.outcome ?? null,
    empty: !!s.empty,
    rolledHour: s.rolledHour ?? null,
    lastCleared: s.lastCleared ?? null,
    resetCount: Number(s.resetCount) || 0,
  };
}

// آیا زمان Reset مکان Cleared رسیده؟ (ساعت جهان)
export function isResetDue(snapshot, tier, nowHour) {
  const s = readSnapshot(snapshot);
  if (s.status !== "Cleared" || s.lastCleared == null) return false;
  return nowHour - s.lastCleared >= RESET_DAYS[normTier(tier)] * 24;
}

// Cleared → Unrolled؛ شمارندهٔ Reset یکی بیشتر می‌شود (اولین تاس بعدش سقف دارد)
export function applyReset(snapshot) {
  const s = readSnapshot(snapshot);
  return {
    status: "Unrolled",
    resetCount: s.resetCount + 1,
    lastCleared: s.lastCleared,
  };
}

// ── Roll Gate ────────────────────────────────────────────────────────────
// خروجی: { action: "skip"|"reuse"|"roll", reason, snapshot }
// snapshot همان وضعیت مؤثر است (بعد از Reset اگر وقتش رسیده باشد)
export function decideGate({ hostility, snapshot, inCombat, tier, nowHour }) {
  let snap = readSnapshot(snapshot);
  if (inCombat) return { action: "skip", reason: "in_combat", snapshot: snap };
  if (!hostility || hostility === "none") {
    return { action: "skip", reason: "no_hostility", snapshot: snap };
  }
  if (isResetDue(snap, tier, nowHour)) snap = applyReset(snap);
  if (snap.status === "Unrolled")
    return { action: "roll", reason: "unrolled", snapshot: snap };
  return { action: "reuse", reason: snap.status.toLowerCase(), snapshot: snap };
}

// تاس d20 و تیربندی؛ rng(max) عدد ۱..max برمی‌گرداند (برای تست قابل‌تعویض)
export function rollDifficulty(
  hostility,
  resetCount,
  rng = (n) => 1 + Math.floor(Math.random() * n),
) {
  const d20 = rng(20);
  const row = DIFFICULTY_TABLE.find((r) => d20 <= r.max);
  let key = row.key;
  let budgetClass = row.budgetClass;
  let empty = false;
  // low: بازهٔ «ساده» می‌تواند خالی باشد؛ high: «ساده» به «متوسط» ارتقا می‌یابد
  if (key === "easy" && hostility === "low") empty = true;
  if (key === "easy" && hostility === "high") {
    key = "medium";
    budgetClass = "moderate";
  }
  // اولین تاس بعد از اولین Reset حداکثر Moderate است
  let capped = false;
  if (resetCount === 1 && budgetClass === "high") {
    budgetClass = "moderate";
    capped = true;
  }
  const label = DIFFICULTY_TABLE.find((r) => r.key === key).label;
  return { d20, difficulty: key, label, budgetClass, empty, capped };
}

// ── استخر هیولا (فیلتر محیط با Fallback + فیلتر Rank) ─────────────────────
export function enemyPool(tier, environments, budgetClass) {
  const base = menuForTier(tier);
  const envs = Array.isArray(environments) ? environments : [];
  let pool = base;
  let fallback = false;
  if (envs.length > 0) {
    const filtered = base.filter((m) =>
      m.environments?.some((e) => envs.includes(e)),
    );
    if (filtered.length >= MIN_POOL_AFTER_ENV) pool = filtered;
    else fallback = true;
  }
  // کلاس Low: حریف ضعیف (minion)؛ اگر نبود همان استخر
  if (budgetClass === "low") {
    const minions = pool.filter((m) => m.rank === "minion");
    if (minions.length > 0) pool = minions;
  }
  return { pool, fallback };
}

// منوی شماره‌دار برای AI و تبدیل شماره ← ردیف
export function poolMenuText(pool) {
  return pool.map((m, i) => `${i + 1}) ${m.fa}`).join("\n");
}
export function poolByIndex(pool, index) {
  const n = Number(index);
  if (!Number.isInteger(n) || n < 1 || n > pool.length) return null;
  return pool[n - 1];
}

// ── ساخت Snapshot ────────────────────────────────────────────────────────
// roll = خروجی rollDifficulty؛ entry و count بعد از انتخاب AI و clampCount می‌آیند
export function snapshotAfterRoll({
  roll,
  entry,
  count,
  pp = null,
  tier,
  resetCount,
  nowHour,
}) {
  if (roll.empty || !entry) {
    return {
      status: "Cleared",
      band: roll.budgetClass,
      difficulty: roll.difficulty,
      d20: roll.d20,
      dl: normTier(tier),
      composition: [],
      engaged: false,
      awareness: "unaware",
      empty: true,
      rolledHour: nowHour,
      lastCleared: nowHour,
      resetCount,
    };
  }
  return {
    status: "Rolled",
    band: roll.budgetClass,
    difficulty: roll.difficulty,
    d20: roll.d20,
    dl: normTier(tier),
    composition: [{ key: entry.key, count, pp }],
    engaged: false,
    awareness: "unaware",
    empty: false,
    rolledHour: nowHour,
    lastCleared: null,
    resetCount,
  };
}

// نبرد شروع شد (دکمه‌ها/دور نبرد) ← دیگر «در انتظار» نیست
export function markEngaged(snapshot) {
  return { ...readSnapshot(snapshot), engaged: true };
}

// دشمن‌ها کشته یا فراری شدند ← Cleared
// outcome: «cleared» الان؛ V11 مقدارهای captured / fled / surrendered را می‌دهد
export function markCleared(snapshot, nowHour, outcome = "cleared") {
  return {
    ...readSnapshot(snapshot),
    status: "Cleared",
    composition: [],
    engaged: false,
    awareness: "unaware",
    noticeMode: null,
    outcome,
    lastCleared: nowHour,
  };
}

// دشمنِ در انتظارِ شروع (Rolled و هنوز engaged نشده)
export function pendingEncounter(snapshot) {
  const s = readSnapshot(snapshot);
  if (s.status !== "Rolled" || s.engaged || s.composition.length === 0)
    return null;
  return s.composition;
}

// ── Cooldown ─────────────────────────────────────────────────────────────
// last = { round, worldHour } یا null؛ فعال = هم کمتر از ۱ ساعت و هم کمتر از ۳ دور
export function cooldownActive(last, nowHour, nowRound) {
  if (!last || last.worldHour == null || last.round == null) return false;
  return (
    nowHour - last.worldHour < COOLDOWN_HOURS &&
    nowRound - last.round < COOLDOWN_ROUNDS
  );
}

// ── انتخاب دشمن با AI (فقط شماره از فهرست بسته) ──────────────────────────
const defaultRng = (n) => 1 + Math.floor(Math.random() * n);

// AI یک شماره از استخر می‌دهد؛ دو تلاش؛ بعد انتخاب تصادفیِ کد (دور هرگز گیر نمی‌کند)
export async function pickEnemy({
  location,
  pool,
  forceProvider = null,
  rng = defaultRng,
}) {
  let note = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await generateNarration(
        "encounter_picker",
        [
          {
            role: "user",
            content:
              `مکان: ${location.name} — ${location.theme || ""}\n\n` +
              `فهرست دشمن‌های مجاز:\n${poolMenuText(pool)}${note}\n\nانتخاب کن.`,
          },
        ],
        forceProvider,
        { temperature: 0.5, jsonMode: true },
      );
      const data = parseJson(raw);
      const entry = poolByIndex(pool, data?.monster);
      if (entry) {
        return {
          entry,
          requested: Number(data?.count) || 1,
          aiFallback: false,
        };
      }
      note =
        "\n\nشماره‌ی قبلی تو در فهرست نبود. فقط یکی از شماره‌های فهرست را بده.";
    } catch (err) {
      console.warn("⚠️  Encounter: خروجی AI معتبر نبود:", err.message);
      note =
        "\n\nپاسخ قبلی JSON معتبر نبود. فقط یک JSON با monster و count بده.";
    }
  }
  return { entry: pool[rng(pool.length) - 1], requested: 2, aiFallback: true };
}

// ادراک غیرفعال هیولا از Open5e (یک بار هنگام تاس)؛ شکست = null (بعداً ۱۰ حساب می‌شود)
async function defaultFetchPp(key) {
  try {
    const m = await fetchMonsterByKey(key);
    return Number.isFinite(m?.pp) ? m.pp : null;
  } catch (err) {
    console.warn("⚠️  Encounter: ادراک غیرفعال گرفته نشد:", err.message);
    return null;
  }
}

// ── Plan دروازه برای مکان تازه‌ی سفر (بدون نوشتن در دیتابیس) ────────────────
// خروجی: null (سفر نبوده) یا { snapshot, info }
// snapshot روی مکان در COMMIT نوشته می‌شود؛ info برای trace و /why در Plan می‌ماند
export async function planEncounter({
  travel,
  partyLevels = [1],
  inCombat = false,
  forceProvider = null,
  rng = defaultRng,
  fetchPp = defaultFetchPp,
}) {
  if (!travel?.traveled) return null;
  const loc = travel.location;
  const nowHour = travel.arrivalHour ?? 0;
  // مکانِ تازهِ سفر همیشه Unrolled است (سفر هر بار مکان تازه می‌سازد)
  const gate = decideGate({
    hostility: loc.hostility,
    snapshot: null,
    inCombat,
    tier: loc.tier,
    nowHour,
  });
  if (gate.action !== "roll") {
    return {
      snapshot: null,
      info: { action: gate.action, reason: gate.reason },
    };
  }

  const roll = rollDifficulty(loc.hostility, gate.snapshot.resetCount);
  let entry = null;
  let count = 0;
  let pp = null;
  let poolInfo = { size: 0, envFallback: false, aiFallback: false };
  if (!roll.empty) {
    const { pool, fallback } = enemyPool(
      loc.tier,
      loc.environments,
      roll.budgetClass,
    );
    const pick = await pickEnemy({ location: loc, pool, forceProvider, rng });
    entry = pick.entry;
    count = clampCount(entry, pick.requested, partyLevels, roll.budgetClass);
    pp = await fetchPp(entry.key);
    poolInfo = {
      size: pool.length,
      envFallback: fallback,
      aiFallback: pick.aiFallback,
    };
  }
  const snapshot = snapshotAfterRoll({
    roll,
    entry,
    count,
    pp,
    tier: loc.tier,
    resetCount: gate.snapshot.resetCount,
    nowHour,
  });
  return {
    snapshot,
    info: {
      action: "roll",
      reason: gate.reason,
      d20: roll.d20,
      difficulty: roll.difficulty,
      band: roll.budgetClass,
      empty: roll.empty,
      capped: roll.capped,
      monsterKey: entry?.key ?? null,
      count,
      ...poolInfo,
    },
  };
}

// ── یادداشت راوی: فقط «نشانه»؛ بدون تعداد، سختی، تاس یا خصومت ───────────────
export function encounterNarratorNote(snapshot) {
  const comp = pendingEncounter(snapshot);
  if (!comp) return "";
  const names = comp
    .map((c) => COMBAT_MENU.find((m) => m.key === c.key)?.fa)
    .filter(Boolean);
  if (names.length === 0) return "";
  return (
    `\n\nنشانه‌های دور از دید: در اطراف این مکان آثاری از حضور ${names.join(" و ")} دیده می‌شود ` +
    "(ردپا، صدا، بو یا اثر زندگی‌شان). فقط همین نشانه را در یک جمله‌ی کوتاه بنویس؛ " +
    "خود موجودات را وارد صحنه نکن، حمله یا نبرد نشان نده و تعداد یا قدرتشان را نگو."
  );
}

// ── تاس توجه: آیا دشمنِ ناشناخته گروه را حس می‌کند؟ ──────────────────────────
// کدمحور و بدون تاس تازه: ادراک غیرفعال هیولا (+ حس) در برابر مخفی‌کاری گروه
export const SENSE_RULES = {
  scent: { bonus: 5, label: "بو" },
  hearing: { bonus: 3, label: "شنوایی" },
  sight: { bonus: 0, label: "دید" },
  web: { dc: 12, label: "تار" }, // تار: DC ثابت؛ ادراک هیولا اهمیتی ندارد
};
const DEFAULT_PP = 10;

// مخفی‌کاری گروه: کمترین مجموع چک‌های Stealth همین دور؛ اگر کسی Stealth نزده، ۱۰ + کمترین مودیفایر چابکی
export function groupStealth(checkResults, dexMods) {
  const stealth = (checkResults || []).filter(
    (r) => r.skill === "Stealth" && Number.isFinite(r.total),
  );
  if (stealth.length > 0) {
    return {
      value: Math.min(...stealth.map((r) => r.total)),
      source: "checked",
    };
  }
  const mods = Array.isArray(dexMods) && dexMods.length > 0 ? dexMods : [0];
  return { value: 10 + Math.min(...mods), source: "passive" };
}

// نتیجه‌ی null یعنی تاس لازم نیست (دشمن در انتظار نیست یا قبلاً مطلع شده)
export function noticeRoll({ snapshot, checkResults, dexMods }) {
  const s = readSnapshot(snapshot);
  if (!pendingEncounter(s) || s.awareness === "noticed") return null;
  let best = null;
  for (const c of s.composition) {
    const entry = COMBAT_MENU.find((m) => m.key === c.key);
    if (!entry) continue;
    const rule = SENSE_RULES[entry.senses] || SENSE_RULES.sight;
    const score = rule.dc ?? (c.pp ?? DEFAULT_PP) + rule.bonus;
    if (!best || score > best.score)
      best = { entry, score, sense: entry.senses };
  }
  if (!best) return null;
  const stealth = groupStealth(checkResults, dexMods);
  const noticed = stealth.value < best.score;
  return {
    noticed,
    // انسان‌نما ← فقط رودررو (Sighting)؛ بقیه ← حمله
    mode: noticed ? (best.entry.negotiable ? "sighting" : "attack") : null,
    sense: best.sense,
    enemyScore: best.score,
    groupStealth: stealth.value,
    source: stealth.source,
    monsterKey: best.entry.key,
  };
}

// مطلع‌شدن دشمن (در COMMIT همان دور روی مکان نوشته می‌شود)
export function markNoticed(snapshot, mode) {
  return { ...readSnapshot(snapshot), awareness: "noticed", noticeMode: mode };
}

// نبرد باید شروع شود؟ (دشمن در انتظار، مطلع‌شده، و از نوع حمله)
export function shouldStartCombat(snapshot) {
  const s = readSnapshot(snapshot);
  return (
    !!pendingEncounter(s) &&
    s.awareness === "noticed" &&
    s.noticeMode === "attack"
  );
}

// یادداشت راوی برای دورِ مطلع‌شدن (بدون عدد، سختی یا اصطلاح فنی)
export function noticeNarratorNote(notice, snapshot) {
  if (!notice?.noticed) return "";
  const comp = pendingEncounter(snapshot) || [];
  const names = comp
    .map((c) => COMBAT_MENU.find((m) => m.key === c.key)?.fa)
    .filter(Boolean)
    .join(" و ");
  if (!names) return "";
  if (notice.mode === "sighting") {
    return (
      `\n\nدشمن گروه را دید: ${names} متوجه حضور گروه شده‌اند و رودررو شده‌اند، ولی هنوز حمله نکرده‌اند. ` +
      "این لحظه‌ی مواجهه را بنویس؛ بازیکن‌ها باید تصمیم بگیرند. درگیری یا حمله را خودت شروع نکن."
    );
  }
  const how =
    notice.sense === "scent"
      ? "با بو گروه را پیدا کرده‌اند"
      : notice.sense === "web"
        ? "لرزش تار خبر حضور گروه را به آن‌ها داده"
        : notice.sense === "hearing"
          ? "صدای گروه را شنیده‌اند"
          : "گروه را دیده‌اند";
  return (
    `\n\nدشمن گروه را حس کرد: ${names} ${how} و به سمتشان می‌آیند. ` +
    "فقط نزدیک‌شدن و تهدید را بنویس؛ هنوز درگیری را شروع نکن."
  );
}

// ── ادامهٔ قدم ۷: حضور دشمن در دورها و شروع نبرد از Snapshot ─────────────────
// یادداشت پایدار راوی برای مکانی که دشمن در انتظار دارد (هر دور، تا نبرد یا پاک‌شدن)
export function presenceNote(snapshot, notice = null) {
  if (notice?.noticed) return noticeNarratorNote(notice, snapshot);
  const s = readSnapshot(snapshot);
  if (!pendingEncounter(s)) return "";
  if (s.awareness === "noticed") {
    const entry = COMBAT_MENU.find((m) => m.key === s.composition[0]?.key);
    return noticeNarratorNote(
      { noticed: true, mode: s.noticeMode, sense: entry?.senses },
      snapshot,
    );
  }
  return encounterNarratorNote(snapshot);
}

// ورودی و تعداد دشمن از Snapshot (برای نبردی که Resolver یا مطلع‌شدن شروع می‌کند)
export function snapshotCombat(snapshot) {
  const comp = pendingEncounter(snapshot);
  if (!comp) return null;
  const entry = COMBAT_MENU.find((m) => m.key === comp[0].key);
  if (!entry) return null;
  return { entry, count: Math.max(1, Number(comp[0].count) || 1) };
}

const HOW_REASON = {
  scent: "با بو گروه را پیدا کردند",
  web: "با لرزش تار گروه را پیدا کردند",
  hearing: "صدای گروه را شنیدند",
  sight: "گروه را دیدند",
};

// تصمیم نبرد ساختگی (بدون Resolver) وقتی دشمن مطلع‌شده و نوبتش رسیده
export function combatDecisionFromSnapshot(snapshot) {
  const c = snapshotCombat(snapshot);
  if (!c) return null;
  const how = HOW_REASON[c.entry.senses] || HOW_REASON.sight;
  return {
    checks: [],
    blocked: [],
    skipped: [],
    autos: [],
    helps: [],
    moved: false,
    rest: null,
    combat: {
      entry: c.entry,
      count: c.count,
      reason: `${c.entry.fa} که ${how}، به گروه رسیدند و حمله کردند`,
    },
    fromSnapshot: true,
  };
}

// بعد از پیروزی: Snapshot مکانی که نبردش از همین دشمن‌ها شروع شده ← Cleared (وگرنه null: دست نزن)
export function victorySnapshotUpdate(
  snapshot,
  worldHour,
  outcome = "cleared",
) {
  const s = readSnapshot(snapshot);
  if (s.status !== "Rolled" || !s.engaged) return null;
  return markCleared(s, worldHour, outcome);
}

// ── نمایش و بازپخش (V10 قدم ۹): فقط برای /why و /replay صاحب بات (DM-Only) ──────
const monsterFa = (key) =>
  COMBAT_MENU.find((m) => m.key === key)?.fa || key || "—";

// خط‌های «دلیل» نتیجه‌ی Roll Gate یک سفر
export function gateWhyLines(info) {
  if (!info) return [];
  if (info.action !== "roll") {
    const why =
      info.reason === "no_hostility"
        ? "خصومت مکان none است"
        : info.reason === "in_combat"
          ? "نبرد در جریان بود"
          : info.reason;
    return [`Roll Gate: رد شد (${why})`];
  }
  const label =
    DIFFICULTY_TABLE.find((r) => r.key === info.difficulty)?.label ||
    info.difficulty;
  const result = info.empty
    ? "خالی (دشمنی نیامد)"
    : `${monsterFa(info.monsterKey)} ×${info.count}`;
  const notes = [
    info.capped ? "سقف بعد از Reset" : null,
    info.envFallback ? "فیلتر محیط کنار رفت" : null,
    info.aiFallback ? "AI معتبر نبود؛ انتخاب با کد" : null,
  ].filter(Boolean);
  return [
    `Roll Gate [GATE_ROLL]: d20=${info.d20} ← ${label} | کلاس بودجه ${info.band} | ${result} | استخر ${info.size} هیولا${notes.length ? ` (${notes.join("، ")})` : ""}`,
  ];
}

// خط‌های «دلیل» تاس توجه
export function noticeWhyLines(notice) {
  if (!notice) return [];
  const senseFa = SENSE_RULES[notice.sense]?.label || notice.sense || "—";
  const src =
    notice.source === "checked" ? "چک Stealth" : "پیش‌فرض (۱۰ + چابکی)";
  const verdict = notice.noticed
    ? `مطلع شد (${notice.mode === "sighting" ? "رودررو" : "حمله"})`
    : "ناشناخته ماند";
  return [
    `تاس توجه: مخفی‌کاری گروه ${notice.groupStealth} (${src}) در برابر امتیاز دشمن ${notice.enemyScore} (${senseFa}، ${monsterFa(notice.monsterKey)}) ← ${verdict}`,
  ];
}

// موردهای /replay: همه از مقدارهای ذخیره‌شده در Plan دوباره حساب می‌شوند (بدون تاس تازه)
export function replayEncounterItems(plan) {
  const items = [];
  const ok = (text) => items.push({ s: "ok", text });
  const diff = (text) => items.push({ s: "diff", text });
  const skip = (text) => items.push({ s: "skip", text });
  const enc = plan?.encounter;
  const loc = plan?.travel?.location;

  if (plan?.travel?.traveled) {
    if (!enc) {
      skip("Roll Gate: Plan قبل از V10 است");
    } else if (enc.action !== "roll") {
      ok(`Roll Gate: رد شد (${enc.reason})`);
    } else {
      const snap = readSnapshot(loc?.hostileSnapshot);
      const exp = rollDifficulty(
        loc?.hostility,
        snap.resetCount,
        () => enc.d20,
      );
      const problems = [];
      if (exp.difficulty !== enc.difficulty)
        problems.push(
          `بازه: انتظار ${exp.difficulty}، ثبت‌شده ${enc.difficulty}`,
        );
      if (exp.budgetClass !== enc.band)
        problems.push(
          `کلاس بودجه: انتظار ${exp.budgetClass}، ثبت‌شده ${enc.band}`,
        );
      if (!!exp.empty !== !!enc.empty)
        problems.push(`خالی‌بودن: انتظار ${exp.empty}، ثبت‌شده ${enc.empty}`);
      const comp = snap.composition[0];
      if (enc.empty) {
        if (snap.status !== "Cleared")
          problems.push("نتیجه خالی بود ولی Snapshot Cleared نیست");
      } else if (
        !comp ||
        comp.key !== enc.monsterKey ||
        comp.count !== enc.count
      ) {
        problems.push("ترکیب Snapshot با نتیجه‌ی Gate یکی نیست");
      }
      if (problems.length === 0)
        ok(
          `Roll Gate: d20=${enc.d20} ← ${enc.difficulty}، کلاس ${enc.band}${enc.empty ? "، خالی" : `، ${monsterFa(enc.monsterKey)} ×${enc.count}`}`,
        );
      else for (const p of problems) diff(`Roll Gate — ${p}`);
    }
  }

  const n = plan?.notice;
  if (n) {
    const problems = [];
    const expNoticed = n.groupStealth < n.enemyScore;
    if (expNoticed !== !!n.noticed)
      problems.push(`مطلع‌شدن: انتظار ${expNoticed}، ثبت‌شده ${n.noticed}`);
    const entry = COMBAT_MENU.find((m) => m.key === n.monsterKey);
    const expMode = expNoticed
      ? entry?.negotiable
        ? "sighting"
        : "attack"
      : null;
    if (entry && expMode !== (n.mode ?? null))
      problems.push(`حالت: انتظار ${expMode}، ثبت‌شده ${n.mode}`);
    if (problems.length === 0)
      ok(
        `تاس توجه: ${n.groupStealth} در برابر ${n.enemyScore} ← ${n.noticed ? "مطلع" : "ناشناخته"}`,
      );
    else for (const p of problems) diff(`تاس توجه — ${p}`);
  }
  return items;
}
