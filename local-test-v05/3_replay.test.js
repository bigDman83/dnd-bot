import assert from "node:assert/strict";
import { tables, sent } from "sdk";
import * as T from "lib/core/trace";
import { handleTraceCommand, parseReplayArgs, runReplay } from "handlers/traceCommands";
import { serializeCheckResults, computeClock, clockAfter } from "lib/game/events";
import { checksToDiceText, TIME_MENU } from "lib/game/resolver";
import { restToDiceText } from "lib/world/rest";
import { timeLine } from "lib/world/locations";
import { buildMemoryRow } from "lib/game/memory";
import { degreeFor } from "lib/core/degrees";
const CHAT = -100;
let n = 0; const ok = (m) => console.log("✅", ++n, m);
const say = async (cmd) => { sent.length = 0; await handleTraceCommand(5, cmd); return sent.map((m) => m.text).join("\n"); };
const rowOf = (name, round) => tables[name].find((r) => r.round === round);

const check = (o) => { const total = o.roll + o.mod + o.prof + (o.env || []).reduce((s, e) => s + e.delta, 0); const margin = total - o.dc; return { name: o.name, skill: "Perception", reason: "بررسی دیوارها", ability: "WIS", roll: o.roll, mod: o.mod, profBonus: o.prof, env: o.env || [], total, dc: o.dc, margin, degree: degreeFor(margin) }; };
const contest = () => ({ name: "دانی", skill: "Persuasion", reason: "قانع‌کردن نگهبان", ability: "CHA", roll: 12, mod: 2, profBonus: 2, env: [], total: 16, opponentLabel: "نگهبان", margin: 3, degree: degreeFor(3) });

// یک دور کامل (Plan + Events + حافظه + trace) مثل چیزی که COMMIT می‌سازد
async function makeRound(round, { results = [], decision = {}, travel = null, restPlan = null, timeIndex = 1, before = 48.25, status = "committed", withTrace = true, withMemory = true } = {}) {
  const time = TIME_MENU[timeIndex];
  const clock = computeClock(before, travel, restPlan, time.hours);
  const dice = [checksToDiceText(results), restToDiceText(restPlan)].filter(Boolean).join("\n");
  const sceneText = `${timeLine(clock.elapsed)}\n\nروایت دور ${round}${dice ? `\n\n${dice}` : ""}`;
  const dec = decision === null ? undefined : { type: "narrative", checks: results.map((r, i) => ({ tgId: 100 + i, skill: r.skill, difficulty: "medium", opponentRole: r.opponentLabel ? 2 : null })), moved: !!travel, distanceIndex: travel ? 3 : null, rest: restPlan ? "long" : null, timeIndex, combat: null, problems: 0, ...decision };
  tables.event_plans.push({ id: round, chatId: CHAT, round, plan: { checkResults: serializeCheckResults(results), travel, restPlan, time, ...(dec ? { decision: dec } : {}) }, status, sceneText });
  const ids = [`${CHAT}:${round}:scene:0`, ...results.map((_, i) => `${CHAT}:${round}:skill_check:${i}`), ...(travel?.traveled ? [`${CHAT}:${round}:travel:0`] : []), ...(restPlan ? [`${CHAT}:${round}:rest:0`] : [])];
  if (status === "committed") for (const id of ids) tables.applied_events.push({ eventId: id, chatId: CHAT, round, type: id.split(":")[2] });
  if (withMemory) { const m = buildMemoryRow({ state: { players: [] }, checkResults: results, travel, restPlan, locationBefore: "مکان قبلی", worldHours: clock.elapsed }); tables.round_memory.push({ chatId: CHAT, round, outcomes: m.outcomes, changes: m.changes }); }
  if (withTrace) await T.runWithTrace(CHAT, round, async () => { T.span("clock", null, { before, after: clock.elapsed }); T.span("commit", "CONSEQ_APPLIED", {}, { refs: { eventIds: ids } }); T.setOutcome("ok"); });
  return { clock, ids };
}

// ---------- parse ----------
assert.deepEqual(parseReplayArgs([]), { kind: "last" }); assert.deepEqual(parseReplayArgs(["last"]), { kind: "last" });
assert.deepEqual(parseReplayArgs(["7"]), { kind: "round", round: 7 }); assert.deepEqual(parseReplayArgs(["tmv8q9t5mm1y4"]), { kind: "trace", traceId: "tmv8q9t5mm1y4" });
assert.deepEqual(parseReplayArgs(["abc"]), { kind: "usage" }); assert.deepEqual(parseReplayArgs(["-3"]), { kind: "usage" }); ok("parseReplayArgs");

// computeClock هم‌ارز clockAfter قدیمی (فرمول عیناً همان)
const oldClock = (before, travel, restPlan, th) => { let e = before; if (travel?.traveled) e += Math.max(1, Math.round(travel.hours / 6)) * 6; let l = null; if (restPlan) { if (restPlan.kind === "long") l = e; e += Math.max(0, Math.round(restPlan.hours)); } if (!travel?.traveled && !restPlan) e += th; return { elapsed: e, lastLongRestHours: l, before }; };
for (let i = 0; i < 3000; i++) { const b = Math.round(Math.random() * 400) / 4; const tr = Math.random() < 0.3 ? { traveled: true, hours: [1, 4, 12, 24, 72, 168][i % 6] } : null; const rp = Math.random() < 0.3 ? { kind: Math.random() < 0.5 ? "long" : "short", hours: Math.random() < 0.5 ? 8 : 1 } : null; const th = [0, 0.25, 1, 6, 24][i % 5]; assert.deepEqual(computeClock(b, tr, rp, th), oldClock(b, tr, rp, th)); }
ok("computeClock = فرمول قدیمی clockAfter روی ۳۰۰۰ ورودی تصادفی");

// ---------- دور ۷: دو تاس ساده ----------
const r7 = [check({ name: "دانار", roll: 15, mod: 1, prof: 0, env: [{ label: "تاریکی", delta: -2 }], dc: 15 }), check({ name: "دانی", roll: 18, mod: 1, prof: 0, env: [{ label: "تاریکی", delta: -2 }], dc: 15 })];
await makeRound(7, { results: r7 });
let out = await say("/replay 7");
assert.match(out, /🔁 Replay دور 7 — تلاش 1 از 1/); assert.match(out, /فقط گام‌های کد دوباره اجرا شد؛ AI صدا زده نشد/);
assert.ok(out.includes("✅ تاس 1 (دانار، Perception): 15+1+0-2=14 در برابر DC 15 ← fail"));
assert.ok(out.includes("✅ زمان دور: شماره 2 ← minutes") && out.includes("✅ ساعت جهان: 48.25 ← 48.5") && out.includes("✅ خط زمان صحنه: "));
assert.ok(out.includes("✅ Eventها: scene:0، skill_check:0، skill_check:1") && out.includes("✅ متن صحنه: 2 خط تاس/استراحت") && out.includes("✅ حافظه‌ی دور: 2 پیامد یکی است"));
assert.match(out, /نتیجه: ✅ همه‌ی 8 بررسی با نتیجه‌ی اصلی یکی بود/); assert.ok(!out.includes("⚠️"));
ok("دور سالم: همه ✅ (تاس، زمان، ساعت، خط زمان، Eventها، متن صحنه، حافظه)");
const tid = tables.trace_ring.find((r) => r.round === 7).attempts[0].traceId;
assert.equal(await say("/replay"), out); assert.equal((await say(`/replay ${tid}`)).replace(/\n.*$/s, ""), out.replace(/\n.*$/s, "")); ok("/replay بدون ورودی و با traceId همان دور را بازپخش می‌کنند");

// ---------- جهش‌ها: هرکدام باید دقیقاً ⚠️ بدهد ----------
const mutate = async (title, fn, expectRe, restore) => { const undo = fn(); const o = await say("/replay 7"); assert.match(o, expectRe, title); assert.match(o, /نتیجه: ⚠️/, title); undo(); assert.ok(!(await say("/replay 7")).includes("⚠️"), "بازگردانی " + title); ok("جهش → ⚠️: " + title); };
const plan7 = () => rowOf("event_plans", 7).plan;
await mutate("جمع تاس غلط", () => { const c = plan7().checkResults[0]; const o = c.total; c.total = 15; return () => (c.total = o); }, /⚠️ تاس 1 \(دانار، Perception\) — جمع: انتظار 14، ثبت‌شده 15/);
await mutate("DC با سختی نمی‌خواند", () => { const c = plan7().checkResults[0]; const o = c.dc; c.dc = 10; return () => (c.dc = o); }, /DC از «medium»: انتظار 15، ثبت‌شده 10/);
await mutate("درجه غلط", () => { const c = plan7().checkResults[1]; const o = c.degree; c.degree = "great"; return () => (c.degree = o); }, /⚠️ تاس 2 .*درجه: انتظار success، ثبت‌شده great/);
await mutate("زمان دور با منو نمی‌خواند", () => { const p = plan7(); const o = p.time; p.time = TIME_MENU[2]; return () => (p.time = o); }, /⚠️ زمان دور — انتظار minutes، ثبت‌شده hour/);
await mutate("ساعت جهان فرق دارد", () => { const sp = rowOf("trace_ring", 7).attempts[0].spans.find((s) => s.step === "clock"); const o = sp.data.after; sp.data.after = 49; return () => (sp.data.after = o); }, /⚠️ ساعت جهان — انتظار 48.5، ثبت‌شده 49/);
await mutate("Event اعمال‌نشده", () => { const i = tables.applied_events.findIndex((e) => e.eventId.endsWith("7:skill_check:1")); const [rm] = tables.applied_events.splice(i, 1); return () => tables.applied_events.push(rm); }, /⚠️ Eventها — انتظار .* ثبت‌شده scene:0، skill_check:0/);
await mutate("خط تاس داخل متن صحنه عوض شده", () => { const r = rowOf("event_plans", 7); const o = r.sceneText; r.sceneText = o.replace("تاس 15", "تاس 99"); return () => (r.sceneText = o); }, /⚠️ متن صحنه — این خط بازسازی‌شده توی متن ارسالی نیست/);
await mutate("خط زمان صحنه فرق دارد", () => { const r = rowOf("event_plans", 7); const o = r.sceneText; r.sceneText = o.replace(/^[^\n]*/, "🕐 روز ۹، شب"); return () => (r.sceneText = o); }, /⚠️ خط زمان صحنه/);
await mutate("پیامد حافظه فرق دارد", () => { const m = rowOf("round_memory", 7); const o = m.outcomes[0].t; m.outcomes[0].t = "چیز دیگری"; return () => (m.outcomes[0].t = o); }, /⚠️ حافظه‌ی دور — پیامدها فرق دارن/);

// ---------- تقابل با NPC ----------
await makeRound(10, { results: [contest()] });
out = await say("/replay 10"); assert.ok(out.includes("✅ تاس 1 (دانی، Persuasion): 12+2+2=16 در برابر نگهبان (تقابل؛ تاس NPC ذخیره نمیشه) ← success") && !out.includes("⚠️")); ok("تقابل: فقط جمع و درجه از فاصله چک می‌شود");

// ---------- استراحت تبدیل‌شده (مثل دور ۵ واقعی) ----------
const restPlan = { kind: "short", downgraded: true, hoursSince: 10.25, hours: 1, startHour: 46.25, lines: ["⏳ از شروع استراحت طولانی قبلی فقط 10 ساعت گذشته؛ استراحت طولانی دوباره ممکن نیست، پس فقط یک استراحت کوتاه انجام شد.", "🛏 استراحت کوتاه — 1 ساعت گذشت.", "💚 دانار — HP کامل بود (12/12)"] };
await makeRound(5, { restPlan, before: 46.25 });
out = await say("/replay 5"); assert.ok(out.includes("✅ ساعت جهان: 46.25 ← 47.25") && out.includes("✅ متن صحنه: 3 خط") && out.includes("✅ Eventها: scene:0، rest:0") && out.includes("✅ حافظه‌ی دور: جمله‌ی استراحت یکی است") && !out.includes("⚠️")); ok("استراحت تبدیل‌شده: ساعت +۱، خط‌های HP در متن، جمله‌ی حافظه");

// ---------- سفر ----------
await makeRound(11, { travel: { traveled: true, hours: 12, distanceLabel: "نیم‌روز", location: { name: "دره‌ی مه", tier: 2 } }, before: 30.25 });
out = await say("/replay 11"); assert.ok(out.includes("✅ ساعت جهان: 30.25 ← 42.25") && out.includes("✅ Eventها: scene:0، travel:0") && !out.includes("⚠️")); ok("سفر: +۱۲ ساعت (مضرب ۶)، Event سفر");

// ---------- Plan بدون decision (دور قدیمی) و Plan هنوز commit نشده و بدون trace ----------
await makeRound(3, { results: r7.slice(0, 1), decision: null, withTrace: false, withMemory: false });
out = await say("/replay 3"); assert.ok(out.includes("🔁 Replay دور 3 — بدون trace") && out.includes("➖ زمان دور: تصمیم Resolver توی Plan نیست") && out.includes("➖ ساعت جهان: span ساعت") && out.includes("➖ حافظه‌ی دور: پاک شده") && out.includes("(DC بدون تصمیم Resolver چک نشد)") && !out.includes("⚠️")); ok("Plan قدیمی بدون decision/trace/حافظه: ➖ بدون تفاوت‌ساختگی");
await makeRound(12, { results: r7.slice(0, 1), status: "planned" });
out = await say("/replay 12"); assert.ok(out.includes("Plan: planned") && out.includes("➖ Eventها: این Plan هنوز COMMIT نشده") && !out.includes("⚠️")); ok("Plan هنوز COMMIT نشده: Eventها ➖");

// ---------- دور نبرد/ناموجود، traceId ناموجود ----------
out = await say("/replay 99"); assert.match(out, /Plan ندارد.*\/trace 99/s); ok("دور بدون Plan");
out = await say("/replay tnotexist12345"); assert.match(out, /پیدا نشد/); out = await say("/replay xyz"); assert.match(out, /فرمت درست/); ok("traceId ناموجود و ورودی نامعتبر");

// ---------- دور بدون تاس: ➖ ----------
await makeRound(13, { results: [] });
out = await say("/replay 13"); assert.ok(out.includes("➖ این دور تاسی نداشت") && !out.includes("⚠️")); ok("دور بدون تاس");
// ---------- صحت clockAfter با readClock (دیتابیس) هنوز سالم import می‌شود ----------
assert.equal(typeof clockAfter, "function"); ok("clockAfter هنوز export است");
console.log("\nهمه‌ی تست‌های /replay پاس شد");
