import assert from "node:assert/strict";
import { tables, sent } from "sdk";
import * as T from "lib/core/trace";
import { handleTraceCommand, formatTrace, splitChunks, dataSummary, describeDebug } from "handlers/traceCommands";
// داده‌ی نمونه، مثل دور واقعی ۵ (از خروجی کاربر)
await T.runWithTrace(1, 5, async () => {
  T.span("lock", null, { round: 5, players: 2 });
  T.span("resolver", null, { type: "narrative", checks: [{ tgId: 9, skill: "Perception", difficulty: "medium", opponentRole: null }], moved: false, rest: "long", timeIndex: 1, combat: null, problems: 0 });
  T.span("ai_call", null, { promptKey: "round_resolver", provider: "openrouter", ok: true, ms: 2302, promptTokens: 2805 }, { debug: { prompt: "p".repeat(2000) } });
  T.span("rest", "REST_SHORT_BENEFIT", { asked: "long", kind: "short", downgraded: true, hours: 1 });
  T.recordError("ai_call", new Error("خطا"), { provider: "x" });
  T.span("commit", "CONSEQ_APPLIED", { round: 5 }, { refs: { eventIds: ["-1:5:scene:0", "-1:5:rest:0"] } });
  T.setOutcome("ok");
});
await T.runWithTrace(1, 6, async () => { T.span("lock", null, {}); });
await T.runWithTrace(1, 6, async () => { T.span("lock", null, { again: true }); });
let n = 0; const ok = (m) => console.log("✅", ++n, m);

// formatTrace
const row5 = tables.trace_ring.find((r) => r.round === 5);
const lines = formatTrace(row5);
assert.match(lines[0], /دور 5 \| تلاش 1 از 1/); assert.match(lines[2], /ok \| .* ثانیه \| debug: خاموش/);
assert.ok(lines.some((l) => /resolver .*type=narrative .*rest=long/.test(l)) && !lines.some((l) => /combat=/.test(l)));
assert.ok(lines.some((l) => l.includes("[REST_SHORT_BENEFIT]")) && lines.some((l) => l.includes("❌ ai_call")));
assert.ok(lines.some((l) => l.startsWith("   ↳ eventIds: -1:5:scene:0, -1:5:rest:0")));
ok("formatTrace: سرتیتر، data بدون null، کد دلیل، ❌، refs");
assert.equal(dataSummary({ a: 1.23456, b: "x".repeat(60), c: true, d: null, e: [1, 2] }), `a=1.23 b=${"x".repeat(40)}… c=true e=[1,2]`); ok("dataSummary");

// splitChunks
const big = Array.from({ length: 200 }, (_, i) => `خط ${i} ` + "ی".repeat(60));
const ch = splitChunks(big); assert.ok(ch.length > 1 && ch.every((c) => c.length <= 3800) && ch.join("\n").split("\n").length === 200); ok("splitChunks: زیر ۳۸۰۰ و بدون گم‌شدن خط");

// describeDebug
assert.match(describeDebug(0), /خاموش/); assert.match(describeDebug(1000 + 3 * 3600 + 120, 1000), /3 ساعت و 2 دقیقه/); assert.match(describeDebug(500, 1000), /خاموش/); ok("describeDebug");

// handler
sent.length = 0;
assert.equal(await handleTraceCommand(77, "/hello"), false); assert.equal(sent.length, 0); ok("دستور دیگر: false و بی‌پیام");
await handleTraceCommand(77, "/trace");               // آخرین = دور ۶ (دو بار نوشته شده)
assert.match(sent[0].text, /دور 6 \| تلاش 2 از 2/); assert.equal(sent[0].chat_id, 77); ok("/trace آخرین دور را با آخرین تلاش نشان می‌دهد");
sent.length = 0; await handleTraceCommand(77, "/trace 6 1");
assert.match(sent[0].text, /تلاش 1 از 2/) ; assert.ok(!sent[0].text.includes("again=true")); ok("/trace 6 1 تلاش اول");
sent.length = 0; await handleTraceCommand(77, "/trace 5");
assert.match(sent[0].text, /دور 5/); ok("/trace 5");
sent.length = 0; await handleTraceCommand(77, "/trace 999"); assert.match(sent[0].text, /توی trace نیست/);
sent.length = 0; await handleTraceCommand(77, "/trace 6 9"); assert.match(sent[0].text, /فقط 2 تلاش/);
sent.length = 0; await handleTraceCommand(77, "/trace abc"); assert.match(sent[0].text, /فرمت درست/);
sent.length = 0; await handleTraceCommand(77, "/trace 5 x"); assert.match(sent[0].text, /فرمت درست/); ok("ورودی‌های نامعتبر");
// debug
sent.length = 0; await handleTraceCommand(77, "/debug"); assert.match(sent[0].text, /خاموش/);
await handleTraceCommand(77, "/debug on"); assert.match(sent[1].text, /24 ساعت روشن شد/);
await handleTraceCommand(77, "/debug"); assert.match(sent[2].text, /روشن است؛ 23 ساعت و 59 دقیقه|روشن است؛ 24 ساعت و 0 دقیقه/);
await handleTraceCommand(77, "/debug off"); assert.match(sent[3].text, /خاموش شد/);
await handleTraceCommand(77, "/debug maybe"); assert.match(sent[4].text, /فرمت درست/); ok("/debug: وضعیت، on، off، نامعتبر");
// debug trace نمایش dbg
await T.setDebug(true);
await T.runWithTrace(1, 7, async () => T.span("ai_call", null, { ok: true }, { debug: { prompt: "پرسش", response: "پاسخ" } }));
sent.length = 0; await handleTraceCommand(77, "/trace 7");
assert.ok(sent[0].text.includes("🐞 prompt: پرسش") && sent[0].text.includes("debug: روشن")); ok("نمایش dbg در حالت debug");
// خروجی طولانی: سقف ۶ تکه
for (let i = 0; i < 70; i++) {}
await T.runWithTrace(1, 8, async () => { for (let i = 0; i < 80; i++) T.span("s", null, { k: "ی".repeat(35), k2: "ی".repeat(35), k3: "ی".repeat(35), k4: "ی".repeat(35), i }); });
sent.length = 0; await handleTraceCommand(77, "/trace 8");
assert.ok(sent.length >= 2 && sent.every((m) => m.text.length <= 4096)); ok(`خروجی بلند در ${sent.length} پیام، همه ≤ ۴۰۹۶`);
