// فهرست بسته‌ی هیولاهای مجاز برای نبرد.
// قانون مرکزی: AI فقط «شماره» از این فهرست را انتخاب می‌کند، نه اسم هیولا.
// key = شناسه‌ی دقیق Open5e (SRD 2024)، xp = XP هیولا، grade = درجه‌ی زیرکی (۱ وحشی، ۲ معمولی، ۳ زیرک)،
// minTier = کمترین سطح مکانی که این هیولا در آن ظاهر می‌شود.
export const COMBAT_MENU = [
  // سطح ۱ (سختی «کم»)
  { key: "srd-2024_jackal", fa: "شغال", xp: 0, grade: 1, minTier: 1 },
  {
    key: "srd-2024_goblin-minion",
    fa: "گابلین کوچک",
    xp: 25,
    grade: 2,
    minTier: 1,
  },
  {
    key: "srd-2024_kobold-warrior",
    fa: "کوبولد جنگجو",
    xp: 25,
    grade: 2,
    minTier: 1,
  },
  { key: "srd-2024_bandit", fa: "راهزن", xp: 25, grade: 2, minTier: 1 },
  { key: "srd-2024_cultist", fa: "فرقه‌گرا", xp: 25, grade: 2, minTier: 1 },
  { key: "srd-2024_guard", fa: "نگهبان", xp: 25, grade: 2, minTier: 1 },
  {
    key: "srd-2024_warrior-infantry",
    fa: "سرباز پیاده",
    xp: 25,
    grade: 2,
    minTier: 1,
  },
  { key: "srd-2024_wolf", fa: "گرگ", xp: 50, grade: 1, minTier: 1 },
  { key: "srd-2024_skeleton", fa: "اسکلت", xp: 50, grade: 1, minTier: 1 },
  { key: "srd-2024_zombie", fa: "زامبی", xp: 50, grade: 1, minTier: 1 },
  { key: "srd-2024_panther", fa: "پلنگ", xp: 50, grade: 1, minTier: 1 },
  { key: "srd-2024_grimlock", fa: "گریملاک", xp: 50, grade: 2, minTier: 1 },
  {
    key: "srd-2024_axe-beak",
    fa: "پرنده‌ی منقار‌تبر",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  {
    key: "srd-2024_giant-centipede",
    fa: "هزارپای غول‌پیکر",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  { key: "srd-2024_boar", fa: "گراز وحشی", xp: 50, grade: 1, minTier: 1 },
  {
    key: "srd-2024_giant-badger",
    fa: "گورکن غول‌پیکر",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  {
    key: "srd-2024_goblin-warrior",
    fa: "گابلین جنگجو",
    xp: 50,
    grade: 2,
    minTier: 1,
  },
  {
    key: "srd-2024_giant-wolf-spider",
    fa: "عنکبوت گرگ‌نمای غول‌پیکر",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  // سطح ۲ به بالا (سختی «متوسط» و «زیاد»)
  { key: "srd-2024_tough", fa: "قلدر خیابانی", xp: 100, grade: 2, minTier: 2 },
  {
    key: "srd-2024_gnoll-warrior",
    fa: "گنول جنگجو",
    xp: 100,
    grade: 2,
    minTier: 2,
  },
  {
    key: "srd-2024_hobgoblin-warrior",
    fa: "هابگابلین جنگجو",
    xp: 100,
    grade: 3,
    minTier: 2,
  },
];

// بودجه‌ی XP به‌ازای هر بازیکن سطح ۱، بر اساس سطح مکان (کم / متوسط / زیاد)
const BUDGET_PER_PLAYER = { 1: 50, 2: 75, 3: 100, 4: 100 };

const MAX_GRADE = 3;
const MAX_ENEMIES = 6; // سقف مطلق تعداد دشمن (برای هیولاهای خیلی ضعیف)

function normTier(tier) {
  const t = Number(tier);
  return t >= 1 && t <= 4 ? Math.floor(t) : 1;
}

// XP هیولاهای CR صفر را ۱۰ حساب می‌کنیم تا تعدادشان بی‌نهایت نشود
export function xpFor(entry) {
  return Math.max(10, entry.xp || 0);
}

// فقط هیولاهایی که برای این سطح مکان مجازند
export function menuForTier(tier) {
  const t = normTier(tier);
  return COMBAT_MENU.filter((m) => m.minTier <= t);
}

// متن منوی شماره‌دار برای پرامپت Resolver (شماره از ۱ شروع می‌شود)
export function monsterMenuText(tier) {
  return menuForTier(tier)
    .map((m, i) => `${i + 1}) ${m.fa}`)
    .join("\n");
}

// شماره‌ی AI (از ۱) → ردیف منو؛ نامعتبر = null
export function monsterByIndex(tier, index) {
  const list = menuForTier(tier);
  const n = Number(index);
  if (!Number.isInteger(n) || n < 1 || n > list.length) return null;
  return list[n - 1];
}

// تعداد نهایی: نه بیشتر از خواسته‌ی AI، و مجموع XP بیشتر از بودجه‌ی گروه نشود (حداقل ۱)
export function clampCount(entry, requested, partySize, tier) {
  const budget = BUDGET_PER_PLAYER[normTier(tier)] * Math.max(1, partySize);
  const maxByBudget = Math.max(1, Math.floor(budget / xpFor(entry)));
  const want = Math.max(1, Math.floor(Number(requested) || 1));
  return Math.min(want, maxByBudget, MAX_ENEMIES);
}

// درجه‌ی زیرکی نهایی = درجه‌ی هیولا + ۱ اگر سطح مکان ۳ یا ۴ باشد، با سقف ۳
export function effectiveGrade(entry, tier) {
  const bonus = normTier(tier) >= 3 ? 1 : 0;
  return Math.min(MAX_GRADE, entry.grade + bonus);
}
