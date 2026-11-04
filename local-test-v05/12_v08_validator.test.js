import assert from "node:assert/strict";
import {
  splitPlot,
  dmOnlyKeywords,
  validateNarration,
  rewriteReminder,
  normalizeFa,
} from "lib/game/validator";
let n = 0;
const ok = (m) => console.log("✅", ++n, m);
const codes = (r) => r.errors.map((e) => e.code);
const base = {
  sceneType: "explore",
  playerNames: ["مانار", "دانی"],
  dmOnlyWords: [],
  bannedWords: [],
};

// ۱) جداکردن راز: متن واقعی کوئست بازی
const plot =
  "راز گمشدهٔ تاج — ماجراجویان باید کلیدهای باستانی را پیدا کنند؛ اما متوجه می‌شوند که تاج واقعی یک شیء جادویی نیست، بلکه یک عهد مخفی است که سرنوشت را تغییر می‌دهد.";
const sp = splitPlot(plot);
assert.equal(
  sp.publicText,
  "راز گمشدهٔ تاج — ماجراجویان باید کلیدهای باستانی را پیدا کنند",
);
assert.ok(
  sp.secretText.startsWith("اما متوجه") && sp.secretText.includes("عهد مخفی"),
);
assert.deepEqual(
  dmOnlyKeywords(sp.secretText, sp.publicText, "راز گمشدهٔ تاج"),
  ["عهد"],
);
ok("splitPlot: بخش عمومی تا «اما»؛ کلیدواژه‌ی راز فقط «عهد»");

// بدون مارکر / مارکر اول متن = همه عمومی
assert.deepEqual(splitPlot("ماجراجویان باید کلیدها را پیدا کنند"), {
  publicText: "ماجراجویان باید کلیدها را پیدا کنند",
  secretText: "",
});
assert.equal(splitPlot("اما این شروع است و ادامه دارد").secretText, "");
assert.deepEqual(splitPlot(""), { publicText: "", secretText: "" });
assert.deepEqual(splitPlot(null), { publicText: "", secretText: "" });
ok("splitPlot: بدون مارکر، مارکر اول متن، خالی و null");

// ۲) روایت سالم رد نمی‌شود
const good = "مانار و دانی به سمت دیوار رفتند.\nنگهبان: «بایستید!»";
let r = validateNarration({ ...base, narration: good, dmOnlyWords: ["عهد"] });
assert.deepEqual(r.errors, []);
ok("روایت سالم: بدون خطا");

// ۳) نشت راز (همان اتفاقی که در دور ۱۷ و ۱۸ افتاد)
const leak = "مانار و دانی نقش‌ها را دیدند؛ مسیر به سوی عهد را نشان می‌داد.";
assert.deepEqual(
  codes(validateNarration({ ...base, narration: leak, dmOnlyWords: ["عهد"] })),
  ["DM_ONLY"],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      narration: "مانار و دانی رفتند. عهدی کهن بود.",
      dmOnlyWords: ["عهد"],
    }),
  ),
  ["DM_ONLY"],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      narration: "مانار و دانی رفتند به عهده‌دار گفتند.",
      dmOnlyWords: ["عهد"],
    }),
  ),
  ["DM_ONLY"],
); // «عهده» هم می‌گیرد؛ شناخته‌شده
ok("DM-Only: در روایت، با پسوند «عهدی/عهدها»");
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      narration: "مانار و دانی رفتند.",
      dmOnlyWords: ["عهد"],
    }),
  ),
  [],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      narration: "مانار و دانی رفتند و مهد کودکی دیدند.",
      dmOnlyWords: ["عهد"],
    }),
  ),
  [],
);
ok("DM-Only: کلمه‌ی شبیه («مهد») اشتباه گرفته نمی‌شود");

// ۴) غلط املایی و غیبت نام (دور ۱۸: «مانور»)
r = validateNarration({ ...base, narration: "دانی ایستاد و مانور آرام رفت." });
assert.deepEqual(codes(r), ["PLAYER_NAME_TYPO"]);
assert.ok(
  r.errors[0].text.includes("مانور") && r.errors[0].text.includes("مانار"),
);
assert.deepEqual(
  codes(validateNarration({ ...base, narration: "گروه رفت و مانار ایستاد." })),
  ["PLAYER_NAME_MISSING"],
);
assert.deepEqual(
  codes(validateNarration({ ...base, narration: "مانار و دانی رفتند." })),
  [],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      narration: "دانیِ جوان و مانارِ خسته رفتند.",
    }),
  ),
  [],
);
ok("نام بازیکن: غلط املایی، غایب و نام با پسوند");

// ۴ب) نام چندکلمه‌ای: دور ۱ تا ۵ بازی زنده («هوشنگ امیر ابتهاج») با نام کوچک رد می‌شد
const long = { ...base, playerNames: ["هوشنگ امیر ابتهاج", "مانار"] };
assert.deepEqual(
  codes(validateNarration({ ...long, narration: "هوشنگ به سمت مانار رفت." })),
  [],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...long,
      narration: "هوشنگ امیر ابتهاج و مانار رفتند.",
    }),
  ),
  [],
);
assert.deepEqual(
  codes(validateNarration({ ...long, narration: "ابتهاج و مانار رفتند." })),
  [],
);
assert.deepEqual(
  codes(validateNarration({ ...long, narration: "هوشنگی و مانار رفتند." })),
  [],
); // پسوند کوتاه
assert.deepEqual(
  codes(validateNarration({ ...long, narration: "هوشنگ رفت." })),
  ["PLAYER_NAME_MISSING"],
);
assert.deepEqual(
  codes(validateNarration({ ...long, narration: "هوشنک و مانار رفتند." })),
  ["PLAYER_NAME_TYPO"],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...long,
      narration: "هوشنگ و مانار ایستادند.\nهوشنگ: «برویم»",
    }),
  ),
  ["NPC_ONLY"],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...long,
      narration: "هوشنگ و مانار ایستادند.\nنگهبان: «برویم»",
    }),
  ),
  [],
);
ok(
  "نام چندکلمه‌ای: نام کوچک کافی است؛ غلط املایی و دیالوگ برای بازیکن هنوز گرفته می‌شود",
);

// ۴پ) تلاش دوم (lenient): نبودن نام فقط هشدار؛ غلط‌بودنش هنوز خطا
r = validateNarration({ ...base, narration: "دانی رفت.", lenient: true });
assert.deepEqual(codes(r), []);
assert.deepEqual(
  r.warnings.map((w) => w.code),
  ["PLAYER_NAME_MISSING"],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      narration: "دانی و مانور رفتند.",
      lenient: true,
    }),
  ),
  ["PLAYER_NAME_TYPO"],
);
ok("lenient: نام غایب هشدار، غلط املایی همچنان خطا");

// ۵) طول با تلرانس ۲۵٪ (explore ۱۲۰ ← ۱۵۰)
const words = (k) => Array.from({ length: k }, (_, i) => `کلمه${i}`).join(" ");
assert.deepEqual(
  codes(
    validateNarration({ ...base, narration: `مانار و دانی ${words(145)}` }),
  ),
  [],
);
assert.deepEqual(
  codes(
    validateNarration({ ...base, narration: `مانار و دانی ${words(160)}` }),
  ),
  ["LENGTH"],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      sceneType: "crisis",
      narration: `مانار و دانی ${words(200)}`,
    }),
  ),
  [],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      sceneType: "social",
      narration: `نگهبان: «سلام»\nمانار و دانی ${words(120)}`,
    }),
  ),
  ["LENGTH"],
);
ok("طول: تلرانس، سقف بحران بلندتر، سقف گفتگو کوتاه‌تر");

// ۶) دیالوگ الزامی در گفتگو
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      sceneType: "social",
      narration: "مانار و دانی با نگهبان حرف زدند.",
    }),
  ),
  ["DIALOGUE_REQUIRED"],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      sceneType: "social",
      narration: "مانار و دانی آمدند.\nنگهبان: «کیستید؟»",
    }),
  ),
  [],
);
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      sceneType: "explore",
      narration: "مانار و دانی رفتند.",
    }),
  ),
  [],
);
ok("گفتگو دیالوگ لازم دارد؛ اکتشاف نه");

// ۷) دیالوگ برای شخصیت بازیکن، پرانتز/براکت، اصطلاح فنی
assert.deepEqual(
  codes(
    validateNarration({
      ...base,
      narration: "مانار و دانی ایستادند.\nدانی: «برویم»",
    }),
  ),
  ["NPC_ONLY"],
);
assert.deepEqual(
  codes(
    validateNarration({ ...base, narration: "مانار و دانی رفتند (آرام)." }),
  ),
  ["TECH_TERM"],
);
assert.deepEqual(
  codes(validateNarration({ ...base, narration: "مانار و دانی [رفتند]." })),
  ["TECH_TERM"],
);
assert.deepEqual(
  codes(
    validateNarration({ ...base, narration: "مانار تاس انداخت و دانی رفت." }),
  ),
  ["TECH_TERM"],
);
assert.deepEqual(
  codes(
    validateNarration({ ...base, narration: "مانار با DC بالا و دانی رفتند." }),
  ),
  ["TECH_TERM"],
);
assert.deepEqual(
  codes(
    validateNarration({ ...base, narration: "مانار و دانی در تاسیسات رفتند." }),
  ),
  [],
);
ok("دیالوگ برای بازیکن، پرانتز/براکت و اصطلاح فنی (ولی «تاسیسات» مجاز)");

// ۸) هشدارها بازنویسی نمی‌خواهند
r = validateNarration({
  ...base,
  narration: "مانار و دانی در سکوت رفتند.\nنگهبان گفت «ایست»",
  bannedWords: ["سکوت"],
});
assert.deepEqual(codes(r), []);
assert.deepEqual(r.warnings.map((w) => w.code).sort(), [
  "BANNED_WORD",
  "INLINE_QUOTE",
]);
ok("کلمه‌ی ضدتکرار و گیومه‌ی وسط روایت فقط هشدارند");

// ۹) چند خطا با هم + متن یادآوری
r = validateNarration({
  ...base,
  narration: "مانور رفت (آرام).",
  dmOnlyWords: [],
});
assert.deepEqual(
  codes(r).sort(),
  ["PLAYER_NAME_MISSING", "PLAYER_NAME_TYPO", "TECH_TERM"].sort(),
);
const rem = rewriteReminder(r.errors);
assert.ok(
  rem.includes("رد شد") &&
    rem.includes("«مانار»") &&
    rem.split("\n- ").length - 1 === 3,
);
ok("چند خطا هم‌زمان و متن یادآوری");

// ۱۰) ورودی خراب
assert.deepEqual(validateNarration({ narration: "" }).errors, []);
assert.deepEqual(
  validateNarration({ narration: null, playerNames: [] }).errors,
  [],
);
assert.equal(normalizeFa("مَانار‌ي"), "مانار ی");
ok("ورودی خالی/null و نرمال‌سازی");

// ۱۱) سقف دیالوگ: فقط هشدار
const dl = (k) =>
  Array.from({ length: k }, (_, i) => `نگهبان${i}: «سلام»`).join("\n");
r = validateNarration({
  ...base,
  narration: `مانار و دانی ایستادند.\n${dl(5)}`,
});
assert.deepEqual(codes(r), []);
assert.ok(r.warnings.some((w) => w.code === "DIALOGUE_LONG"));
r = validateNarration({
  ...base,
  narration: `مانار و دانی ایستادند.\nنگهبان: «${words(40)}»`,
});
assert.ok(r.warnings.some((w) => w.code === "DIALOGUE_LONG"));
r = validateNarration({
  ...base,
  narration: `مانار و دانی ایستادند.\n${dl(4)}`,
});
assert.ok(!r.warnings.some((w) => w.code === "DIALOGUE_LONG"));
ok("دیالوگ بیش از ۴ خط یا بیش از ~۲۵ کلمه فقط هشدار؛ تا ۴ خط بی‌اشکال");
