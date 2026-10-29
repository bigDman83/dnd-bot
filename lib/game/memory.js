// ---------- حافظه‌ی دور (Round Memory) — توابع خالص: بدون دیتابیس و بدون AI ----------
// ساخت ردیف حافظه‌ی هر دور از روی Plan، فرمت متن Context، فیلتر مخاطب و کلمات ممنوعه‌ی ضدتکرار.
// خواندن از دیتابیس در lib/game/context.js انجام میشه (این فایل به sdk وابسته نیست).

import { summarizeGroups } from "lib/core/groups";

export const MEMORY_KEEP = 10; // چند دور آخر نگه داشته میشه
export const MEMORY_IN_CONTEXT = 3; // چند دور آخر توی Context میره
export const NARRATIONS_FOR_BANS = 3; // کلمات ممنوعه از چند روایت آخر درمیاد
const MAX_BANNED = 5;
const MAX_ACTION_TEXTS = 2; // حداکثر چند شرح تلاش برای هر بازیکن توی خط «اقدام‌ها»

// درجه‌ی تاس رو به جمله‌ی ساده تبدیل می‌کنیم؛ اسم فنی درجه‌ها (مثل «موفقیت لب‌مرزی») هرگز به راوی نمی‌رسه
const OUTCOME_WORDS = {
  critFail: "سخت شکست خورد",
  fail: "ناموفق ماند",
  edge: "به‌زحمت موفق شد",
  success: "موفق شد",
  great: "عالی موفق شد",
};

// ---------- ساخت ردیف حافظه از Plan ----------
// هر عضو آرایه‌ها: { v: "group"|"private"|"hidden", t: "متن", owner?: tgId }
// الان همه‌ی Eventها group هستن؛ فیلد v از الان هست تا بعداً (اقدام مخفی، راز شخصی) نیاز به تغییر ساختار نباشه.

// notes: شرح‌های کوتاهی که خود AI از تلاش‌های این بازیکن نوشته (reason)، نه پیام خام بازیکن
function actionEntry(p, notes = []) {
  const kind = p.action?.kind;
  if (kind === "skip") return { v: "group", t: `${p.name}: فقط همراهی کرد` };
  if (kind === "suggestion") {
    // متن پیشنهاد رو خود AI نوشته (کوتاه و امنه)؛ پیام خام بازیکن هرگز ذخیره نمیشه
    return { v: "group", t: `${p.name}: ${p.action.content}` };
  }
  // متن آزاد: به‌جای «اقدام آزاد»، شرح کوتاه تحلیل‌شده‌ی AI (اگه بود)
  const texts = [...new Set(notes.filter(Boolean))].slice(0, MAX_ACTION_TEXTS);
  return {
    v: "group",
    t: texts.length
      ? `${p.name}: ${texts.join("؛ ")}`
      : `${p.name}: اقدام آزاد`,
  };
}

// دلیل «انجام نشد» به زبان ساده (بدون اصطلاح فنی)
function blockedWhy(b) {
  if (b.kind === "tool") return "ابزار لازم را نداشت";
  if (b.kind === "spell") return "اسپل را بلد نبود";
  if (b.why === "dead") return "شخصیتش مرده بود";
  if (b.why === "unconscious") return "بیهوش بود";
  if (b.why === "world_rule") return "این کار در این دنیا ممکن نبود";
  return "نتوانست انجام بدهد";
}

export function buildMemoryRow({
  state,
  checkResults = [],
  travel = null,
  restPlan = null,
  locationBefore = null, // اسم مکان قبل از این دور (یا null)
  worldHours = null, // ساعت جهان بعد از این دور
  blocked = [], // اقدام‌های ردشده (Plan: serializeBlocked)
  skipped = [], // مرحله‌های انجام‌نشده‌ی زنجیره (Plan: serializeSkipped)
  autos = [], // اقدام‌های بدون ریسک (Plan: serializeAutos)
  helps = [], // کمک‌های اثرگذار [{ helper, target }]
}) {
  // شرح تلاش‌های هر بازیکن از روی Plan (به اسم)
  const notesByName = new Map();
  const addNote = (name, text) => {
    if (!name || !text) return;
    if (!notesByName.has(name)) notesByName.set(name, []);
    notesByName.get(name).push(text);
  };
  for (const r of checkResults) addNote(r.name, r.reason);
  for (const b of blocked) addNote(b.name, b.text);
  for (const k of skipped) addNote(k.name, k.text);
  for (const a of autos) addNote(a.name, a.text);
  const actions = state.players.map((p) =>
    actionEntry(p, notesByName.get(p.name)),
  );

  // خط هر چک به همون ترتیب checkResults (/why با اندیس بهشون می‌رسه)
  const outcomes = checkResults.map((r) => {
    const what = r.reason || "تلاش";
    const vs = r.opponentLabel ? ` (در برابر ${r.opponentLabel})` : "";
    // عضو چک گروهی: نتیجه‌ی تکی فقط موفق/ناموفقه؛ نتیجه‌ی اصلی خط گروه پایینه
    if (r.groupId) {
      const word = r.margin >= 0 ? "موفق شد" : "ناموفق ماند";
      return { v: "group", t: `${r.name}: ${what} — ${word} (در تلاش گروهی)` };
    }
    const word = OUTCOME_WORDS[r.degree?.key] || OUTCOME_WORDS.success;
    return { v: "group", t: `${r.name}: ${what} — ${word}${vs}` };
  });
  for (const g of summarizeGroups(checkResults)) {
    const word = g.success ? "موفق شدند" : "ناموفق ماندند";
    outcomes.push({
      v: "group",
      t: `گروه (${g.members.join("، ")}) با هم${g.reason ? ` «${g.reason}»` : ""}: ${word} (${g.successes} از ${g.total} نفر)`,
    });
  }
  for (const b of blocked) {
    outcomes.push({
      v: "group",
      t: `${b.name}: ${b.text || "این کار"} — انجام نشد (${blockedWhy(b)})`,
    });
  }
  for (const k of skipped) {
    const t =
      k.why === "deferred"
        ? `${k.name}: ${k.text || "این کار"} — به دور بعد رفت`
        : `${k.name}: ${k.text || "این کار"} — انجام نشد چون مرحله‌ی قبلش موفق نشد`;
    outcomes.push({ v: "group", t });
  }
  for (const h of helps) {
    if (h.used !== false && h.helper && h.target) {
      outcomes.push({ v: "group", t: `${h.helper} به ${h.target} کمک کرد` });
    }
  }

  const changes = [];
  const newEntities = [];
  if (travel?.traveled) {
    const to = travel.location.name;
    changes.push({
      v: "group",
      t: locationBefore
        ? `گروه از «${locationBefore}» به «${to}» رفت (${travel.distanceLabel})`
        : `گروه به «${to}» رسید (${travel.distanceLabel})`,
    });
    newEntities.push({ v: "group", t: `مکان تازه: «${to}»` });
  }
  if (restPlan) {
    let t =
      restPlan.kind === "long"
        ? "گروه یک شب کامل استراحت کرد"
        : "گروه استراحت کوتاهی کرد";
    if (restPlan.downgraded) {
      t += " (استراحت طولانی ممکن نبود و فقط کوتاه شد)";
    }
    changes.push({ v: "group", t });
  }

  return {
    worldHours,
    location: travel?.traveled ? travel.location.name : locationBefore,
    actions,
    outcomes,
    changes,
    knowledgeDelivered: [], // تا V12 (NPC) خالیه
    newEntities,
  };
}

// ---------- فیلتر مخاطب (لایه‌های دانش، integration.md بخش 5.1) ----------
// audience: { kind: "group" } | { kind: "private", ownerId } | { kind: "npc", npcId }
//  group   → فقط خط‌های group
//  private → group + خط‌های private همون مالک
//  npc     → هیچ‌چیز از حافظه‌ی گروه (NPC فقط دانش خودش رو داره؛ از buildNpcContext میاد)
// خط‌های hidden هیچ‌وقت توی متن عادی نمیان؛ جدا برمی‌گردن برای بلوک «فقط اشاره‌ی غیرمستقیم»
export function splitByVisibility(lines, audience) {
  const visible = [];
  const dmOnly = [];
  if (!Array.isArray(lines) || audience?.kind === "npc") {
    return { visible, dmOnly };
  }
  for (const l of lines) {
    if (!l || typeof l.t !== "string") continue;
    if (l.v === "hidden") dmOnly.push(l.t);
    else if (l.v === "group") visible.push(l.t);
    else if (
      l.v === "private" &&
      audience?.kind === "private" &&
      l.owner === audience.ownerId
    ) {
      visible.push(l.t);
    }
  }
  return { visible, dmOnly };
}

// ---------- فرمت متن Context ----------
// rows: ردیف‌های round_memory (قدیمی‌ترین اول)؛ whenLabel(worldHours) → «روز ۲، عصر»
const SECTIONS = [
  ["actions", "اقدام‌ها"],
  ["outcomes", "نتیجه‌ها"],
  ["changes", "تغییرها"],
  ["newEntities", "تازه"],
  ["knowledgeDelivered", "دانشی که گفته شد"],
];

export function formatMemory(rows, audience, whenLabel = () => "") {
  const blocks = [];
  const dmOnly = [];
  for (const row of rows) {
    const head = [];
    const when = row.worldHours != null ? whenLabel(row.worldHours) : "";
    if (when) head.push(when);
    if (row.location) head.push(`مکان: ${row.location}`);
    const lines = [
      `دور ${row.round}${head.length ? ` (${head.join("، ")})` : ""}`,
    ];
    for (const [key, label] of SECTIONS) {
      const { visible, dmOnly: hid } = splitByVisibility(row[key], audience);
      dmOnly.push(...hid);
      if (visible.length) lines.push(`  ${label}: ${visible.join("؛ ")}`);
    }
    if (lines.length > 1) blocks.push(lines.join("\n"));
  }
  return {
    text: blocks.length
      ? `حافظه‌ی دورهای اخیر (قدیمی‌ترین اول؛ این‌ها قبلاً اتفاق افتاده و ثابت‌اند، تکرارشون نکن):\n${blocks.join("\n")}`
      : "",
    dmOnlyText: dmOnly.length
      ? `فقط برای تو (هرگز مستقیم نگو، حداکثر اشاره‌ی غیرمستقیم):\n${dmOnly.join("\n")}`
      : "",
  };
}

// ---------- ضدتکرار: کلمات حسی پرتکرار (narrator.md بخش 15؛ کدمحور، بدون AI) ----------
// فهرست بسته؛ exact یعنی کلمه‌ی کوتاه که فقط به‌صورت کامل (نه داخل کلمه‌ی دیگه، مثل «همه») تطبیق بخوره
const SENSORY_TERMS = [
  { t: "مه", exact: true },
  { t: "باد سرد" },
  { t: "سکوت" },
  { t: "سایه" },
  { t: "تاریکی" },
  { t: "نجوا" },
  { t: "زمزمه" },
  { t: "بوی نم" },
  { t: "سرما" },
  { t: "پژواک" },
  { t: "غبار" },
  { t: "خش خش" },
  { t: "طنین" },
  { t: "لرز" },
];

function normalizeFa(s) {
  return String(s || "")
    .replace(/\u200c/g, " ") // نیم‌فاصله
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ");
}

const NOT_LETTER = "[^\\u0600-\\u06FF]";

function termRegex({ t, exact }) {
  return new RegExp(`(^|${NOT_LETTER})${t}${exact ? `(${NOT_LETTER}|$)` : ""}`);
}

// narrations: متن چند روایت آخر (نیاز به ≥ ۲ روایت)؛ کلمه‌ای که توی حداقل ۲ روایت اومده ممنوع میشه
export function extractBannedWords(narrations) {
  const docs = (narrations || []).map(normalizeFa).filter(Boolean);
  if (docs.length < 2) return [];
  const found = [];
  for (const term of SENSORY_TERMS) {
    const re = termRegex(term);
    const n = docs.filter((d) => re.test(d)).length;
    if (n >= 2) found.push({ t: term.t, n });
  }
  found.sort((a, b) => b.n - a.n);
  return found.slice(0, MAX_BANNED).map((f) => f.t);
}

export function formatBannedLine(words) {
  return words.length
    ? `کلمات و عبارت‌هایی که در روایت‌های اخیر زیاد تکرار شده و این بار نباید بیاری: ${words.join("، ")}`
    : "";
}
