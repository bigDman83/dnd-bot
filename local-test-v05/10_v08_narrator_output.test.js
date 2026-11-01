import assert from "node:assert/strict";
import {
  readNarratorOutput,
  readNewNames,
  renderScript,
  scriptToText,
} from "lib/game/blocks";
import { DEFAULT_PROMPTS } from "lib/ai/defaultPrompts";
let n = 0;
const ok = (m) => console.log("✅", ++n, m);

// ۱) خروجی کامل و درست
const full = readNarratorOutput({
  narration: "  مشعل می‌لرزید.\nنگهبان: «کجا؟»  ",
  suggestions: [" الف ", "ب", "ج", "د"],
  newNames: [{ name: "اسکار", role: "نگهبان دروازه" }],
});
assert.equal(full.narration, "مشعل می‌لرزید.\nنگهبان: «کجا؟»");
assert.deepEqual(full.suggestions, ["الف", "ب", "ج"]);
assert.deepEqual(full.newNames, [{ name: "اسکار", role: "نگهبان دروازه" }]);
ok("خروجی کامل: trim، حداکثر ۳ پیشنهاد، newNames");

// ۲) بدون newNames / پیشنهاد
const bare = readNarratorOutput({ narration: "روایت" });
assert.deepEqual(bare, { narration: "روایت", suggestions: [], newNames: [] });
ok("newNames و suggestions اختیاری‌اند (سازگار با خروجی قدیمی راوی)");

// ۳) روایت خالی یا نادرست = خطا (دور سالم برمی‌گردد)
for (const bad of [null, {}, { narration: "  " }, { narration: 5 }]) {
  assert.throws(() => readNarratorOutput(bad), /روایتی برنگردوند/);
}
ok("روایت خالی/نامعتبر خطا می‌دهد");

// ۴) پاک‌سازی newNames
assert.deepEqual(readNewNames("x"), []);
assert.deepEqual(
  readNewNames([
    "اسکار",
    { name: "اسکار", role: "تکراری" },
    { name: "<b>هلنا</b>", role: "<i>تاجر</i>" },
    { name: "x" },
    { role: "بی‌نام" },
    42,
    null,
    { name: "الف‌الف" },
    { name: "ب‌ب" },
  ]).map((x) => x.name),
  ["اسکار", "هلنا", "الف‌الف"],
);
const long = readNewNames([{ name: "ن".repeat(80), role: "ر".repeat(80) }])[0];
assert.ok(long.name.length === 30 && long.role.length === 30);
ok("newNames: تکراری، تگ، کوتاه، نامعتبر حذف؛ سقف ۳ و طول ۳۰");

// ۵) اسکریپت راوی → HTML
const html = renderScript(full.narration);
assert.equal(
  html,
  "مشعل می‌لرزید.\n\n<blockquote><b>نگهبان</b>: «کجا؟»</blockquote>",
);
ok("اسکریپت راوی به بلوک روایت و دیالوگ تبدیل می‌شود");

// ۶) script ساختاریافته ← اسکریپت متنی
const sc = readNarratorOutput({
  script: [
    { type: "narration", text: "مانار نزدیک شد." },
    { type: "dialogue", speaker: "مسئول کاروان", text: "تا غروب می‌رسیم." },
    { type: "dialogue", speaker: "نگهبان:", text: "«بایستید!»" },
    { type: "narration", text: "باد پیچید." },
    { type: "narration", text: "سکوت شد." },
  ],
  suggestions: ["الف"],
});
assert.equal(
  sc.narration,
  "مانار نزدیک شد.\nمسئول کاروان: «تا غروب می‌رسیم.»\nنگهبان: «بایستید!»\nباد پیچید.\n\nسکوت شد.",
);
assert.equal(
  renderScript(sc.narration),
  "مانار نزدیک شد.\n\n<blockquote><b>مسئول کاروان</b>: «تا غروب می‌رسیم.»\n<b>نگهبان</b>: «بایستید!»</blockquote>\n\nباد پیچید.\n\nسکوت شد.",
);
ok("script: آیتم‌ها به اسکریپت و بعد HTML؛ گیومه و دونقطهٔ اضافه پاک می‌شود");

// ۷) آیتم‌های خراب نادیده گرفته می‌شوند؛ script خالی ← برگشت به narration قدیمی
assert.equal(
  scriptToText([
    null,
    5,
    { type: "dialogue", speaker: "", text: "x" },
    { type: "narration", text: "  " },
    { text: "فقط متن" },
  ]),
  "فقط متن",
);
assert.equal(scriptToText("x"), "");
assert.equal(
  readNarratorOutput({ script: [], narration: "قدیمی\nعلی: «سلام»" }).narration,
  "قدیمی\nعلی: «سلام»",
);
assert.throws(
  () => readNarratorOutput({ script: [{ type: "narration", text: " " }] }),
  /روایتی برنگردوند/,
);
ok("script خراب/خالی: آیتم بد حذف، فال‌بک به narration قدیمی، همه خالی = خطا");

// ۸) نام گوینده حداکثر ۳ کلمه
assert.equal(
  scriptToText([
    { type: "dialogue", speaker: "مرد پیر با زره خاکی", text: "برو" },
  ]),
  "مرد پیر با: «برو»",
);
ok("نام گوینده به سه کلمه کوتاه می‌شود");

// ۹) پرامپت
const p = DEFAULT_PROMPTS.round_narrator;
assert.ok(p.includes('"type": "dialogue"') && p.includes("آرایه‌ی script"));
assert.ok(p.includes("newNames") && p.includes("حداکثر ۴ آیتم dialogue"));
assert.ok(p.includes("هرگز برای شخصیت‌های بازیکن‌ها دیالوگ"));
assert.ok(
  p.includes("حداکثر ۱۲۰ کلمه") && p.includes("با یک خط دیالوگ جواب بدهد"),
);
assert.ok(p.trim().endsWith('"role": "..."}]}'));
assert.ok(p.includes('{"script": [{"type": "narration"'));
ok(
  "پرامپت راوی: script ساختاریافته، دیالوگ فقط NPC، newNames، پاسخ به سؤال، سقف ۱۲۰ کلمه",
);
