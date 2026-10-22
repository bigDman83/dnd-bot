import { DC_TABLE } from "lib/core/dndData";

// ---------- نوع اقدام‌ها و نقش ابزار (طراحی V07، بخش 6.1) ----------
// toolRole:
//   required = بدون ابزار → Missing Requirement (بدون تاس)
//   helpful  = بدون ابزار → چک با Disadvantage
//   none     = ابزار مطرح نیست
// alternatives: فهرست بستهٔ راه‌های جایگزین (راوی فقط همین‌ها را می‌تواند بگوید)

export const ACTION_TYPES = [
  {
    key: "lockpick",
    fa: "قفل‌گشایی",
    toolRole: "required",
    toolTag: "thieves_tools",
    alternatives: ["در را بشکن", "کلید را پیدا کن"],
  },
  {
    key: "disarm_trap",
    fa: "خنثی‌کردن تله",
    toolRole: "required",
    toolTag: "thieves_tools",
    alternatives: ["دورش بزن", "از دور فعالش کن"],
  },
  {
    key: "forge_document",
    fa: "جعل سند",
    toolRole: "required",
    toolTag: "forgery_kit",
    alternatives: ["از کسی بخواه", "سند اصلی را بدزد"],
  },
  {
    key: "climb",
    fa: "بالا رفتن",
    toolRole: "helpful",
    toolTag: "rope",
    alternatives: ["مسیر دیگر", "کمک هم‌تیمی"],
  },
  {
    key: "repair",
    fa: "تعمیر",
    toolRole: "helpful",
    toolTag: "repair_kit",
    alternatives: ["تعمیر موقت", "کمک بگیر"],
  },
  {
    key: "stabilize_wound",
    fa: "تثبیت زخم",
    toolRole: "helpful",
    toolTag: "healers_kit",
    alternatives: ["استراحت", "درمانگر پیدا کن"],
  },
  {
    key: "disguise",
    fa: "تغییر چهره",
    toolRole: "helpful",
    toolTag: "disguise_kit",
    alternatives: ["لباس عادی", "از سایه حرکت کن"],
  },
  {
    key: "scout",
    fa: "دیدبانی از دور",
    toolRole: "helpful",
    toolTag: "spyglass",
    alternatives: ["نزدیک‌تر شو", "از بالا ببین"],
  },
  {
    key: "navigate",
    fa: "مسیریابی",
    toolRole: "helpful",
    toolTag: "map",
    alternatives: ["از محلی بپرس", "ردیابی"],
  },
  {
    key: "make_fire",
    fa: "روشن‌کردن آتش",
    toolRole: "helpful",
    toolTag: "tinderbox",
    alternatives: ["از شعلهٔ موجود استفاده کن"],
  },
  // هر اقدام دیگری (دزدی جیب، مخفی‌کاری، شنا، صحبت‌کردن، ...)
  {
    key: "other",
    fa: "سایر اقدام‌ها (ابزار مطرح نیست)",
    toolRole: "none",
    toolTag: null,
    alternatives: [],
  },
];

export const DEFAULT_ACTION_INDEX = ACTION_TYPES.length - 1; // other

export function actionTypeByIndex(i) {
  const n = Number(i);
  if (!Number.isInteger(n) || n < 1 || n > ACTION_TYPES.length) return null;
  return ACTION_TYPES[n - 1];
}

export function buildActionTypeMenuText() {
  const lines = ACTION_TYPES.map((a, i) => `${i + 1}) ${a.fa}`).join("\n");
  return `فهرست نوع اقدام (برای هر اقدام شماره‌ی مناسب‌ترین نوع؛ اگه هیچ‌کدوم نبود شماره‌ی ${ACTION_TYPES.length}):\n${lines}`;
}

// ---------- لنگرهای DC (طراحی V07، بخش 9.1) ----------
export const DIFFICULTY_ANCHORS_FA = {
  veryEasy: "کار ساده، با ابزار مناسب، بدون فشار",
  easy: "کار روزمره‌ای که اندکی مهارت می‌خواهد",
  medium: "چالش واقعی برای آدم آموزش‌دیده",
  hard: "کار حرفه‌ای در شرایط بد",
  veryHard: "کار استثنایی",
  nearlyImpossible: "فقط با شانس یا مهارت افسانه‌ای",
};

// ---------- DC نهایی (طراحی V07، بخش 9.2) ----------
// DC = لنگر + تعدیل Tier (Tier 3 و 4: یک پله = +5)، سقف 30
export const DC_CAP = 30;
export const TIER_BONUS = 5;

export function finalDc(difficultyKey, tier = 1) {
  const base = DC_TABLE[difficultyKey];
  if (!Number.isFinite(base)) return null;
  const tierBonus = Number(tier) >= 3 ? TIER_BONUS : 0;
  const dc = Math.min(DC_CAP, base + tierBonus);
  return { base, tierBonus: dc - base, dc };
}
