import assert from "node:assert/strict";
import { parseScript, renderBlock, scriptToText, readNarratorOutput, composeScene, unpackScene, wordStats, renderScript } from "lib/game/blocks";
import { checksToDiceParts, checksToNarratorText } from "lib/game/resolver";
import { validateNarration } from "lib/game/validator";
let n = 0; const ok = (m) => console.log("✅", ++n, m);
const part = (x) => unpackScene(x).parts.join("\n");
const at = (s, needle) => { const i = s.indexOf(needle); assert.ok(i >= 0, `«${needle}» پیدا نشد`); return i; };

// ۱) نشانه‌ی check در اسکریپت
const withMarker = "مانار دستش را به سنگ رساند.\n⟦check:a1⟧\nسنگ لغزید.";
const blocks = parseScript(withMarker);
assert.deepEqual(blocks.map((b) => b.type), ["narration", "check", "narration"]);
assert.equal(blocks[1].id, "a1");
assert.equal(renderBlock(blocks[1]), "");
assert.deepEqual(wordStats(blocks), { narration: 8, dialogue: 0, dialogueLines: 0 });
assert.equal(renderScript(withMarker), "مانار دستش را به سنگ رساند.\n\nسنگ لغزید.");
ok("parseScript: نشانه‌ی ⟦check:id⟧ بلوک جدا می‌شود، متن ندارد و کلمه‌ای نمی‌شمارد");
assert.deepEqual(parseScript("⟦check:یک⟧").map((b) => b.type), ["narration"]); // شناسه‌ی نامعتبر = متن
ok("شناسه‌ی نامعتبر نشانه حساب نمی‌شود");

// ۲) خروجی ساختاریافته‌ی راوی: متن تمیز + نسخه‌ی چیدمان
const out = readNarratorOutput({
  script: [
    { type: "narration", text: "مانار دستش را دراز کرد." },
    { type: "check", action: "a1" },
    { type: "narration", text: "سنگ لغزید." },
    { type: "dialogue", speaker: "نگهبان", text: "ایست!" },
    { type: "check", action: "bad id!" },
    { type: "check" },
  ],
});
assert.equal(out.narration, "مانار دستش را دراز کرد.\n\nسنگ لغزید.\nنگهبان: «ایست!»");
assert.ok(!out.narration.includes("⟦"));
assert.equal(out.layoutScript, "مانار دستش را دراز کرد.\n⟦check:a1⟧\nسنگ لغزید.\nنگهبان: «ایست!»");
assert.equal(scriptToText([{ type: "check", action: "a1" }]), ""); // پیش‌فرض بدون نشانه
ok("readNarratorOutput: narration تمیز (برای تاریخچه)، layoutScript با نشانه (فقط برای Composer)");
assert.equal(readNarratorOutput({ narration: "قدیمی" }).layoutScript, "قدیمی");
ok("فرمت قدیمی narration رشته‌ای: layoutScript = همان متن");

// ۳) Validator روی متن تمیز کار می‌کند، نه نشانه
const v = validateNarration({ narration: out.narration, playerNames: ["مانار"], sceneType: "explore" });
assert.deepEqual(v.errors, []);
ok("Validator: نشانه‌ها وارد بررسی طول/قالب نمی‌شوند");

// ۴) داده‌ی چک‌ها (دو بازیکن + یک چک گروهی)
const mk = (o) => ({ name: "مانار", skill: "Athletics", ability: "STR", mod: 3, profBonus: 2, env: [], dc: 15, roll: 13, total: 18, margin: 3, degree: { label: "موفقیت", hint: "ساده", key: "success" }, mode: "normal", actionId: "a1", ...o });
const results = [mk({}), mk({ name: "دانی", skill: "Stealth", ability: "DEX", mod: 1, roll: 5, total: 8, margin: -7, degree: { label: "شکست سنگین", hint: "سخت", key: "critFail" }, actionId: "a2" })];
const dp = checksToDiceParts(results);
assert.equal(dp.items.length, 2);
assert.deepEqual(dp.items.map((i) => i.id), ["a1", "a2"]);
assert.ok(dp.items[0].line.startsWith("🎲 مانار") && dp.items[0].detail.startsWith("مانار: تاس"));
assert.equal(dp.lines.length, 2); assert.equal(dp.details.length, 2); // قالب قبلی دست‌نخورده (برای بازپخش)
assert.deepEqual(dp.extraLines, []);
const grp = [mk({ groupId: "g1", actionId: "a1" }), mk({ name: "دانی", groupId: "g1", actionId: "a2" })];
const dg = checksToDiceParts(grp);
assert.equal(dg.items.length, 0);
assert.ok(dg.extraLines.length >= 2 && dg.extraDetails.length === 2);
ok("checksToDiceParts: چک مستقل با شناسه در items؛ چک گروهی در extra");
const nt = checksToNarratorText(results);
assert.ok(nt.includes("- [a1] مانار") && nt.includes("- [a2] دانی"));
ok("یادداشت راوی: هر تلاش شناسه‌ی خودش را دارد");

// ۵) چیدمان: روایت تلاش ← تاس ← پیامد، به ترتیب هر اقدام
const full = "مانار از دیوار بالا رفت.\n⟦check:a1⟧\nبه سختی بالا رسید.\nدانی از شکاف خزید.\n⟦check:a2⟧\nصدایی آمد.";
let s = part(composeScene({ sceneType: "crisis", timeLine: "🕐 روز 3", narration: full, checks: dp.items, progress: ["✨ مانار: +10 XP"] }));
const order = ["🕐 روز 3", "مانار از دیوار", "🎲 مانار", "به سختی بالا رسید", "دانی از شکاف", "🎲 دانی", "صدایی آمد", "✨ مانار"].map((x) => at(s, x));
assert.deepEqual(order, [...order].sort((a, b) => a - b));
assert.equal((s.match(/<blockquote expandable>/g) || []).length, 2); // جزئیات هر چک کنار خودش
assert.equal((s.match(/🎲 مانار/g) || []).length, 1);
// بازپخش: همه‌ی خط‌ها و جزئیات (escape‌شده) باید جایی در متن صحنه باشند
for (const x of [...dp.lines, ...dp.details]) assert.ok(s.includes(x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")), x);
ok("چیدمان: تلاش ← تاس مانار ← پیامد ← تلاش دانی ← تاس دانی ← پیامد ← پیشرفت");

// ۶) فال‌بک: بدون نشانه، نشانه‌ی ناشناخته یا تکراری
const plain = part(composeScene({ sceneType: "explore", timeLine: "🕐 x", narration: "روایت ساده", checks: dp.items }));
assert.ok(at(plain, "روایت ساده") < at(plain, "🎲 مانار") && at(plain, "🎲 مانار") < at(plain, "🎲 دانی"));
const half = part(composeScene({ narration: "الف\n⟦check:a1⟧\nب\n⟦check:a1⟧\n⟦check:zz⟧\nج", checks: dp.items }));
assert.equal((half.match(/🎲 مانار/g) || []).length, 1); // تکراری و ناشناخته نادیده
assert.ok(at(half, "الف") < at(half, "🎲 مانار") && at(half, "🎲 مانار") < at(half, "ب") && at(half, "ج") < at(half, "🎲 دانی"));
ok("فال‌بک: چک بدون نشانه بعد از روایت (مثل قبل)، نشانه‌ی تکراری/ناشناخته نادیده");

// ۷) چک گروهی و خط‌های اضافه بعد از روایت می‌مانند
s = part(composeScene({ narration: "الف\n⟦check:a1⟧\nب", checks: dp.items.slice(0, 1), diceLines: ["👥 نتیجه‌ی گروهی"], diceDetails: ["گروه: جزئیات"] }));
assert.ok(at(s, "🎲 مانار") < at(s, "ب") && at(s, "ب") < at(s, "👥 نتیجه‌ی گروهی"));
ok("چک گروهی (extra) بعد از روایت؛ چک مستقل کنار بخش خودش");

// ۸) escape و استفاده‌ی قدیمی بدون checks
s = part(composeScene({ narration: "x<y\n⟦check:a1⟧", checks: [{ id: "a1", line: "🎲 <a&b>", detail: "d<e" }] }));
assert.ok(s.includes("x&lt;y") && s.includes("🎲 &lt;a&amp;b&gt;") && s.includes("d&lt;e"));
s = part(composeScene({ narration: "روایت", diceLines: ["🎲 قدیمی"], diceDetails: ["جزئیات قدیمی"] }));
assert.ok(at(s, "روایت") < at(s, "🎲 قدیمی") && s.includes("<blockquote expandable>جزئیات قدیمی"));
ok("escape در چک‌های جاگذاری‌شده؛ فراخوانی قدیمی (diceLines) سالم");
