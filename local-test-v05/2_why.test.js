import assert from "node:assert/strict";
import { tables, sent } from "sdk";
import * as T from "lib/core/trace";
import {
  handleTraceCommand,
  parseWhyArgs,
  buildWhyLines,
} from "handlers/traceCommands";
let n = 0;
const ok = (m) => console.log("✅", ++n, m);
const CHAT = -5360103429;

// parseWhyArgs
assert.deepEqual(parseWhyArgs([]), { kind: "usage" });
assert.deepEqual(parseWhyArgs(["7"]), { kind: "list", chatId: null, round: 7 });
assert.deepEqual(parseWhyArgs(["7:skill_check:1"]), {
  kind: "event",
  chatId: null,
  round: 7,
  type: "skill_check",
  index: 1,
});
assert.deepEqual(parseWhyArgs(["7", "scene"]), {
  kind: "event",
  chatId: null,
  round: 7,
  type: "scene",
  index: 0,
});
assert.deepEqual(parseWhyArgs([`${CHAT}:7:skill_check:0`]), {
  kind: "event",
  chatId: CHAT,
  round: 7,
  type: "skill_check",
  index: 0,
});
for (const bad of [["abc"], ["7:flying:0"], ["7:rest:-1"], ["7:rest:x"]])
  assert.deepEqual(parseWhyArgs(bad), { kind: "usage" });
ok("parseWhyArgs: کامل، کوتاه، فهرست، نامعتبر");

// داده‌ی نمونه شبیه دور ۷ واقعی (+ یک دور ۹ با سفر و استراحت)
const ids7 = [
  `${CHAT}:7:scene:0`,
  `${CHAT}:7:skill_check:0`,
  `${CHAT}:7:skill_check:1`,
];
for (const id of ids7)
  tables.applied_events.push({
    eventId: id,
    chatId: CHAT,
    round: 7,
    type: id.split(":")[2],
  });
tables.event_plans.push({
  id: 1,
  chatId: CHAT,
  round: 7,
  plan: {
    checkResults: [
      {
        name: "دانار",
        skill: "Perception",
        ability: "WIS",
        roll: 15,
        mod: 1,
        profBonus: 0,
        env: [{ label: "تاریکی", delta: -2 }],
        total: 14,
        dc: 15,
        margin: -1,
        degree: "fail",
        reason: "بررسی دیوارهای خزه‌پوش",
      },
      {
        name: "دانی",
        skill: "Perception",
        ability: "WIS",
        roll: 18,
        mod: 1,
        profBonus: 0,
        env: [{ label: "تاریکی", delta: -2 }],
        total: 17,
        dc: 15,
        margin: 2,
        degree: "success",
        reason: "بررسی دیوارهای خزه‌پوش",
      },
    ],
    travel: null,
    restPlan: null,
    time: { key: "minutes", hours: 0.25 },
    decision: {
      type: "checks",
      checks: [
        {
          tgId: 111,
          skill: "Perception",
          difficulty: "medium",
          opponentRole: null,
        },
        {
          tgId: 222,
          skill: "Perception",
          difficulty: "medium",
          opponentRole: null,
        },
      ],
      moved: false,
      rest: null,
      timeIndex: 1,
    },
  },
});
tables.scene_actions.push({
  chatId: CHAT,
  round: 7,
  tgId: 111,
  kind: "free",
  content: "(بریم)[دیوارها رو بررسی می‌کنم]",
});
tables.round_memory.push({
  chatId: CHAT,
  round: 7,
  outcomes: [
    { v: "group", t: "دانار: بررسی دیوارهای خزه‌پوش — ناموفق ماند" },
    { v: "group", t: "دانی: بررسی دیوارهای خزه‌پوش — موفق شد" },
  ],
});
// trace: تلاش ۱ (timeout روایت، بدون commit) و تلاش ۲ (plan_reuse + commit)
await T.runWithTrace(CHAT, 7, async () => {
  T.span("roll", "CHECK_ROLLED", { who: "دانار" }, { ruleSource: "D&D CORE" });
  T.span("roll", "CHECK_ROLLED", { who: "دانی" }, { ruleSource: "D&D CORE" });
  T.recordError("ai_call", new Error("t"));
  T.setOutcome("error");
});
await T.runWithTrace(CHAT, 7, async () => {
  T.span("plan_reuse", null, {});
  T.span("clock", null, {
    before: 48.25,
    after: 48.5,
    timeKey: "minutes",
    timeHours: 0.25,
    traveled: false,
  });
  T.span("ai_call", "AI_FALLBACK_USED", {
    promptKey: "round_narrator",
    provider: "groq",
    ok: true,
    ms: 1839,
  });
  T.span(
    "commit",
    "CONSEQ_APPLIED",
    { round: 7 },
    { refs: { eventIds: ids7 } },
  );
  T.setOutcome("ok");
});

// handler: فهرست
sent.length = 0;
await handleTraceCommand(5, "/why 7");
assert.match(sent[0].text, /Eventهای دور 7/);
assert.ok(
  sent[0].text.includes("/why 7:scene:0") &&
    sent[0].text.includes("/why 7:skill_check:1"),
);
ok("/why 7: فهرست با دستور کوتاه");
sent.length = 0;
await handleTraceCommand(5, "/why 99");
assert.match(sent[0].text, /هیچ Eventی/);
ok("فهرست دور بی‌Event");

// handler: تاس ۰ با اقدام، دلیل، تاس، پیامد، commit
sent.length = 0;
await handleTraceCommand(5, "/why 7:skill_check:0");
const t0 = sent.map((m) => m.text).join("\n");
assert.ok(t0.includes("✅ اعمال شده — نوع skill_check، دور 7"));
assert.ok(
  t0.includes("1) اقدام: دانار — متن آزاد: «(بریم)[دیوارها رو بررسی می‌کنم]»"),
);
assert.ok(
  t0.includes(
    "2) Resolver: مهارت Perception | سختی medium | دلیل: «بررسی دیوارهای خزه‌پوش»",
  ),
);
assert.ok(
  t0.includes(
    "3) تاس [CHECK_ROLLED | D&D CORE]: d20=15 +1 (WIS) +0 (مهارت) تاریکی -2 = 14 در برابر DC 15 ← فاصله -1 ← fail",
  ),
);
assert.ok(
  t0.includes(
    "4) پیامد (حافظه‌ی دور): «دانار: بررسی دیوارهای خزه‌پوش — ناموفق ماند»",
  ),
);
assert.ok(
  t0.includes("COMMIT: تلاش 2 از 2") &&
    t0.includes("(این تلاش از Plan ذخیره‌شده") &&
    t0.includes("/trace 7 2"),
);
ok(
  "/why 7:skill_check:0: زنجیره‌ی کامل (اقدام ← Resolver ← تاس ← پیامد ← COMMIT) با تاس از تلاش قبلی",
);
// تاس ۱ بدون اقدام ثبت‌شده (tg 222)
sent.length = 0;
await handleTraceCommand(5, `/why ${CHAT}:7:skill_check:1`);
const t1 = sent.map((m) => m.text).join("\n");
assert.ok(t1.includes("1) اقدام: دانی\n") || t1.includes("1) اقدام: دانی"));
assert.ok(t1.includes("موفق شد"));
ok("eventId کامل + اقدام بدون ردیف");
// scene
sent.length = 0;
await handleTraceCommand(5, "/why 7:scene:0");
const ts = sent.map((m) => m.text).join("\n");
assert.ok(
  ts.includes("Resolver: type=checks | زمان minutes (0.25 ساعت)") &&
    ts.includes("روایت: groq موفق [AI_FALLBACK_USED] 1839ms") &&
    ts.includes("ساعت جهان: 48.25 ← 48.5") &&
    ts.includes("Eventهای این دور: 3 (scene:0، skill_check:0، skill_check:1)"),
);
ok("/why scene");
// Event اعمال‌نشده
sent.length = 0;
await handleTraceCommand(5, "/why 7:rest:0");
assert.match(
  sent.map((m) => m.text).join("\n"),
  /❌ این Event توی applied_events نیست/,
);
ok("Event اعمال‌نشده");
// سفر و استراحت (دور ۹)
for (const id of [
  `${CHAT}:9:scene:0`,
  `${CHAT}:9:travel:0`,
  `${CHAT}:9:rest:0`,
])
  tables.applied_events.push({
    eventId: id,
    chatId: CHAT,
    round: 9,
    type: id.split(":")[2],
  });
tables.event_plans.push({
  id: 2,
  chatId: CHAT,
  round: 9,
  plan: {
    checkResults: [],
    time: { key: "minutes", hours: 0.25 },
    decision: {
      type: "narrative",
      checks: [],
      moved: true,
      distanceIndex: 3,
      rest: "long",
    },
    travel: {
      traveled: true,
      hours: 12,
      distanceLabel: "نیم‌روز",
      location: {
        name: "دره‌ی مه",
        tier: 2,
        hostility: "moderate",
        environments: ["forest", "swamp"],
        population: { count: 12, step: 4, hours: 53 },
      },
    },
    restPlan: {
      kind: "short",
      downgraded: true,
      hoursSince: 10.25,
      hours: 1,
      lines: [
        "⏳ از شروع استراحت طولانی قبلی فقط 10 ساعت گذشته",
        "🛏 استراحت کوتاه — 1 ساعت گذشت.",
        "💚 دانار — HP کامل بود",
      ],
    },
  },
});
await T.runWithTrace(CHAT, 9, async () => {
  T.span("clock", null, {
    before: 40,
    after: 53,
    timeKey: "minutes",
    traveled: true,
    rest: "short",
  });
  T.span(
    "commit",
    "CONSEQ_APPLIED",
    {},
    {
      refs: {
        eventIds: [
          `${CHAT}:9:scene:0`,
          `${CHAT}:9:travel:0`,
          `${CHAT}:9:rest:0`,
        ],
      },
    },
  );
  T.setOutcome("ok");
});
sent.length = 0;
await handleTraceCommand(5, "/why 9:travel:0");
const tt = sent.map((m) => m.text).join("\n");
assert.ok(
  tt.includes("Resolver: moved=true فاصله=3") &&
    tt.includes("مقصد: «دره‌ی مه» (سطح 2) | نیم‌روز (12 ساعت") &&
    tt.includes("ساعت جهان: 40 ← 53"),
);
ok("/why travel");
assert.ok(
  tt.includes(
    "پروفایل مقصد: خصومت=moderate | محیط: جنگل، باتلاق | جمعیت: 12 نفر (پلهٔ 4، تخمین در ساعت 53)",
  ),
);
ok("/why travel: پروفایل مقصد (V09)");
sent.length = 0;
await handleTraceCommand(5, "/why 9:rest");
const tr = sent.map((m) => m.text).join("\n");
assert.ok(
  tr.includes(
    "نتیجه [REST_SHORT_BENEFIT]: short (طولانی ممکن نبود؛ از شروع استراحت طولانی قبلی فقط 10 ساعت",
  ) && tr.includes("   💚 دانار — HP کامل بود"),
);
ok("/why rest (downgraded)");
// دور بدون trace و بدون Plan (قدیمی)
tables.applied_events.push({
  eventId: `${CHAT}:2:scene:0`,
  chatId: CHAT,
  round: 2,
  type: "scene",
});
sent.length = 0;
await handleTraceCommand(5, "/why 2:scene");
assert.match(sent.map((m) => m.text).join("\n"), /trace این دور موجود نیست/);
ok("بدون trace/Plan: خطا نمی‌دهد و توضیح می‌دهد");
sent.length = 0;
await handleTraceCommand(5, "/why");
assert.match(sent[0].text, /فرمت درست/);
ok("/why بدون ورودی: راهنما");

// باگ دیده‌شده روی گروه: span ی cooldown نباید «شکست ?ms» نمایش داده شود
tables.applied_events.push({
  eventId: `${CHAT}:8:scene:0`,
  chatId: CHAT,
  round: 8,
  type: "scene",
});
tables.event_plans.push({
  id: 3,
  chatId: CHAT,
  round: 8,
  plan: {
    checkResults: [],
    time: { key: "minutes", hours: 0.25 },
    decision: { type: "narrative", checks: [] },
  },
});
await T.runWithTrace(CHAT, 8, async () => {
  T.span("ai_call", "AI_PROVIDER_COOLDOWN", {
    promptKey: "round_narrator",
    provider: "openrouter",
  });
  T.span("ai_call", null, {
    promptKey: "round_narrator",
    provider: "groq",
    ok: true,
    ms: 1856,
  });
  T.span(
    "commit",
    "CONSEQ_APPLIED",
    {},
    { refs: { eventIds: [`${CHAT}:8:scene:0`] } },
  );
  T.setOutcome("ok");
});
sent.length = 0;
await handleTraceCommand(5, "/why 8:scene:0");
const t8 = sent.map((m) => m.text).join("\n");
assert.ok(
  t8.includes(
    "روایت: openrouter توی cooldown بود و کنار گذاشته شد [AI_PROVIDER_COOLDOWN]",
  ) &&
    t8.includes("روایت: groq موفق 1856ms") &&
    !t8.includes("?ms"),
);
ok("cooldown در /why scene: «کنار گذاشته شد»، نه «شکست ?ms»");
