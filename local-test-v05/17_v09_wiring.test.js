import assert from "node:assert/strict";
import { tables } from "./fake_sdk.mjs";
import {
  ensureStartLocation,
  planTravel,
  travelNarratorNote,
  locationContextText,
} from "lib/world/locations";
let n = 0;
const ok = (m) => console.log("✅", ++n, m);

// AI جعلی: همیشه یک JSON برمی‌گرداند و پیام کاربر را ثبت می‌کند
let replies = [];
const seen = [];
globalThis.__fakeFetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  seen.push(body.messages.at(-1).content);
  const content = replies.length > 1 ? replies.shift() : replies[0];
  return { ok: true, json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
};
const provider = { name: "fake", model: "m", url: "http://fake", apiKey: "k" };
const good = (extra) =>
  JSON.stringify({
    name: "میخانهٔ سیاه",
    theme: "میخانه‌ای دودگرفته با تیرهای کج و بوی آبجوی کهنه",
    rules: [],
    environments: [8],
    hostility: 4,
    pop: 4,
    roles: [2, 3],
    ...extra,
  });

tables.world_lore.push({ chatId: 1, loreText: "دنیای تست" });
tables.session_log.push({ chatId: 1, role: "narrator", content: "گروه به میخانه رسید" });
tables.game_sessions.push({ chatId: 1, currentLocationId: null });
tables.world_clock.push({ chatId: 1, elapsedHours: 22.5 });

// ۱) مکان شروع: پرامپت منو و ساعت روز دارد؛ hostility=high به low محدود می‌شود
replies = [good()];
const start = await ensureStartLocation(1, provider);
assert.ok(start);
const prompt = seen.at(-1);
assert.ok(prompt.includes("فهرست نوع محیط") && prompt.includes("فهرست جمعیت"));
assert.ok(prompt.includes("ساعت روز هنگام ورود به این مکان: شب"));
assert.ok(!prompt.includes("سطح خطر مکان مقصد"), "مکان شروع tier نمی‌پرسد");
const row = tables.locations[0];
assert.equal(row.hostility, "low");
assert.deepEqual(row.environments, ["urban"]);
assert.equal(row.population.step, 4);
assert.ok(row.population.count >= 10 && row.population.count <= 20);
assert.equal(row.population.hours, 22.5);
assert.equal(row.tier, 1);
ok("مکان شروع: منو و ساعت روز در پرامپت، hostility ≤ low، جمعیت با ساعت شروع ذخیره شد");

// ۲) خروجی قدیمی AI (بدون فیلد تازه): مشکل ← دوباره‌پرسی ← در نهایت پیش‌فرض امن
tables.locations.length = 0;
tables.game_sessions[0].currentLocationId = null;
seen.length = 0;
replies = [JSON.stringify({ name: "دهکده", theme: "دهکده‌ای آرام کنار رود بزرگ", rules: [] })];
const s2 = await ensureStartLocation(1, provider);
assert.ok(s2);
assert.equal(seen.length, 2, "یک بار دوباره پرسیده شد");
assert.ok(seen[1].includes("پاسخ قبلی تو مشکل داشت"));
const r2 = tables.locations[0];
assert.equal(r2.hostility, "none");
assert.equal(r2.population, null);
assert.deepEqual(r2.environments, []);
ok("خروجی ناقص AI: یک بار دوباره‌پرسی، بعد پیش‌فرض امن (none، بدون جمعیت)");

// ۳) سفر: tier از prevTier+1 بیشتر نمی‌شود؛ hostility بدون محدودیت شروع؛ ساعت رسیدن با گردکردن ۶ساعته
seen.length = 0;
replies = [good({ tier: 4, hostility: 4, pop: 1, roles: [] })];
const here = { id: 7, chatId: 1, tier: 1, name: "قبلی" };
tables.world_clock[0].elapsedHours = 10; // صبح
const tr = await planTravel({ moved: true, distanceIndex: 3 }, "ctx", here, provider); // یک روز = ۲۴ ساعت
assert.equal(tr.location.tier, 2);
assert.equal(tr.location.hostility, "high");
assert.equal(tr.location.population.count, 0);
assert.deepEqual(tr.location.population.composition, []);
assert.equal(tr.location.population.hours, 34); // 10 + 24
assert.ok(seen[0].includes("ساعت روز هنگام ورود به این مکان: صبح")); // ساعت ۳۴ = ۱۰ صبح روز بعد
assert.ok(seen[0].includes("سطح خطر مکان مقصد"));
ok("سفر: tier ≤ قبلی+۱، hostility آزاد، ساعت رسیدن = ساعت فعلی + گردشدهٔ سفر");

// ۴) سفر کوتاه (۱ ساعت) به ۶ ساعت گرد می‌شود
seen.length = 0;
replies = [good({ tier: 1 })];
const tr2 = await planTravel({ moved: true, distanceIndex: 0 }, "ctx", here, provider);
assert.equal(tr2.location.population.hours, 16);
ok("سفر یک‌ساعته مثل computeClock به ۶ ساعت گرد می‌شود");

// ۵) یادداشت راوی سفر: محیط و جمعیت هست، hostility و tier نه
const note = travelNarratorNote(tr2);
assert.ok(note.includes("نوع محیط: شهر یا آبادی"));
assert.ok(note.includes("جمعیت حاضر: حدود"));
assert.ok(!note.includes("high") && !note.includes("hostility") && !/سطح\s*\d/.test(note));
ok("یادداشت سفر برای راوی: محیط و جمعیت دارد، DM-Only ندارد");

// ۶) ردیف مکان ذخیره‌شده ← Context راوی
const ctx = locationContextText({ ...tables.locations[0] });
assert.ok(ctx.includes("مکان فعلی:"));
assert.ok(!ctx.includes("none") && !ctx.includes("low"));
ok("Context مکان از ردیف ذخیره‌شده بدون فیلد DM-Only ساخته می‌شود");
