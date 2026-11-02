import assert from "node:assert/strict";
import { sent } from "sdk";
import { validateSuggestions, finalizeSuggestions, requiredActionFor, MIN_SUGGESTIONS } from "lib/game/validator";
import { sendSceneMessage } from "lib/game/narrator";
let n = 0; const ok = (m) => console.log("✅", ++n, m);

// ۱) تشخیص اقدام‌های ابزار-الزامی از متن پیشنهاد
const need = (t) => requiredActionFor(t)?.key ?? null;
assert.equal(need("قفل در را باز کنید"), "lockpick");
assert.equal(need("قفل را با دقت دستکاری کنید"), "lockpick");
assert.equal(need("قفل‌گشایی در آهنی"), "lockpick");
assert.equal(need("تله‌ی کف را خنثی کنید"), "disarm_trap");
assert.equal(need("تله را غیرفعال کنید"), "disarm_trap");
assert.equal(need("نامه‌ی مهرشده را جعل کنید"), "forge_document");
ok("تشخیص قفل‌گشایی، خنثی‌کردن تله و جعل سند");
for (const free of ["قفل را بشکنید", "قفل را بررسی کنید", "به در نزدیک شوید", "با نگهبان حرف بزنید", "تله را دور بزنید", "بازرسی دقیق اتاق", "از دیوار بالا بروید"]) {
  assert.equal(need(free), null, free);
}
ok("اقدام‌های بدون ابزار الزامی (شکستن قفل، بررسی، دور زدن) دست‌نخورده");

// ۲) ابزار گروه: اگر یکی از اعضا دارد پیشنهاد شدنی است
const sug = ["قفل در را باز کنید", "با نگهبان حرف بزنید", "به اطراف نگاه کنید"];
let r = validateSuggestions({ suggestions: sug, groupToolTags: ["rope"] });
assert.deepEqual(r.valid, ["با نگهبان حرف بزنید", "به اطراف نگاه کنید"]);
assert.equal(r.removed.length, 1);
assert.equal(r.removed[0].code, "FEAS_MISSING_TOOL");
assert.ok(r.removed[0].text.includes("ابزار دزدی"));
r = validateSuggestions({ suggestions: sug, groupToolTags: ["rope", "thieves_tools"] });
assert.equal(r.valid.length, 3);
assert.equal(r.removed.length, 0);
ok("پیشنهاد ابزار-الزامی بدون ابزار گروه حذف می‌شود؛ با ابزار یکی از اعضا می‌ماند");

// ۳) DM-Only فقط همان پیشنهاد را حذف می‌کند (نه کل روایت)
r = validateSuggestions({ suggestions: ["جست‌وجوی عهدها", "به نگهبان نزدیک شوید", "راه را ادامه دهید"], dmOnlyWords: ["عهد"], groupToolTags: [] });
assert.deepEqual(r.valid, ["به نگهبان نزدیک شوید", "راه را ادامه دهید"]);
assert.equal(r.removed[0].code, "DM_ONLY");
ok("DM-Only در پیشنهاد: فقط همان پیشنهاد حذف می‌شود");

// ۴) ورودی خراب
r = validateSuggestions({ suggestions: [null, "", "  ", 5, "ادامه دهید"], groupToolTags: [] });
assert.deepEqual(r.valid, ["5", "ادامه دهید"]);
assert.deepEqual(validateSuggestions({}), { valid: [], removed: [] });
ok("ورودی خالی/خراب");

// ۵) قاعده‌ی کمبود
assert.equal(MIN_SUGGESTIONS, 2);
assert.deepEqual(finalizeSuggestions([]), []);
assert.deepEqual(finalizeSuggestions(["الف"]), []);
assert.deepEqual(finalizeSuggestions(["الف", "ب"]), ["الف", "ب"]);
assert.deepEqual(finalizeSuggestions(["الف", "ب", "ج", "د"]), ["الف", "ب", "ج"]);
ok("کمتر از ۲ = هیچ؛ ۲ یا ۳ می‌ماند؛ بیش از ۳ کوتاه می‌شود");

// ۶) ارسال: بدون جمله‌ی ثابت؛ کمبود = فقط ✍️ و ⏭
sent.length = 0;
await sendSceneMessage(1, "روایت", ["الف", "ب", "ج"], 7);
let kb = sent[0].reply_markup.inline_keyboard.flat();
assert.deepEqual(kb.map((b) => b.callback_data), ["sug_7_0", "sug_7_1", "sug_7_2", "sug_skip_7"]);
assert.equal(sent[0].text, "روایت");
sent.length = 0;
await sendSceneMessage(1, "روایت", [], 7);
kb = sent[0].reply_markup.inline_keyboard.flat();
assert.deepEqual(kb.map((b) => b.callback_data), ["sug_write_7", "sug_skip_7"]);
assert.ok(kb[0].text.includes("✍️") && kb[1].text.includes("⏭"));
ok("sendSceneMessage: جملهٔ ثابت حذف؛ ۳ دکمه + ⏭، و در کمبود فقط ✍️ و ⏭");
