import assert from "node:assert/strict";
import { planLayout, LAYOUTS, composeScene, unpackScene } from "lib/game/blocks";
let n = 0; const ok = (m) => console.log("✅", ++n, m);
const part = (x) => unpackScene(x).parts.join("\n");
const idx = (s, needle) => { const i = s.indexOf(needle); assert.ok(i >= 0, `«${needle}» پیدا نشد`); return i; };

// ۱) انتخاب چیدمان
for (const t of ["explore", "social", "crisis", "mystery", "نامعتبر", undefined]) assert.equal(planLayout(t).name, "standard", String(t));
assert.equal(planLayout("travel").name, "travel");
assert.equal(planLayout("rest").name, "rest");
assert.deepEqual(planLayout("travel").slots, LAYOUTS.travel);
ok("planLayout: سفر و استراحت چیدمان خودشان را دارند، بقیه (و ناشناخته) استاندارد");

const common = {
  timeLine: "🕐 روز 3، عصر",
  narration: "مانار جلو رفت.\nنگهبان: «ایست!»",
  diceLines: ["🎲 مانار — کاوش: 13 ← موفق"],
  diceDetails: ["مانار: تاس 11 + هوش 2 = 13 در برابر 12"],
  progress: ["✨ مانار: +10 XP"],
  notices: ["🚫 دانی — جعل سند"],
};

// ۲) استاندارد: زمان ← روایت/دیالوگ ← سیستم ← پیشرفت ← اعلان
let s = part(composeScene({ ...common, sceneType: "crisis" }));
const order = ["🕐 روز 3", "مانار جلو رفت", "<blockquote><b>نگهبان", "🎲 مانار", "<blockquote expandable>", "✨ مانار", "🚫 دانی"].map((x) => idx(s, x));
assert.deepEqual(order, [...order].sort((a, b) => a - b));
ok("چیدمان استاندارد: ترتیب زمان، روایت، دیالوگ، سیستم، جزئیات، پیشرفت، اعلان");

// ۳) سفر: خلاصهٔ سفر بعد از زمان و قبل از روایت
s = part(composeScene({ ...common, sceneType: "travel", travelLine: "🧭 سفر به «غار سوسو» — چند ساعت" }));
assert.ok(idx(s, "🕐") < idx(s, "🧭 سفر به «غار سوسو» — چند ساعت") && idx(s, "🧭") < idx(s, "مانار جلو رفت"));
s = part(composeScene({ ...common, sceneType: "explore", travelLine: "🧭 سفر به «x»" }));
assert.ok(!s.includes("🧭"), "خط سفر فقط در چیدمان سفر");
ok("چیدمان سفر: خلاصهٔ سفر پیش از روایت؛ در چیدمان‌های دیگر نمی‌آید");

// ۴) استراحت: اعلان (HP و تاس جان) پیش از پیشرفت
s = part(composeScene({ ...common, sceneType: "rest", notices: ["🛏️ استراحت کوتاه — 1 ساعت گذشت"], diceLines: [], diceDetails: [] }));
assert.ok(idx(s, "🛏️") < idx(s, "✨ مانار"));
assert.ok(!s.includes("<blockquote expandable>"));
ok("چیدمان استراحت: اعلان پیش از پیشرفت؛ بلوک سیستم ندارد");

// ۵) سازگاری با نام قدیمی groups و جایگاه خالی
s = part(composeScene({ timeLine: "🕐 x", narration: "روایت", groups: ["✨ XP", "🚫 رد"] }));
assert.equal(s, "🕐 x\n\nروایت\n\n✨ XP\n\n🚫 رد");
s = part(composeScene({ sceneType: "social", timeLine: "🕐 x", narration: "روایت" }));
assert.equal(s, "🕐 x\n\nروایت");
ok("groups قدیمی هنوز کار می‌کند؛ جایگاه خالی هیچ بلوک خالی نمی‌سازد");

// ۶) escape در همهٔ جایگاه‌ها
s = part(composeScene({ sceneType: "travel", timeLine: "🕐 <x>", travelLine: "🧭 «a&b»", narration: "x<y", progress: ["p<q"], notices: ["n&m"] }));
assert.ok(s.includes("&lt;x&gt;") && s.includes("a&amp;b") && s.includes("x&lt;y") && s.includes("p&lt;q") && s.includes("n&amp;m"));
ok("escape در زمان، سفر، روایت، پیشرفت و اعلان");
