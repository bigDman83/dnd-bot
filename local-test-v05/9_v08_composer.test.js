import assert from "node:assert/strict";
import { sent } from "sdk";
import { composeScene, unpackScene, scenePlainView, packSegments, htmlToPlain, SCENE_HTML_MARK } from "lib/game/blocks";
import { sendSceneMessage } from "lib/game/narrator";
let n = 0; const ok = (m) => console.log("✅", ++n, m);

// ۱) ساختار پیام
const txt = composeScene({
  timeLine: "🕐 روز ۱، صبح",
  narration: "مشعل می‌لرزید.\nنگهبان: «کجا؟»",
  diceLines: ["🎲 دانی — مخفی‌کاری: 17 ← موفق"],
  diceDetails: ["دانی: تاس 12 + چابکی 3 = 17 در برابر 14"],
  groups: ["✨ دانی: +25 XP\n✨ دانار: +25 XP", "", "🚫 x<y"],
});
const u = unpackScene(txt);
assert.ok(u.html && u.parts.length === 1 && txt.startsWith(SCENE_HTML_MARK));
const p = u.parts[0];
assert.ok(p.startsWith("🕐 روز ۱، صبح\n\nمشعل می‌لرزید.\n\n<blockquote><b>نگهبان</b>: «کجا؟»</blockquote>\n\n🎲 دانی"));
assert.ok(p.includes("<blockquote expandable>دانی: تاس 12 + چابکی 3 = 17 در برابر 14</blockquote>"));
assert.ok(p.includes("✨ دانی: +25 XP\n✨ دانار: +25 XP") && p.includes("🚫 x&lt;y"));
ok("ترتیب بلوک‌ها، blockquote دیالوگ و expandable جزئیات، escape گروه‌ها");

// ۲) بدون چک: بدون بلوک‌های خالی
const bare = unpackScene(composeScene({ timeLine: "🕐 x", narration: "روایت" })).parts[0];
assert.equal(bare, "🕐 x\n\nروایت");
ok("دور بدون تاس: فقط خط زمان و روایت، بدون بلوک خالی");

// ۳) شکستن پیام بلند: blockquote دوباره باز و بسته میشود
const lines = Array.from({ length: 40 }, (_, i) => `دانی: تاس ${i} + چابکی 3 = 17 در برابر 14`);
const parts = packSegments([`<blockquote expandable>${lines.join("\n")}</blockquote>`], 600);
assert.ok(parts.length >= 3);
for (const x of parts) {
  assert.ok(x.length <= 600, `طول ${x.length}`);
  assert.ok(x.startsWith("<blockquote expandable>") && x.endsWith("</blockquote>"));
}
assert.equal(parts.join("\n").replace(/<\/?blockquote( expandable)?>/g, "").split("\n").filter(Boolean).length, 40);
ok("شکستن blockquote بزرگ: هر تکه تگ کامل دارد و خطی گم نمی‌شود");

// ۴) چند تکهٔ کوچک در یک پیام؛ خط بلندتر از سقف بریده میشود
assert.equal(packSegments(["الف", "ب", "ج"], 100).length, 1);
const hard = packSegments(["x".repeat(1000)], 300);
assert.ok(hard.length >= 4 && hard.every((s) => s.length <= 300));
ok("بسته‌بندی تکه‌ها و برش اجباری");

// ۵) صحنهٔ قدیمی و نمای ساده
assert.deepEqual(unpackScene("متن ساده"), { html: false, parts: ["متن ساده"] });
assert.equal(scenePlainView(txt).split("\n")[0], "🕐 روز ۱، صبح");
assert.equal(htmlToPlain("<b>a</b> &lt;x&gt; &amp;"), "a <x> &");
ok("صحنهٔ قدیمی دست‌نخورده؛ نمای ساده و htmlToPlain");

// ۶) ارسال: HTML فقط برای صحنهٔ جدید، دکمه‌ها فقط روی آخرین پیام
sent.length = 0;
await sendSceneMessage(1, txt, ["الف", "ب", "ج"], 3);
assert.equal(sent.length, 1);
assert.equal(sent[0].parse_mode, "HTML");
assert.ok(sent[0].reply_markup.inline_keyboard.length === 4);
assert.ok(sent[0].text.endsWith("خودت بنویس چیکار می‌کنی:"));
sent.length = 0;
await sendSceneMessage(1, "صحنهٔ قدیمی", ["الف"], 3);
assert.equal(sent[0].parse_mode, undefined);
sent.length = 0;
const big = composeScene({ timeLine: "🕐", narration: "الف ".repeat(900), limit: 1500 });
await sendSceneMessage(1, big, ["الف"], 3);
assert.ok(sent.length >= 2);
assert.ok(sent.slice(0, -1).every((m) => !m.reply_markup) && sent.at(-1).reply_markup);
ok("sendSceneMessage: HTML برای جدید، متن ساده برای قدیمی، دکمه فقط روی آخرین پیام");
