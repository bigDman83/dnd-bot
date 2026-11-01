import assert from "node:assert/strict";
import { escapeHtml, parseScript, renderBlock, renderSystemBlock, renderScript, wordStats, countWords } from "lib/game/blocks";
let n = 0; const ok = (m) => console.log("✅", ++n, m);

assert.equal(escapeHtml("a<b>&c"), "a&lt;b&gt;&amp;c"); assert.equal(escapeHtml(null), "");
ok("escapeHtml");

const script = `مشعل در دست دانی می‌لرزید.
نگهبان: «کجا می‌روی؟»
دانی: «فقط عبور می‌کنم.»

نگهبان ابرو بالا انداخت.`;
const b = parseScript(script);
assert.deepEqual(b.map((x) => x.type), ["narration", "dialogue", "narration"]);
assert.equal(b[1].lines.length, 2); assert.equal(b[1].lines[0].speaker, "نگهبان");
ok("parseScript: روایت ← دیالوگ(۲ خط) ← روایت");

// جملهٔ روایی با گفت: دیالوگ نیست
const b2 = parseScript("دانی گفت: «برو»\nپیرمرد غریبه: «بیا»\nنگهبان با اخم گفت: «ایست»");
assert.deepEqual(b2.map((x) => x.type), ["narration", "dialogue", "narration"]);
ok("جملهٔ «X گفت: «..»» و نام بلند روایت می‌مانند، «پیرمرد غریبه» دیالوگ");

// پاراگراف
const b3 = parseScript("الف\n\nب");
assert.deepEqual(b3[0].lines, ["الف", "", "ب"]);
assert.equal(renderBlock(b3[0]), "الف\n\nب");
ok("خط خالی داخل روایت = پاراگراف");

// HTML و escape
const h = renderScript("<b>خطر</b> & دود\nعلی & <i>: «a<b»");
assert.ok(h.includes("&lt;b&gt;خطر&lt;/b&gt; &amp; دود"));
assert.ok(!/<b>خطر/.test(h));
const h2 = renderScript("علی: «سلام <تو> & من»");
assert.equal(h2, "<blockquote><b>علی</b>: «سلام &lt;تو&gt; &amp; من»</blockquote>");
ok("escape در روایت و دیالوگ؛ تگ بازیکن/AI اجرا نمی‌شود");

// سیستم
assert.equal(renderSystemBlock({ lines: ["🎲 دانی — مخفی‌کاری: موفق"], details: ["دانی: تاس 12 + چابکی 3 = 17 در برابر 14"] }),
  "🎲 دانی — مخفی‌کاری: موفق\n<blockquote expandable>دانی: تاس 12 + چابکی 3 = 17 در برابر 14</blockquote>");
assert.equal(renderSystemBlock({ lines: ["x<y"] }), "x&lt;y");
assert.equal(renderSystemBlock({}), "");
ok("renderSystemBlock: خط ساده + جزئیات expandable، بدون جزئیات = فقط خط");

// آمار
const st = wordStats(b);
assert.equal(st.dialogueLines, 2); assert.ok(st.narration > 5 && st.dialogue >= 4);
assert.equal(countWords("  "), 0);
ok("wordStats: کلمات روایت و دیالوگ جدا");

// ورودی خراب
assert.deepEqual(parseScript(""), []); assert.deepEqual(parseScript(null), []);
ok("ورودی خالی/null");
