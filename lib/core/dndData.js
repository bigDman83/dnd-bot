// داده‌های مرجع پایه‌ی D&D 2024 (SRD 5.2) — نسخه‌ی اول با چند گزینه‌ی محدود
// بعداً می‌شه گزینه‌های بیشتر (بربرین، بارد و...) رو اضافه کرد

export const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
export const ABILITY_FA = {
  STR: "قدرت",
  DEX: "چابکی",
  CON: "سرسختی",
  INT: "هوش",
  WIS: "خرد",
  CHA: "کاریزما",
};
export const ABILITY_STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

export function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

export const SPECIES = {
  human: {
    name: "انسان (Human)",
    traits: "یک مهارت اضافه + یک ویژگی داستانی متناسب با خاستگاه",
  },
  elf: {
    name: "الف (Elf)",
    traits:
      "دید در تاریکی ۶۰ فوت، مقاوم در برابر افسون‌شدن، به‌جای خواب کامل فقط چهار ساعت مراقبه می‌کنه",
  },
  dwarf: {
    name: "دورف (Dwarf)",
    traits:
      "دید در تاریکی ۶۰ فوت، مقاومت در برابر آسیب سمی، حس زمین‌شناسی زیرزمینی",
  },
  halfling: {
    name: "نیم‌قدی (Halfling)",
    traits:
      "شانس (رول ۱ روی تاس رو می‌تونه دوباره بندازه)، مقاوم در برابر ترس، رد شدن از کنار موجودات بزرگ‌تر",
  },
};

export const CLASSES = {
  fighter: {
    name: "جنگجو (Fighter)",
    hitDie: 10,
    primaryAbility: "STR",
    savingThrows: ["STR", "CON"],
    skillChoices: 2,
    skillList: [
      "Acrobatics",
      "Animal Handling",
      "Athletics",
      "History",
      "Insight",
      "Intimidation",
      "Perception",
      "Survival",
    ],
    startingEquipment: [
      "زره زنجیره‌ای (Chain Mail)",
      "شمشیر بلند (Longsword)",
      "سپر (Shield)",
      "کمان کوتاه + ۲۰ تیر",
    ],
  },
  wizard: {
    name: "جادوگر (Wizard)",
    hitDie: 6,
    primaryAbility: "INT",
    savingThrows: ["INT", "WIS"],
    skillChoices: 2,
    skillList: [
      "Arcana",
      "History",
      "Insight",
      "Investigation",
      "Medicine",
      "Religion",
    ],
    startingEquipment: [
      "چوبدستی جادویی (Quarterstaff)",
      "کتاب طلسم (Spellbook)",
      "کوله‌ی محقق",
    ],
  },
  rogue: {
    name: "دزد (Rogue)",
    hitDie: 8,
    primaryAbility: "DEX",
    savingThrows: ["DEX", "INT"],
    skillChoices: 4,
    skillList: [
      "Acrobatics",
      "Athletics",
      "Deception",
      "Insight",
      "Intimidation",
      "Investigation",
      "Perception",
      "Persuasion",
      "Sleight of Hand",
      "Stealth",
    ],
    startingEquipment: [
      "شمشیر کوتاه x۲ (Shortsword)",
      "کمان کوتاه",
      "ست ابزار دزدی (Thieves' Tools)",
      "زره چرمی (Leather Armor)",
    ],
    toolTags: ["thieves_tools"],
  },
  cleric: {
    name: "کشیش (Cleric)",
    hitDie: 8,
    primaryAbility: "WIS",
    savingThrows: ["WIS", "CHA"],
    skillChoices: 2,
    skillList: ["History", "Insight", "Medicine", "Persuasion", "Religion"],
    startingEquipment: [
      "گرز (Mace)",
      "زره زنجیره‌ای",
      "سپر",
      "نماد مقدس (Holy Symbol)",
    ],
  },
};

export const SKILL_DESC_FA = {
  Acrobatics: "حفظ تعادل، پشتک، فرار از گیر افتادن",
  "Animal Handling": "آروم‌کردن و کنترل حیوانات",
  Arcana: "دانش جادو، اسپل‌ها و موجودات جادویی",
  Athletics: "بالارفتن، شنا، پرش، کشتی‌گیری",
  Deception: "دروغ‌گفتن و فریب‌دادن باورپذیر",
  History: "دانش تاریخ، امپراتوری‌ها و جنگ‌های قدیم",
  Insight: "فهمیدن نیت واقعی و دروغ‌های دیگران",
  Intimidation: "ترسوندن یا تحت‌فشار گذاشتن کسی",
  Investigation: "پیداکردن سرنخ و نتیجه‌گیری منطقی",
  Medicine: "تشخیص بیماری، کمک‌های اولیه",
  Nature: "دانش گیاهان، حیوانات و آب‌وهوا",
  Perception: "متوجه‌شدن جزئیات، صدا یا خطر",
  Performance: "آواز، بازیگری، جلب‌توجه جمع",
  Persuasion: "قانع‌کردن کسی با منطق یا جذابیت",
  Religion: "دانش خدایان، آیین‌ها و اسطوره‌ها",
  "Sleight of Hand": "جیب‌بری، شعبده، کارهای دستی ظریف",
  Stealth: "مخفی‌شدن و بی‌صدا حرکت‌کردن",
  Survival: "ردیابی، جهت‌یابی، زنده‌موندن در طبیعت",
};

export const SKILL_ABILITY_MAP = {
  Acrobatics: "DEX",
  "Animal Handling": "WIS",
  Arcana: "INT",
  Athletics: "STR",
  Deception: "CHA",
  History: "INT",
  Insight: "WIS",
  Intimidation: "CHA",
  Investigation: "INT",
  Medicine: "WIS",
  Nature: "INT",
  Perception: "WIS",
  Performance: "CHA",
  Persuasion: "CHA",
  Religion: "INT",
  "Sleight of Hand": "DEX",
  Stealth: "DEX",
  Survival: "WIS",
};

// جدول DC رسمی D&D 2024
export const DC_TABLE = {
  veryEasy: 5,
  easy: 10,
  medium: 15,
  hard: 20,
  veryHard: 25,
  nearlyImpossible: 30,
};

export const BACKGROUNDS = {
  acolyte: {
    name: "مؤمن معبد (Acolyte)",
    abilityOptions: ["INT", "WIS", "CHA"],
    feat: "Magic Initiate (Cleric) — دو کانتریپ و یک اسپل سطح ۱ از لیست کشیش",
    skills: ["Insight", "Religion"],
    equipment: ["نماد مقدس", "کتاب دعا"],
    gold: 8,
  },
  criminal: {
    name: "مجرم (Criminal)",
    abilityOptions: ["DEX", "CON", "INT"],
    feat: "Alert — همیشه در ابتدای Initiative، غافلگیر نمیشی",
    skills: ["Sleight of Hand", "Stealth"],
    equipment: ["دیره‌بین"],
    toolTags: ["spyglass"],
    gold: 15,
  },
  sage: {
    name: "دانشمند (Sage)",
    abilityOptions: ["INT", "WIS", "CHA"],
    feat: "Magic Initiate (Wizard) — دو کانتریپ و یک اسپل سطح ۱ از لیست جادوگر",
    skills: ["Arcana", "History"],
    equipment: ["کتاب", "جوهر و قلم"],
    gold: 10,
  },
  soldier: {
    name: "سرباز (Soldier)",
    abilityOptions: ["STR", "DEX", "CON"],
    feat: "Savage Attacker — یک‌بار در هر نوبت میشه آسیب حمله رو دوباره رول کرد",
    skills: ["Athletics", "Intimidation"],
    equipment: ["یونیفرم سربازی", "ست بازی نرد"],
    gold: 14,
  },
};

// ---------- XP و سطح (جدول استاندارد 5e؛ XP تجمعیِ لازم برای رسیدن به هر سطح) ----------
// اندیس ۰ = سطح ۱ (۰ XP)، اندیس ۱ = سطح ۲ (۳۰۰ XP)، ...، اندیس ۱۹ = سطح ۲۰
export const XP_BY_LEVEL = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000,
  120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];

// وضعیت نوار XP یک شخصیت: چقدر تا سطح بعد مانده.
// remaining = null یعنی به سطح بیشینه رسیده؛ remaining = 0 یعنی آستانه پر شده (Level Up هنوز نیست).
export function xpToNext(level, xp) {
  const lv = Math.min(20, Math.max(1, Math.floor(Number(level) || 1)));
  if (lv >= 20) return { maxLevel: true, remaining: null, needed: null };
  const needed = XP_BY_LEVEL[lv]; // آستانهٔ سطح بعد (اندیس lv = سطح lv+1)
  return {
    maxLevel: false,
    needed,
    remaining: Math.max(0, needed - (Number(xp) || 0)),
  };
}

// ---------- ابزارها (toolTags) — فهرست بستهٔ V07 ----------
export const TOOL_TAGS = [
  "thieves_tools",
  "forgery_kit",
  "rope",
  "repair_kit",
  "healers_kit",
  "disguise_kit",
  "spyglass",
  "map",
  "tinderbox",
];

export const TOOL_LABELS_FA = {
  thieves_tools: "ابزار دزدی",
  forgery_kit: "ابزار جعل سند",
  rope: "طناب",
  repair_kit: "ابزار تعمیر",
  healers_kit: "کیت درمان",
  disguise_kit: "ابزار تغییر چهره",
  spyglass: "دوربین",
  map: "نقشه",
  tinderbox: "فندک",
};

// کیت پایهٔ همهٔ شخصیت‌ها (مثل Explorer's Pack در 5e)
export const BASE_TOOL_TAGS = ["rope", "tinderbox"];
export const BASE_EQUIPMENT = ["طناب (Rope)", "فندک (Tinderbox)"];

// ابزارهای یک شخصیت: کیت پایه + ابزار کلاس + ابزار پیش‌زمینه (بدون تکراری)
export function computeToolTags(classKey, bgKey) {
  const all = [
    ...BASE_TOOL_TAGS,
    ...(CLASSES[classKey]?.toolTags || []),
    ...(BACKGROUNDS[bgKey]?.toolTags || []),
  ];
  return [...new Set(all)].filter((t) => TOOL_TAGS.includes(t));
}
