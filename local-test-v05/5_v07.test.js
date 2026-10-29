import assert from "node:assert/strict";
import { tables, sent } from "sdk";
import * as T from "lib/core/trace";
import { handleTraceCommand } from "handlers/traceCommands";
import { serializeCheckResults, computeClock } from "lib/game/events";
import { checksToDiceText, TIME_MENU } from "lib/game/resolver";
import { blockedToDiceText, skippedToDiceText, serializeBlocked, serializeSkipped } from "lib/game/blocked";
import { timeLine } from "lib/world/locations";
import { buildMemoryRow } from "lib/game/memory";
import { degreeFor } from "lib/core/degrees";
const CHAT = -100;
let n = 0; const ok = (m) => console.log("✅", ++n, m);
const say = async (cmd) => { sent.length = 0; await handleTraceCommand(5, cmd); return sent.map((m) => m.text).join("\n"); };
const rowOf = (name, round) => tables[name].find((r) => r.round === round);

const chk = (o) => { const total = o.roll + o.mod + (o.prof || 0); const margin = total - o.dc; return { name: o.name, skill: o.skill || "Athletics", reason: o.reason || "تلاش", ability: "STR", roll: o.roll, rolls: [o.roll], mode: "normal", mod: o.mod, profBonus: o.prof || 0, env: [], total, dc: o.dc, dcBase: o.dcBase ?? o.dc, tierBonus: o.tierBonus ?? 0, margin, degree: degreeFor(margin), actionId: o.actionId, srcIndex: o.src, chain: o.chain || null, groupId: o.groupId || null }; };
const P = (name, kind = "free", content = "x") => ({ name, tgId: 1, action: { kind, content } });

async function makeRound(round, { results, plan = {}, decChecks, tier = 2, before = 48.25 }) {
  const time = TIME_MENU[1];
  const clock = computeClock(before, null, null, time.hours);
  const dice = [checksToDiceText(results), blockedToDiceText(plan.blocked), skippedToDiceText(plan.skipped)].filter(Boolean).join("\n\n");
  const sceneText = `${timeLine(clock.elapsed)}\n\nروایت ${round}${dice ? `\n\n${dice}` : ""}`;
  tables.event_plans.push({ id: round, chatId: CHAT, round, status: "committed", sceneText, plan: { checkResults: serializeCheckResults(results), travel: null, restPlan: null, time, blocked: [], skipped: [], autos: [], helps: [], ...plan, decision: { type: "checks", checks: decChecks, moved: false, distanceIndex: null, rest: null, timeIndex: 1, combat: null, problems: 0 } } });
  const ids = [`${CHAT}:${round}:scene:0`, ...results.map((_, i) => `${CHAT}:${round}:skill_check:${i}`)];
  for (const id of ids) tables.applied_events.push({ eventId: id, chatId: CHAT, round, type: id.split(":")[2] });
  const m = buildMemoryRow({ state: { players: [] }, checkResults: results, travel: null, restPlan: null, locationBefore: "مکان", worldHours: clock.elapsed, blocked: plan.blocked || [], skipped: plan.skipped || [], autos: plan.autos || [], helps: plan.helps || [] });
  tables.round_memory.push({ chatId: CHAT, round, outcomes: m.outcomes, changes: m.changes });
  await T.runWithTrace(CHAT, round, async () => { T.span("context", null, { tier }); T.span("clock", null, { before, after: clock.elapsed }); T.span("commit", "CONSEQ_APPLIED", {}, { refs: { eventIds: ids } }); T.setOutcome("ok"); });
}

// ---------- buildMemoryRow: خالص ----------
const blockedS = serializeBlocked([{ player: { name: "دانی", tgId: 2 }, actionKey: "lockpick", actionFa: "قفل‌گشایی", text: "باز کردن قفل", outcome: "missing", kind: "tool", missingTool: "thieves_tools", alternatives: [], code: "FEAS_MISSING_TOOL" }, { player: { name: "سارا", tgId: 3 }, actionKey: "other", actionFa: "سایر", text: "پرواز", outcome: "impossible", reason: "world_rule", code: null }]);
const skippedS = serializeSkipped([{ player: { name: "مانار", tgId: 1 }, text: "دزدی از کیف", parentText: "بالا رفتن", why: "parent_failed", step: 2, total: 2, actionId: "a2" }, { player: { name: "مانار", tgId: 1 }, text: "فرار", why: "deferred" }]);
const grp = [chk({ name: "مانار", roll: 15, mod: 1, dc: 15, groupId: "g1", reason: "عبور از باتلاق" }), chk({ name: "دانی", roll: 3, mod: 1, dc: 15, groupId: "g1", reason: "عبور از باتلاق" }), chk({ name: "سارا", roll: 18, mod: 0, dc: 15, groupId: "g1", reason: "عبور از باتلاق" })];
const mem = buildMemoryRow({ state: { players: [P("مانار"), P("دانی"), P("سارا"), P("علی", "skip")] }, checkResults: grp, blocked: blockedS, skipped: skippedS, autos: [{ name: "علی", text: "نگاه" }], helps: [{ helper: "دانی", target: "مانار" }] });
const o = mem.outcomes.map((x) => x.t);
assert.equal(o.length, 3 + 1 + 2 + 2 + 1);
assert.ok(o[0].includes("موفق شد (در تلاش گروهی)") && o[1].includes("ناموفق ماند (در تلاش گروهی)"));
assert.ok(o[3].startsWith("گروه (مانار، دانی، سارا) با هم «عبور از باتلاق»: موفق شدند (2 از 3 نفر)"));
assert.ok(o[4].includes("باز کردن قفل — انجام نشد (ابزار لازم را نداشت)") && o[5].includes("پرواز — انجام نشد (این کار در این دنیا ممکن نبود)"));
assert.ok(o[6].includes("انجام نشد چون مرحله‌ی قبلش موفق نشد") && o[7].includes("فرار — به دور بعد رفت") && o[8] === "دانی به مانار کمک کرد");
const a = mem.actions.map((x) => x.t);
assert.ok(a[0].startsWith("مانار: ") && a[0].includes("عبور از باتلاق") && !a[0].includes("اقدام آزاد"));
assert.equal(a[3], "علی: فقط همراهی کرد");
for (const bad of ["چک", "DC", "تاس", "Skill", "Feasibility"]) assert.ok(!JSON.stringify(mem).includes(bad), bad);
ok("buildMemoryRow: گروه، blocked، skipped، کمک، شرح اقدام (بدون اصطلاح فنی)");
const plain = buildMemoryRow({ state: { players: [P("دانی")] }, checkResults: [] });
assert.equal(plain.actions[0].t, "دانی: اقدام آزاد"); assert.equal(plain.outcomes.length, 0); ok("بدون داده: «اقدام آزاد» و بدون پیامد (سازگار با گذشته)");

// ---------- /replay: زنجیره و DC با Tier ----------
const c1 = chk({ name: "دانی", roll: 19, mod: 2, dc: 20, dcBase: 15, tierBonus: 5, reason: "بالا رفتن", actionId: "a1", src: 1, chain: { id: "c1", step: 1, total: 2 } });
const c2 = chk({ name: "دانی", skill: "SleightOfHand", roll: 12, mod: 2, dc: 20, dcBase: 15, tierBonus: 5, reason: "دزدی", actionId: "a2", src: 2, chain: { id: "c1", step: 2, total: 2 } });
const dch = (r, d = "medium") => ({ tgId: 5, skill: r.skill, difficulty: d, opponentRole: null, actionId: r.actionId, chainStep: r.chain?.step ?? null });
await makeRound(20, { results: [c1, c2], decChecks: [dch(c1), dch(c2)], tier: 3, plan: { blocked: blockedS, skipped: skippedS, autos: [], helps: [{ helper: "مانار", target: "دانی" }] } });
let out = await say("/replay 20");
assert.ok(out.includes("✅ زنجیره c1 مرحله 2") && out.includes("بعد از موفقیت مرحله‌ی قبل"));
assert.ok(out.includes("DC 20") && !out.includes("⚠️")); ok("replay: DC با Tier ۳ (۱۵+۵=۲۰) و زنجیره ✅ و خط‌های 🚫/⛔ داخل متن صحنه");

const mutate = async (title, round, fn, re) => { const undo = fn(); const o2 = await say(`/replay ${round}`); assert.match(o2, re, title); assert.match(o2, /نتیجه: ⚠️/, title); undo(); assert.ok(!(await say(`/replay ${round}`)).includes("⚠️"), "بازگردانی " + title); ok("جهش → ⚠️: " + title); };
const p20 = () => rowOf("event_plans", 20).plan;
await mutate("DC بدون تعدیل Tier در سطح ۳", 20, () => { const c = p20().checkResults[0]; const od = c.dc, ot = c.tierBonus; c.dc = 15; c.tierBonus = 0; return () => { c.dc = od; c.tierBonus = ot; }; }, /DC از «medium»: انتظار 20، ثبت‌شده 15/);
await mutate("مرحله ۲ بعد از شکست مرحله ۱ تاس شده", 20, () => { const c = p20().checkResults[0]; const om = c.margin; c.margin = -3; return () => (c.margin = om); }, /مرحله‌ی قبل موفق نبود \(فاصله -3\) ولی این مرحله تاس شده/);
await mutate("خط 🚫 داخل متن صحنه عوض شده", 20, () => { const r = rowOf("event_plans", 20); const o3 = r.sceneText; r.sceneText = o3.replace("🚫 دانی", "🚫 کس دیگر"); return () => (r.sceneText = o3); }, /این خط بازسازی‌شده توی متن ارسالی نیست/);
await mutate("خط ⛔ داخل متن صحنه حذف شده", 20, () => { const r = rowOf("event_plans", 20); const o3 = r.sceneText; r.sceneText = o3.split("\n").filter((l) => !l.startsWith("⛔")).join("\n"); return () => (r.sceneText = o3); }, /این خط بازسازی‌شده توی متن ارسالی نیست/);
await mutate("پیامد حافظه برای blocked فرق دارد", 20, () => { const m = rowOf("round_memory", 20); const i = m.outcomes.findIndex((x) => x.t.includes("انجام نشد (")); const o3 = m.outcomes[i].t; m.outcomes[i].t = "چیز دیگری"; return () => (m.outcomes[i].t = o3); }, /حافظه‌ی دور — پیامدها فرق دارن/);

// ---------- Plan قدیمی (قبل از V07): بدون tierBonus/actionId/chain ----------
const old = { name: "دانار", skill: "Perception", reason: "بررسی", ability: "WIS", roll: 15, mod: 1, profBonus: 0, env: [], total: 16, dc: 15, margin: 1, degree: degreeFor(1) };
await makeRound(21, { results: [old], decChecks: [{ tgId: 9, skill: "Perception", difficulty: "medium", opponentRole: null }], tier: 3 });
out = await say("/replay 21"); assert.ok(!out.includes("⚠️"), out); ok("Plan قدیمی (بدون tierBonus) در Tier ۳ هم ⚠️ نمی‌دهد");

// ---------- /why برای چک زنجیره‌ای و برتری ----------
const adv = { ...c1, mode: "advantage", rolls: [6, 19], advSources: [{ source: "help", by: "مانار" }], disSources: [] };
tables.event_plans.find((r) => r.round === 20).plan.checkResults[0] = serializeCheckResults([adv])[0];
out = await say("/why 20:skill_check:0");
assert.ok(out.includes("زنجیره: مرحله 1 از 2 (c1، a1)") && out.includes("برتری/ضعف: advantage | برتری: کمک مانار | تاس‌ها: 6 و 19") && out.includes("DC 20 (پایه 15 + مکان سطح بالا 5)"), out);
ok("/why: زنجیره، برتری با منبع و تاس‌ها، DC با Tier");
console.log("📊 تمام");
