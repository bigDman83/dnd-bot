// فهرست بسته‌ی هیولاهای مجاز برای نبرد.
// قانون مرکزی: AI فقط «شماره» از این فهرست را انتخاب می‌کند، نه اسم هیولا.
// key = شناسه‌ی دقیق Open5e (SRD 2024)، xp = XP هیولا، grade = درجه‌ی زیرکی (۱ وحشی، ۲ معمولی، ۳ زیرک)،
// minTier = کمترین سطح مکانی که این هیولا در آن ظاهر می‌شود.
export const COMBAT_MENU = [
  // سطح ۱ (سختی «کم»)
  {
    key: "srd-2024_jackal",
    type: "beast",
    rank: "minion",
    environments: ["plains", "desert"],
    negotiable: false,
    lastingEffect: "none",
    senses: "scent",
    fa: "شغال",
    xp: 0,
    grade: 1,
    minTier: 1,
  },
  {
    key: "srd-2024_goblin-minion",
    type: "humanoid",
    rank: "minion",
    environments: ["forest", "mountain", "dungeon"],
    negotiable: true,
    lastingEffect: "none",
    senses: "sight",
    fa: "گابلین کوچک",
    xp: 25,
    grade: 2,
    minTier: 1,
  },
  {
    key: "srd-2024_kobold-warrior",
    type: "humanoid",
    rank: "minion",
    environments: ["dungeon", "mountain", "ruins"],
    negotiable: true,
    lastingEffect: "none",
    senses: "sight",
    fa: "کوبولد جنگجو",
    xp: 25,
    grade: 2,
    minTier: 1,
  },
  {
    key: "srd-2024_bandit",
    type: "humanoid",
    rank: "minion",
    environments: ["plains", "forest", "urban", "mountain"],
    negotiable: true,
    lastingEffect: "none",
    senses: "sight",
    fa: "راهزن",
    xp: 25,
    grade: 2,
    minTier: 1,
  },
  {
    key: "srd-2024_cultist",
    type: "humanoid",
    rank: "minion",
    environments: ["urban", "ruins", "dungeon"],
    negotiable: true,
    lastingEffect: "none",
    senses: "sight",
    fa: "فرقه‌گرا",
    xp: 25,
    grade: 2,
    minTier: 1,
  },
  {
    key: "srd-2024_guard",
    type: "humanoid",
    rank: "minion",
    environments: ["urban", "plains"],
    negotiable: true,
    lastingEffect: "none",
    senses: "sight",
    fa: "نگهبان",
    xp: 25,
    grade: 2,
    minTier: 1,
  },
  {
    key: "srd-2024_warrior-infantry",
    type: "humanoid",
    rank: "minion",
    environments: ["urban", "plains"],
    negotiable: true,
    lastingEffect: "none",
    senses: "sight",
    fa: "سرباز پیاده",
    xp: 25,
    grade: 2,
    minTier: 1,
  },
  {
    key: "srd-2024_wolf",
    type: "beast",
    rank: "standard",
    environments: ["forest", "snow", "mountain", "plains"],
    negotiable: false,
    lastingEffect: "none",
    senses: "scent",
    fa: "گرگ",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  {
    key: "srd-2024_skeleton",
    type: "undead",
    rank: "standard",
    environments: ["ruins", "dungeon"],
    negotiable: false,
    lastingEffect: "none",
    senses: "sight",
    fa: "اسکلت",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  {
    key: "srd-2024_zombie",
    type: "undead",
    rank: "standard",
    environments: ["ruins", "dungeon", "swamp"],
    negotiable: false,
    lastingEffect: "none",
    senses: "sight",
    fa: "زامبی",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  {
    key: "srd-2024_panther",
    type: "beast",
    rank: "standard",
    environments: ["forest", "mountain"],
    negotiable: false,
    lastingEffect: "none",
    senses: "scent",
    fa: "پلنگ",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  {
    key: "srd-2024_grimlock",
    type: "humanoid",
    rank: "standard",
    environments: ["dungeon", "ruins"],
    negotiable: true,
    lastingEffect: "none",
    senses: "hearing",
    fa: "گریملاک",
    xp: 50,
    grade: 2,
    minTier: 1,
  },
  {
    key: "srd-2024_axe-beak",
    type: "beast",
    rank: "standard",
    environments: ["plains", "forest"],
    negotiable: false,
    lastingEffect: "none",
    senses: "sight",
    fa: "پرنده‌ی منقار‌تبر",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  {
    key: "srd-2024_giant-centipede",
    type: "beast",
    rank: "standard",
    environments: ["dungeon", "forest", "ruins", "swamp"],
    negotiable: false,
    lastingEffect: "none",
    senses: "hearing",
    fa: "هزارپای غول‌پیکر",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  {
    key: "srd-2024_boar",
    type: "beast",
    rank: "standard",
    environments: ["forest", "plains"],
    negotiable: false,
    lastingEffect: "none",
    senses: "scent",
    fa: "گراز وحشی",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  {
    key: "srd-2024_giant-badger",
    type: "beast",
    rank: "standard",
    environments: ["forest", "plains"],
    negotiable: false,
    lastingEffect: "none",
    senses: "scent",
    fa: "گورکن غول‌پیکر",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  {
    key: "srd-2024_goblin-warrior",
    type: "humanoid",
    rank: "standard",
    environments: ["forest", "mountain", "dungeon"],
    negotiable: true,
    lastingEffect: "none",
    senses: "sight",
    fa: "گابلین جنگجو",
    xp: 50,
    grade: 2,
    minTier: 1,
  },
  {
    key: "srd-2024_giant-wolf-spider",
    type: "beast",
    rank: "standard",
    environments: ["forest", "dungeon", "swamp", "ruins"],
    negotiable: false,
    lastingEffect: "none",
    senses: "web",
    fa: "عنکبوت گرگ‌نمای غول‌پیکر",
    xp: 50,
    grade: 1,
    minTier: 1,
  },
  // سطح ۲ به بالا (سختی «متوسط» و «زیاد»)
  {
    key: "srd-2024_tough",
    type: "humanoid",
    rank: "standard",
    environments: ["urban", "plains"],
    negotiable: true,
    lastingEffect: "none",
    senses: "sight",
    fa: "قلدر خیابانی",
    xp: 100,
    grade: 2,
    minTier: 2,
  },
  {
    key: "srd-2024_gnoll-warrior",
    type: "humanoid",
    rank: "standard",
    environments: ["plains", "desert"],
    negotiable: true,
    lastingEffect: "none",
    senses: "scent",
    fa: "گنول جنگجو",
    xp: 100,
    grade: 2,
    minTier: 2,
  },
  {
    key: "srd-2024_hobgoblin-warrior",
    type: "humanoid",
    rank: "standard",
    environments: ["plains", "mountain", "dungeon"],
    negotiable: true,
    lastingEffect: "none",
    senses: "sight",
    fa: "هابگابلین جنگجو",
    xp: 100,
    grade: 3,
    minTier: 2,
  },
];

// بودجه‌ی XP هر شخصیت بر اساس «کلاس بودجه» و «سطح خودش» (جدول رسمی Low/Moderate/High)
// سطح‌های بالاتر از ۵ فعلاً با سطح ۵ حساب می‌شن (Level Up هنوز نیست)؛ بعداً از منبع رسمی پر شود
export const BUDGET_CLASSES = ["low", "moderate", "high"];
const BUDGET_BY_LEVEL = {
  1: { low: 50, moderate: 75, high: 100 },
  2: { low: 100, moderate: 150, high: 200 },
  3: { low: 150, moderate: 225, high: 400 },
  4: { low: 250, moderate: 375, high: 500 },
  5: { low: 500, moderate: 750, high: 1100 },
};
const MAX_BUDGET_LEVEL = 5;

const MAX_GRADE = 3;
export const MAX_ENEMIES_ANON = 6; // سقف مطلق تعداد دشمن ساخته‌شده‌ی خودکار

function normTier(tier) {
  const t = Number(tier);
  return t >= 1 && t <= 4 ? Math.floor(t) : 1;
}

// نگاشت موقت سطح مکان ← کلاس بودجه (۱ ← Low، ۲ ← Moderate، ۳ و ۴ ← High)
// وقتی Roll Gate بیاید، کلاس از تاس می‌آید و این فقط برای مسیر Resolver می‌ماند
export function budgetClassForTier(tier) {
  const t = normTier(tier);
  return t === 1 ? "low" : t === 2 ? "moderate" : "high";
}

function levelOf(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_BUDGET_LEVEL);
}

// گروه کوچک‌تر از ۴ نفر بودجه‌ی کمتری می‌گیرد (جدول رسمی برای ۴ نفر است)
// انحراف آگاهانه از enemy.md: در V10 دیده شد سه گرگ برای دو نفر سطح ۱ کشنده است
export const FULL_PARTY_SIZE = 4;

// بودجه‌ی کل گروه = مجموع بودجه‌ی هر شخصیت (بر اساس سطح خودش) × min(۱، تعداد ÷ ۴)
export function partyBudget(levels, budgetClass) {
  const cls = BUDGET_CLASSES.includes(budgetClass) ? budgetClass : "low";
  const list = Array.isArray(levels) && levels.length > 0 ? levels : [1];
  const sum = list.reduce((s, lv) => s + BUDGET_BY_LEVEL[levelOf(lv)][cls], 0);
  return Math.floor(sum * Math.min(1, list.length / FULL_PARTY_SIZE));
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

// تعداد نهایی: نه بیشتر از خواسته‌ی AI، مجموع XP بیشتر از بودجه‌ی گروه نشود (حداقل ۱)، سقف ۶
// partyLevels = آرایه‌ی سطح شخصیت‌ها؛ budgetClass = low | moderate | high
export function clampCount(entry, requested, partyLevels, budgetClass) {
  const budget = partyBudget(partyLevels, budgetClass);
  const maxByBudget = Math.max(1, Math.floor(budget / xpFor(entry)));
  const want = Math.max(1, Math.floor(Number(requested) || 1));
  return Math.min(want, maxByBudget, MAX_ENEMIES_ANON);
}

// درجه‌ی زیرکی نهایی = درجه‌ی هیولا + ۱ اگر سطح مکان ۳ یا ۴ باشد، با سقف ۳
export function effectiveGrade(entry, tier) {
  const bonus = normTier(tier) >= 3 ? 1 : 0;
  return Math.min(MAX_GRADE, entry.grade + bonus);
}
