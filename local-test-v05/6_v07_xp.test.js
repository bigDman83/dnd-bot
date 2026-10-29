import assert from "node:assert/strict";
import { tables, sent } from "sdk";
import * as T from "lib/core/trace";
import { handleTraceCommand } from "handlers/traceCommands";
import { serializeCheckResults, computeClock, eventListFor } from "lib/game/events";
import { checksToDiceText, rollChecks, TIME_MENU } from "lib/game/resolver";
import { skillXpFor, xpToDiceText, SKILL_XP_TABLE } from "lib/core/xp";
import { timeLine } from "lib/world/locations";
import { buildMemoryRow } from "lib/game/memory";
import { degreeFor } from "lib/core/degrees";
const CHAT = -100;
let n = 0; const ok = (m) => console.log("✅", ++n, m);
const say = async (cmd) => { sent.length = 0; await handleTraceCommand(5, cmd); return sent.map((m) => m.text).join("\n"); };
const rowOf = (name, round) => tables[name].find((r) => r.round === round);

// ---------- skillXpFor: جدول و شرط‌ها ----------
const X = (dc, margin, extra = {}) => skillXpFor({ dc, margin, ...extra });
assert.equal(X(14, 5), 0); assert.equal(X(10, 9), 0);
assert.equal(X(15, 0), 10); assert.equal(X(15, -1), 0); assert.equal(X(19, 3), 10);
assert.equal(X(20, 0), 25); assert.equal(X(24, 1), 25); assert.equal(X(25, 2), 50); assert.equal(X(29, 2), 50); assert.equal(X(30, 0), 100);
assert.equal(X(20, 5, { opponentLabel: "نگهبان" }), 0); assert.equal(X(NaN, 1), 0); assert.equal(X(20, undefined), 0); assert.equal(skillXpFor(), 0);
assert.ok(SKILL_XP_TABLE.every((r, i, a) => i === 0 || a[i - 1].minDc > r.minDc), "جدول باید نزولی باشد");
ok("skillXpFor: فقط DC ≥ 15 و چک موفق، بدون تقابل؛ جدول نزولی");

// ---------- xpToDiceText ----------
const lines = xpToDiceText([{ name: "دانی", xp: 25, reason: "بالا رفتن", xpNext: 190 }, { name: "مانار", xp: 10, reason: "قفل", xpNext: 0 }, { name: "سارا", xp: 10, xpNext: null }, { name: "علی", xp: 10, reason: "x" }, { name: "بی‌XP", xp: 0, reason: "y" }]).split("\n");
assert.equal(lines.length, 4); assert.equal(lines[0], "✨ دانی: +25 XP — بالا رفتن · XP تا سطح بعد 190");
assert.ok(lines[1].endsWith("آستانهٔ سطح بعد پر شد")); assert.ok(lines[2].includes("چک مهارت") && lines[2].endsWith("به سطح بیشینه رسیده")); assert.equal(lines[3], "✨ علی: +10 XP — x");
assert.equal(xpToDiceText([]), ""); assert.equal(xpToDiceText(null), "");
ok("xpToDiceText: دلیل، «XP تا سطح بعد»، آستانه، سطح بیشینه، بدون XP حذف");

// ---------- eventListFor ----------
const ev = eventListFor({ checkResults: [{ xp: 10 }, { xp: 0 }, {}, { xp: 25 }], travel: null, restPlan: null });
assert.deepEqual(ev.map((e) => `${e.type}:${e.index}`), ["scene:0", "skill_check:0", "skill_check:1", "skill_check:2", "skill_check:3", "skill_xp:0", "skill_xp:3"]);
ok("eventListFor: skill_xp فقط برای چک‌های XPدار؛ Planهای قدیمی (بدون xp) Event اضافه نمی‌گیرند");

// ---------- rollChecks واقعی (سطح مکان و XP) ----------
const mkChar = (id, level, xp) => ({ id, name: "ش" + id, level, xp, abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }, skillProficiencies: [], proficiencyBonus: 2 });
tables.characters.push(mkChar(1, 1, 290), mkChar(2, 1, 0));
const chk = (pi, extra = {}) => ({ player: { name: "ب" + pi, tgId: 100 + pi, characterId: pi }, skill: "Athletics", difficulty: "medium", opponentRole: null, reason: "بالا رفتن", actionKey: "other", actionId: "a" + pi, srcIndex: pi, chain: null, disadvantage: [], advantage: [], ...extra });
const rnd = Math.random;
Math.random = () => 0.99; // تاس ۲۰ ← همیشه موفق
let res = await rollChecks([chk(1), chk(1, { difficulty: "hard", reason: "دوم" }), chk(2, { difficulty: "easy" })], { tier: 1, rules: [] }, {});
assert.deepEqual(res.map((r) => [r.dc, r.xp]), [[15, 10], [20, 25], [10, 0]]);
assert.deepEqual(res.map((r) => r.xpNext), [0, 0, 300]); // شخصیت ۱: ۲۹۰+۱۰=۳۰۰ ← آستانه پر؛ شخصیت ۲ هنوز ۳۰۰ مانده
assert.deepEqual(res.map((r) => r.characterId), [1, 1, 2]); assert.equal(res[0].tgId, 101);
// Tier ۳: «متوسط» می‌شود ۲۰ ← XP بیشتر
res = await rollChecks([chk(2)], { tier: 3, rules: [] }, {}); assert.deepEqual([res[0].dc, res[0].xp, res[0].tierBonus], [20, 25, 5]);
// شکست: بدون XP
Math.random = () => 0.0; res = await rollChecks([chk(2, { difficulty: "hard" })], { tier: 1, rules: [] }, {}); assert.equal(res[0].xp, 0); assert.ok(res[0].margin < 0);
Math.random = rnd;
ok("rollChecks: XP از DC نهایی (با Tier)، جمع جاری هر شخصیت در یک دور، شکست بدون XP");

// ---------- /replay و /why با XP ----------
const R = (o) => { const total = o.roll + o.mod; const margin = total - o.dc; return { name: o.name, skill: "Athletics", reason: o.reason, ability: "STR", roll: o.roll, rolls: [o.roll], mode: "normal", mod: o.mod, profBonus: 0, env: [], total, dc: o.dc, dcBase: o.dc, tierBonus: 0, margin, degree: degreeFor(margin), actionId: "a1", srcIndex: 1, chain: null, groupId: null, characterId: 7, tgId: 9, xp: o.xp, xpNext: o.xpNext }; };
const r1 = R({ name: "دانی", roll: 18, mod: 2, dc: 20, reason: "بالا رفتن از دیوار", xp: 25, xpNext: 190 });
const time = TIME_MENU[1]; const clock = computeClock(48.25, null, null, time.hours);
const dice = [checksToDiceText([r1]), xpToDiceText([r1])].filter(Boolean).join("\n\n");
const sceneText = `${timeLine(clock.elapsed)}\n\nروایت\n\n${dice}`;
tables.event_plans.push({ id: 30, chatId: CHAT, round: 30, status: "committed", sceneText, plan: { checkResults: serializeCheckResults([r1]), travel: null, restPlan: null, time, blocked: [], skipped: [], autos: [], helps: [], decision: { type: "checks", checks: [{ tgId: 9, skill: "Athletics", difficulty: "hard", opponentRole: null, actionId: "a1", chainStep: null }], moved: false, distanceIndex: null, rest: null, timeIndex: 1, combat: null, problems: 0 } } });
const ids = eventListFor({ checkResults: [r1] }).map((e) => `${CHAT}:30:${e.type}:${e.index}`);
for (const id of ids) tables.applied_events.push({ eventId: id, chatId: CHAT, round: 30, type: id.split(":")[2] });
tables.xp_log.push({ chatId: CHAT, round: 30, characterId: 7, amount: 25, source: "skill_check", reason: "بالا رفتن از دیوار", eventId: `${CHAT}:30:skill_xp:0` });
const m = buildMemoryRow({ state: { players: [] }, checkResults: [r1], worldHours: clock.elapsed });
tables.round_memory.push({ chatId: CHAT, round: 30, outcomes: m.outcomes, changes: m.changes });
await T.runWithTrace(CHAT, 30, async () => { T.span("context", null, { tier: 1 }); T.span("clock", null, { before: 48.25, after: clock.elapsed }); T.span("commit", "CONSEQ_APPLIED", {}, { refs: { eventIds: ids } }); T.setOutcome("ok"); });
assert.ok(ids.includes(`${CHAT}:30:skill_xp:0`));
let out = await say("/replay 30");
assert.ok(out.includes("✅ XP دانی: 25 (DC 20، فاصله 0)") && !out.includes("⚠️"), out); ok("replay: XP دوباره حساب و یکی است؛ خط ✨ داخل متن صحنه و Event skill_xp در applied_events");
const bad = async (title, fn, re) => { const undo = fn(); const o2 = await say("/replay 30"); assert.match(o2, re, title); undo(); assert.ok(!(await say("/replay 30")).includes("⚠️"), "بازگردانی " + title); ok("جهش → ⚠️: " + title); };
await bad("XP ثبت‌شده با جدول نمی‌خواند", () => { const c = rowOf("event_plans", 30).plan.checkResults[0]; c.xp = 50; return () => (c.xp = 25); }, /XP دانی: انتظار 25، ثبت‌شده 50/);
await bad("خط ✨ از متن صحنه حذف شده", () => { const r = rowOf("event_plans", 30); const o = r.sceneText; r.sceneText = o.split("\n").filter((l) => !l.startsWith("✨")).join("\n"); return () => (r.sceneText = o); }, /این خط بازسازی‌شده توی متن ارسالی نیست/);
// ---------- /why ----------
out = await say("/why 30:skill_xp:0");
assert.ok(out.includes("XP: +25 برای شخصیت شمارهٔ 7 | منبع: چک مهارت") && out.includes("دلیل: «بالا رفتن از دیوار»") && out.includes("DC 20 | فاصله 0") && out.includes("چک مرتبط: 30:skill_check:0"), out);
out = await say("/why 30:skill_check:0"); assert.ok(out.includes("XP: +25 (DC 20 و چک موفق) ← /why 30:skill_xp:0"), out);
tables.xp_log.length = 0; out = await say("/why 30:skill_xp:0"); assert.ok(out.includes("ردیف دفتر XP پیدا نشد"), out);
ok("/why: skill_xp با مبلغ، منبع، دلیل و چک مرتبط؛ چک اصلی لینک به XP؛ نبود ردیف دفتر");
// Plan قدیمی (بدون xp): بدون XP و بدون ⚠️
const old = { ...R({ name: "قدیم", roll: 15, mod: 1, dc: 15, reason: "x", xp: 0, xpNext: 1 }) }; delete old.xp; delete old.xpNext; delete old.characterId;
tables.event_plans.push({ id: 31, chatId: CHAT, round: 31, status: "committed", sceneText: `${timeLine(clock.elapsed)}\n\nروایت\n\n${checksToDiceText([old])}`, plan: { checkResults: serializeCheckResults([old]), travel: null, restPlan: null, time, decision: { type: "checks", checks: [{ tgId: 9, skill: "Athletics", difficulty: "medium", opponentRole: null }], moved: false, distanceIndex: null, rest: null, timeIndex: 1, combat: null, problems: 0 } } });
const ids2 = eventListFor({ checkResults: [old] }).map((e) => `${CHAT}:31:${e.type}:${e.index}`); for (const id of ids2) tables.applied_events.push({ eventId: id, chatId: CHAT, round: 31, type: id.split(":")[2] });
const m2 = buildMemoryRow({ state: { players: [] }, checkResults: [old], worldHours: clock.elapsed }); tables.round_memory.push({ chatId: CHAT, round: 31, outcomes: m2.outcomes, changes: m2.changes });
await T.runWithTrace(CHAT, 31, async () => { T.span("context", null, { tier: 1 }); T.span("clock", null, { before: 48.25, after: clock.elapsed }); T.span("commit", "CONSEQ_APPLIED", {}, { refs: { eventIds: ids2 } }); T.setOutcome("ok"); });
out = await say("/replay 31"); assert.ok(!out.includes("⚠️"), out); ok("Plan قدیمی (بدون فیلد xp) بازپخش می‌شود بدون ⚠️ و بدون Event اضافه");
console.log("📊 تمام");
