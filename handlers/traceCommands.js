import { api, db } from "sdk";
import {
  traceRing,
  appliedEvents,
  eventPlans,
  sceneActions,
  roundMemory,
  xpLog,
} from "schema";
import { eq, and, sql } from "sdk/db";
import { debugUntilSeconds, setDebug, DEBUG_HOURS } from "lib/core/trace";
import {
  reviveCheckResults,
  eventListFor,
  makeEventId,
  computeClock,
} from "lib/game/events";
import { checksToDiceText, TIME_MENU } from "lib/game/resolver";
import { blockedToDiceText, skippedToDiceText } from "lib/game/blocked";
import { finalDc } from "lib/core/actions";
import { skillXpFor, xpToDiceText } from "lib/core/xp";
import { restToDiceText } from "lib/world/rest";
import { timeLine } from "lib/world/locations";
import { buildMemoryRow } from "lib/game/memory";
import { DC_TABLE } from "lib/core/dndData";
import { degreeFor } from "lib/core/degrees";

// دستورهای ردگیری (V05)؛ فقط برای صاحب بات و فقط در چت خصوصی (شرطش در message.js چک میشه)
//   /trace [دور | last] [شماره‌ی تلاش]   — گام‌به‌گام یک دور
//   /why <eventId | دور:نوع:اندیس | دور> — زنجیره‌ی دلیل یک Event (یا فهرست Eventهای یک دور)
//   /replay [دور | last | traceId]        — اجرای دوباره‌ی گام‌های کد با تاس‌های ذخیره‌شده و مقایسه با نتیجه‌ی اصلی
//   /debug [on | off]                     — حالت debug ۲۴ ساعته (ذخیره‌ی متن کوتاه‌شده‌ی پرامپت/پاسخ)
// خروجی متن ساده است (بدون parse_mode)، چون data از ID و عدد ساخته شده.

const MAX_CHUNK = 3800; // سقف تلگرام ۴۰۹۶ نویسه است
const MAX_CHUNKS = 6;

function clip(s, n) {
  const str = String(s);
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

function fmtValue(v) {
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  if (typeof v === "string") return clip(v, 40);
  if (typeof v === "boolean") return v ? "true" : "false";
  return clip(JSON.stringify(v), 120);
}

// data یک span ← «k=v k=v» (مقدارهای null حذف میشن)
export function dataSummary(data) {
  if (!data || typeof data !== "object") return "";
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${fmtValue(v)}`)
    .join(" ");
}

// خطوط نمایش یک تلاش از یک دور (attemptNo: شماره‌ی ۱-مبنا، پیش‌فرض آخرین)
export function formatTrace(row, attemptNo = null) {
  const attempts = Array.isArray(row.attempts) ? row.attempts : [];
  if (attempts.length === 0) return [`دور ${row.round}: هیچ تلاشی ثبت نشده.`];
  const idx = attemptNo ? attemptNo - 1 : attempts.length - 1;
  const a = attempts[idx];
  const lines = [
    `🔎 دور ${row.round} | تلاش ${idx + 1} از ${attempts.length}`,
    `traceId: ${a.traceId}`,
    `نتیجه: ${a.outcome} | ${(a.ms / 1000).toFixed(1)} ثانیه | debug: ${a.debug ? "روشن" : "خاموش"}` +
      (a.dropped ? ` | ${a.dropped} span حذف شد` : ""),
    "",
  ];
  let prev = 0;
  for (const s of a.spans || []) {
    const t = (s.t || 0) / 1000;
    const head = `${t.toFixed(1)}s (+${(t - prev).toFixed(1)})`;
    prev = t;
    const mark = s.level === "ERROR" ? "❌ " : s.level === "AUDIT" ? "📌 " : "";
    const code = s.reasonCode ? ` [${s.reasonCode}]` : "";
    lines.push(
      clip(
        `${head} ${mark}${s.step}${code} ${dataSummary(s.data)}`.trimEnd(),
        400,
      ),
    );
    if (s.refs) {
      for (const [k, v] of Object.entries(s.refs)) {
        lines.push(
          `   ↳ ${k}: ${Array.isArray(v) ? v.join(", ") : fmtValue(v)}`,
        );
      }
    }
    if (s.dbg) {
      for (const [k, v] of Object.entries(s.dbg)) {
        lines.push(`   🐞 ${k}: ${clip(v, 800)}`);
      }
    }
  }
  return lines;
}

// خط‌ها رو به تکه‌های زیر سقف تلگرام می‌شکنه (بدون شکستن وسط یک خط)
export function splitChunks(lines) {
  const chunks = [];
  let cur = "";
  for (const line of lines) {
    const piece = clip(line, MAX_CHUNK);
    if (cur && cur.length + piece.length + 1 > MAX_CHUNK) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${piece}` : piece;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function describeDebug(untilSeconds, nowSeconds = Date.now() / 1000) {
  const left = Math.floor(untilSeconds - nowSeconds);
  if (!untilSeconds || left <= 0) {
    return "🐞 حالت debug خاموش است. برای روشن‌کردن ۲۴ ساعته: /debug on";
  }
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  return `🐞 حالت debug روشن است؛ ${h} ساعت و ${m} دقیقه‌ی دیگر خودکار خاموش میشه.`;
}

// ---------- /why: زنجیره‌ی دلیل یک Event ----------

const EVENT_TYPES = [
  "scene",
  "skill_check",
  "travel",
  "rest",
  "combat_result",
  "xp_award",
  "skill_xp",
];
const KIND_FA = {
  suggestion: "انتخاب پیشنهاد",
  free: "متن آزاد",
  skip: "Skip",
};

const isInt = (s) => /^-?\d+$/.test(String(s ?? ""));

// ورودی‌های قابل‌قبول: eventId کامل (chatId:round:type:index)، «دور:نوع:اندیس»، «دور نوع اندیس»، یا فقط «دور»
export function parseWhyArgs(args) {
  const tokens = args
    .join(" ")
    .split(/[:\s]+/)
    .filter(Boolean);
  if (tokens.length === 0) return { kind: "usage" };
  let chatId = null;
  let rest = tokens;
  if (
    tokens.length >= 4 &&
    isInt(tokens[0]) &&
    isInt(tokens[1]) &&
    !isInt(tokens[2])
  ) {
    chatId = Number(tokens[0]);
    rest = tokens.slice(1);
  }
  if (!isInt(rest[0])) return { kind: "usage" };
  const round = Number(rest[0]);
  if (rest.length === 1) return { kind: "list", chatId, round };
  const type = rest[1];
  if (!EVENT_TYPES.includes(type)) return { kind: "usage" };
  const index = rest[2] === undefined ? 0 : rest[2];
  if (!isInt(index) || Number(index) < 0) return { kind: "usage" };
  return { kind: "event", chatId, round, type, index: Number(index) };
}

const WHY_USAGE =
  "فرمت درست:\n/why <شماره‌ی دور> — فهرست Eventهای آن دور\n/why <دور>:<نوع>:<اندیس> — مثلاً /why 7:skill_check:0\nنوع‌ها: scene، skill_check، travel، rest، combat_result، xp_award، skill_xp";

function findCommitAttemptIndex(attempts, eventId) {
  for (let i = attempts.length - 1; i >= 0; i--) {
    const has = (attempts[i].spans || []).some(
      (s) =>
        s.step === "commit" &&
        Array.isArray(s.refs?.eventIds) &&
        s.refs.eventIds.includes(eventId),
    );
    if (has) return i;
  }
  return -1;
}

const spansOf = (attempt, step) =>
  (attempt?.spans || []).filter((s) => s.step === step);

// تاس‌ها ممکنه توی یک تلاش قبلی ریخته شده باشن (Plan دوباره استفاده شده)
function findRollSpan(attempts, upto, index) {
  for (let i = upto; i >= 0; i--) {
    const r = spansOf(attempts[i], "roll");
    if (r.length) return r[index] || null;
  }
  return null;
}

function fmtEnv(env) {
  if (!Array.isArray(env) || env.length === 0) return "";
  return ` ${env.map((e) => `${e.label} ${e.delta > 0 ? "+" : ""}${e.delta}`).join("، ")}`;
}

const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;

// ctx: { eventId, type, index, round, applied, attempts, plan, action, memory }
export function buildWhyLines(ctx) {
  const { eventId, type, index, round, applied, plan, action, memory } = ctx;
  const attempts = Array.isArray(ctx.attempts) ? ctx.attempts : [];
  if (!applied) {
    return [
      `🧭 ${eventId}`,
      "❌ این Event توی applied_events نیست (اعمال نشده، یا بازی پاک شده).",
    ];
  }
  const ci = findCommitAttemptIndex(attempts, eventId);
  const att = ci >= 0 ? attempts[ci] : null;
  const decision = plan?.decision || null;
  const lines = [
    `🧭 ${eventId}`,
    `✅ اعمال شده — نوع ${type}، دور ${round}`,
    "",
  ];
  const step = (() => {
    let n = 0;
    return (text) => lines.push(`${++n}) ${text}`);
  })();
  const clock = spansOf(att, "clock")[0]?.data;
  const clockLine = () => {
    if (clock) {
      step(
        `ساعت جهان: ${clock.before ?? "?"} ← ${clock.after} (زمان ${clock.timeKey ?? "?"}${clock.traveled ? "، سفر" : ""}${clock.rest ? `، استراحت ${clock.rest}` : ""})`,
      );
    }
  };

  if (type === "skill_check") {
    const r = plan?.checkResults?.[index];
    if (!r) {
      step("اطلاعات این تاس توی Plan نیست (Plan پاک شده).");
    } else {
      const dc = decision?.checks;
      // اول با actionId (بعد از V07)، وگرنه اگه تعداد برابر بود با اندیس
      const dcheck =
        (dc && r.actionId ? dc.find((c) => c.actionId === r.actionId) : null) ||
        (dc && dc.length === plan.checkResults.length ? dc[index] : null);
      step(
        `اقدام: ${r.name}` +
          (action
            ? ` — ${KIND_FA[action.kind] || action.kind}${action.content ? `: «${clip(action.content, 100)}»` : ""}`
            : ""),
      );
      step(
        `Resolver: مهارت ${r.skill}` +
          (dcheck
            ? dcheck.opponentRole
              ? ` | تقابل با نقش #${dcheck.opponentRole}`
              : ` | سختی ${dcheck.difficulty}`
            : "") +
          (r.reason ? ` | دلیل: «${clip(r.reason, 100)}»` : ""),
      );
      if (r.chain) {
        step(
          `زنجیره: مرحله ${r.chain.step} از ${r.chain.total} (${r.chain.id}${r.actionId ? `، ${r.actionId}` : ""})`,
        );
      } else if (r.actionId) {
        step(`شناسهٔ اقدام: ${r.actionId}`);
      }
      if (r.groupId) step(`چک گروهی: ${r.groupId}`);
      if (r.xp > 0)
        step(
          `XP: +${r.xp} (DC ${r.dc} و چک موفق) ← /why ${round}:skill_xp:${index}`,
        );
      const srcLabel = (x) =>
        x.source === "help" ? `کمک ${x.by}` : `بدون ${x.tool}`;
      if ((r.advSources || []).length || (r.disSources || []).length) {
        const advTxt = (r.advSources || []).map(srcLabel).join("، ");
        const disTxt = (r.disSources || []).map(srcLabel).join("، ");
        step(
          `برتری/ضعف: ${r.mode === "normal" || !r.mode ? "خنثی" : r.mode}` +
            (advTxt ? ` | برتری: ${advTxt}` : "") +
            (disTxt ? ` | ضعف: ${disTxt}` : "") +
            (r.rolls?.length > 1 ? ` | تاس‌ها: ${r.rolls.join(" و ")}` : ""),
        );
      }
      const rs = findRollSpan(
        attempts,
        ci >= 0 ? ci : attempts.length - 1,
        index,
      );
      const tag = rs ? ` [${rs.reasonCode || "-"} | ${rs.ruleSource}]` : "";
      step(
        `تاس${tag}: d20=${r.roll} ${signed(r.mod)}${r.ability ? ` (${r.ability})` : ""} ${signed(r.profBonus)} (مهارت)${fmtEnv(r.env)} = ${r.total} ` +
          `در برابر ${r.opponentLabel ? `${r.opponentLabel} (تقابل)` : `DC ${r.dc}${r.tierBonus ? ` (پایه ${r.dcBase} + مکان سطح بالا ${r.tierBonus})` : ""}`} ← فاصله ${r.margin} ← ${r.degree}`,
      );
      const out = memory?.outcomes?.[index]?.t;
      step(
        `پیامد (حافظه‌ی دور): ${out ? `«${out}»` : "حافظه‌ی این دور پاک شده"}`,
      );
    }
  } else if (type === "travel") {
    const tr = plan?.travel;
    step(
      `Resolver: moved=${decision ? decision.moved : "?"} فاصله=${decision?.distanceIndex ?? "?"}`,
    );
    if (tr?.traveled) {
      step(
        `مقصد: «${tr.location?.name}» (سطح ${tr.location?.tier}) | ${tr.distanceLabel} (${tr.hours} ساعت منوی سفر؛ ساعت جهان به مضرب ۶ گرد میشه)`,
      );
    } else {
      step("سفر توی Plan نیست.");
    }
    clockLine();
  } else if (type === "rest") {
    const rp = plan?.restPlan;
    step(`Resolver: rest=${decision?.rest ?? "?"}`);
    if (rp) {
      const code =
        rp.kind === "long" ? "REST_LONG_BENEFIT" : "REST_SHORT_BENEFIT";
      step(
        `نتیجه [${code}]: ${rp.kind}` +
          (rp.downgraded
            ? ` (طولانی ممکن نبود؛ از شروع استراحت طولانی قبلی فقط ${Math.floor(rp.hoursSince)} ساعت گذشته بود)`
            : ""),
      );
      for (const l of (rp.lines || []).slice(0, 8))
        lines.push(`   ${clip(l, 140)}`);
    } else {
      step("استراحت توی Plan نیست.");
    }
    clockLine();
  } else if (
    type === "combat_result" ||
    type === "xp_award" ||
    type === "skill_xp"
  ) {
    const xr = ctx.xpRow;
    if (type === "combat_result") {
      step(
        "پایان نبرد با پیروزی گروه؛ XP، بیدارشدن بیهوش‌ها و بیرون‌رفتن مرده‌ها در همین COMMIT اتمی اعمال شد.",
      );
    } else if (xr) {
      step(
        `XP: +${xr.amount} برای شخصیت شمارهٔ ${xr.characterId} | منبع: ${xr.source === "combat" ? "نبرد" : xr.source === "skill_check" ? "چک مهارت" : xr.source}`,
      );
      step(`دلیل: «${clip(xr.reason, 120)}»`);
      if (type === "skill_xp") {
        const cr = plan?.checkResults?.[index];
        if (cr)
          step(
            `از چک ${cr.name} (${cr.skill}) | DC ${cr.dc} | فاصله ${cr.margin} ← جدول DC→XP (موقت؛ فقط DC ≥ 15 و چک موفق)`,
          );
        step(`چک مرتبط: ${round}:skill_check:${index}`);
      } else {
        step(
          `سهم شخصیت شمارهٔ ${Number(index) + 1} از شرکت‌کننده‌های زنده (تقسیم مساوی).`,
        );
      }
    } else {
      step(
        type === "skill_xp"
          ? "ردیف دفتر XP پیدا نشد."
          : `سهم XP شخصیت شمارهٔ ${Number(index) + 1} از شرکت‌کننده‌های زنده (تقسیم مساوی)؛ ردیف دفتر XP نبود (نبرد قبل از V07).`,
      );
    }
    step(
      "جمع XP توی ستون xp شخصیت است؛ نبرد هنوز trace ندارد (چک مهارت trace دارد).",
    );
    return lines;
  } else {
    step(
      `Resolver: type=${decision?.type ?? "?"} | زمان ${plan?.time?.key ?? "?"} (${plan?.time?.hours ?? "?"} ساعت)`,
    );
    for (const s of spansOf(att, "ai_call")) {
      if (s.data?.promptKey !== "round_narrator") continue;
      if (s.reasonCode === "AI_PROVIDER_COOLDOWN") {
        step(
          `روایت: ${s.data.provider} توی cooldown بود و کنار گذاشته شد [AI_PROVIDER_COOLDOWN]`,
        );
        continue;
      }
      step(
        `روایت: ${s.data.provider} ${s.data.ok ? "موفق" : "شکست"}${s.reasonCode ? ` [${s.reasonCode}]` : ""} ${s.data.ms ?? "?"}ms`,
      );
    }
    clockLine();
    const ids = spansOf(att, "commit")[0]?.refs?.eventIds;
    if (ids)
      step(
        `Eventهای این دور: ${ids.length} (${ids.map((x) => x.split(":").slice(2).join(":")).join("، ")})`,
      );
  }

  if (att) {
    lines.push(
      "",
      `COMMIT: تلاش ${ci + 1} از ${attempts.length} | ${att.traceId} | ${(att.ms / 1000).toFixed(1)} ثانیه`,
    );
    if (spansOf(att, "plan_reuse").length)
      lines.push(
        "(این تلاش از Plan ذخیره‌شده‌ی تلاش قبلی استفاده کرد؛ تاس‌ها تازه نریخته شدن.)",
      );
    lines.push(`گام‌به‌گام: /trace ${round} ${ci + 1}`);
  } else {
    lines.push(
      "",
      attempts.length
        ? "ردیف COMMIT این Event توی trace پیدا نشد."
        : "trace این دور موجود نیست (قبل از V05 یا خارج از ۵۰ دور آخر).",
    );
  }
  return lines;
}

async function defaultChatId() {
  const t = await db
    .select()
    .from(traceRing)
    .orderBy(sql`${traceRing.updated} DESC, ${traceRing.id} DESC`)
    .limit(1)
    .get();
  if (t) return t.chatId;
  const p = await db
    .select()
    .from(eventPlans)
    .orderBy(sql`${eventPlans.id} DESC`)
    .limit(1)
    .get();
  return p ? p.chatId : null;
}

async function handleWhy(chatId, args) {
  const parsed = parseWhyArgs(args);
  if (parsed.kind === "usage") {
    await say(chatId, WHY_USAGE);
    return;
  }
  const gid = parsed.chatId ?? (await defaultChatId());
  if (gid === null || gid === undefined) {
    await say(chatId, "هنوز هیچ دوری ردگیری نشده.");
    return;
  }

  if (parsed.kind === "list") {
    const rows = await db
      .select()
      .from(appliedEvents)
      .where(
        and(
          eq(appliedEvents.chatId, gid),
          eq(appliedEvents.round, parsed.round),
        ),
      )
      .all();
    if (rows.length === 0) {
      await say(
        chatId,
        `هیچ Eventی برای دور ${parsed.round} نیست (اعمال نشده، یا بازی پاک شده).`,
      );
      return;
    }
    const ids = rows
      .map((r) => r.eventId)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const short = ids.map((id) => `/why ${id.split(":").slice(1).join(":")}`);
    await say(chatId, `🧭 Eventهای دور ${parsed.round}:\n${short.join("\n")}`);
    return;
  }

  const eventId = `${gid}:${parsed.round}:${parsed.type}:${parsed.index}`;
  const applied = await db
    .select()
    .from(appliedEvents)
    .where(eq(appliedEvents.eventId, eventId))
    .get();
  const trace = await db
    .select()
    .from(traceRing)
    .where(and(eq(traceRing.chatId, gid), eq(traceRing.round, parsed.round)))
    .get();
  const planRow = await db
    .select()
    .from(eventPlans)
    .where(and(eq(eventPlans.chatId, gid), eq(eventPlans.round, parsed.round)))
    .get();
  const plan = planRow?.plan || null;
  const memory = await db
    .select()
    .from(roundMemory)
    .where(
      and(eq(roundMemory.chatId, gid), eq(roundMemory.round, parsed.round)),
    )
    .get();

  // اقدام بازیکن (فقط برای تاس): از تصمیم Resolver میشه فهمید کدوم بازیکن بوده
  let action = null;
  if (parsed.type === "skill_check" && plan?.checkResults?.[parsed.index]) {
    const cr = plan.checkResults[parsed.index];
    const dcs = plan.decision?.checks || [];
    const dch =
      (cr.actionId ? dcs.find((x) => x.actionId === cr.actionId) : null) ||
      (dcs.length === plan.checkResults.length ? dcs[parsed.index] : null);
    const tgId = dch?.tgId;
    if (tgId) {
      action = await db
        .select()
        .from(sceneActions)
        .where(
          and(
            eq(sceneActions.chatId, gid),
            eq(sceneActions.round, parsed.round),
            eq(sceneActions.tgId, tgId),
          ),
        )
        .get();
    }
  }

  let xpRow = null;
  if (parsed.type === "skill_xp" || parsed.type === "xp_award") {
    xpRow = await db
      .select()
      .from(xpLog)
      .where(eq(xpLog.eventId, eventId))
      .get();
  }

  const lines = buildWhyLines({
    xpRow,
    eventId,
    type: parsed.type,
    index: parsed.index,
    round: parsed.round,
    applied,
    attempts: trace?.attempts,
    plan,
    action,
    memory,
  });
  const chunks = splitChunks(lines);
  for (const c of chunks.slice(0, MAX_CHUNKS)) await say(chatId, c);
}

// ---------- /replay: بازپخش گام‌های کد با داده‌ی ذخیره‌شده ----------
// AI صدا زده نمیشه و تاس تازه نمیریزه: تاس‌ها، تصمیم Resolver و ساعت از Plan/trace میان،
// و گام‌های کد (DC، جمع تاس، درجه، زمان، ساعت، Eventها، حافظه، متن تاس) دوباره حساب و با نتیجه‌ی اصلی مقایسه میشن.
// هر trace واقعی یه «تست طلایی» ـه: بعد از تغییر کد، /replay همون دور رو دوباره می‌سنجه.

export function parseReplayArgs(args) {
  const a = args[0];
  if (!a || a === "last") return { kind: "last" };
  if (isInt(a) && Number(a) >= 0) return { kind: "round", round: Number(a) };
  if (/^t[0-9a-z]{8,}$/.test(a)) return { kind: "trace", traceId: a };
  return { kind: "usage" };
}

const REPLAY_USAGE =
  "فرمت درست:\n/replay — آخرین دور\n/replay <شماره‌ی دور>\n/replay <traceId> — یک تلاش مشخص";

const shortId = (id) => id.split(":").slice(2).join(":");

function commitAttemptIndex(attempts) {
  for (let i = attempts.length - 1; i >= 0; i--) {
    if (
      (attempts[i].spans || []).some(
        (s) => s.step === "commit" && s.refs?.eventIds,
      )
    ) {
      return i;
    }
  }
  return attempts.length ? attempts.length - 1 : -1;
}

// ctx: { chatId, round, planRow, appliedIds, memory, attempt, attemptNo, attemptsTotal }
export function runReplay(ctx) {
  const { chatId, round, planRow, appliedIds, memory, attempt } = ctx;
  const plan = planRow.plan || {};
  const results = reviveCheckResults(plan.checkResults);
  const dec = plan.decision || null;
  const items = []; // { s: ok | diff | skip, text }
  const ok = (text) => items.push({ s: "ok", text });
  const diff = (text) => items.push({ s: "diff", text });
  const skip = (text) => items.push({ s: "skip", text });
  const same = (a, b) => String(a) === String(b);

  // ۱) هر تاس: جمع، DC، فاصله، درجه
  const aligned =
    dec && Array.isArray(dec.checks) && dec.checks.length === results.length;
  // سطح مکان از span «context» همین تلاش (برای DC نهایی)
  const ctxTier = (attempt?.spans || []).find((s) => s.step === "context")?.data
    ?.tier;
  results.forEach((r, i) => {
    const label = `تاس ${i + 1} (${r.name}، ${r.skill})`;
    const envSum = (r.env || []).reduce((s, e) => s + e.delta, 0);
    const problems = [];
    const expTotal = r.roll + r.mod + r.profBonus + envSum;
    if (!same(expTotal, r.total))
      problems.push(`جمع: انتظار ${expTotal}، ثبت‌شده ${r.total}`);
    let against;
    if (r.opponentLabel) {
      against = `${r.opponentLabel} (تقابل؛ تاس NPC ذخیره نمیشه)`;
      const d = degreeFor(r.margin).key;
      if (!same(d, r.degree.key))
        problems.push(`درجه: انتظار ${d}، ثبت‌شده ${r.degree.key}`);
    } else {
      against = `DC ${r.dc}`;
      // اول با actionId، وگرنه اگه تعداد برابر بود با اندیس
      const dch =
        (dec && r.actionId
          ? (dec.checks || []).find((c) => c.actionId === r.actionId)
          : null) || (aligned ? dec.checks[i] : null);
      if (dch) {
        // Plan قبل از V07 فیلد tierBonus ندارد ← بدون تعدیل Tier
        let expDc;
        if (r.tierBonus === undefined) expDc = DC_TABLE[dch.difficulty];
        else if (Number.isFinite(Number(ctxTier)))
          expDc = finalDc(dch.difficulty, ctxTier).dc;
        else expDc = Math.min(30, DC_TABLE[dch.difficulty] + r.tierBonus);
        if (!same(expDc, r.dc))
          problems.push(
            `DC از «${dch.difficulty}»: انتظار ${expDc}، ثبت‌شده ${r.dc}`,
          );
      }
      const expMargin = r.total - r.dc;
      if (!same(expMargin, r.margin))
        problems.push(`فاصله: انتظار ${expMargin}، ثبت‌شده ${r.margin}`);
      const d = degreeFor(expMargin).key;
      if (!same(d, r.degree.key))
        problems.push(`درجه: انتظار ${d}، ثبت‌شده ${r.degree.key}`);
    }
    if (problems.length === 0) {
      ok(
        `${label}: ${r.roll}${signed(r.mod)}${signed(r.profBonus)}${envSum ? signed(envSum) : ""}=${r.total} در برابر ${against} ← ${r.degree.key}${aligned || r.opponentLabel || r.actionId ? "" : " (DC بدون تصمیم Resolver چک نشد)"}`,
      );
    } else {
      for (const p of problems) diff(`${label} — ${p}`);
    }
  });
  if (results.length === 0) skip("این دور تاسی نداشت");

  // ۱پ) XP چک مهارت: از DC و فاصله‌ی ثبت‌شده دوباره حساب میشه
  for (const r of results) {
    if (r.xp === undefined) continue; // Plan قبل از V07
    const exp = skillXpFor({
      dc: r.dc,
      margin: r.margin,
      opponentLabel: r.opponentLabel,
    });
    if (exp === r.xp)
      ok(`XP ${r.name}: ${r.xp} (DC ${r.dc}، فاصله ${r.margin})`);
    else diff(`XP ${r.name}: انتظار ${exp}، ثبت‌شده ${r.xp}`);
  }

  // ۱ب) زنجیره: هر مرحله‌ی تاس‌شده فقط وقتی مجازه که مرحله‌ی قبلش موفق بوده
  for (const r of results) {
    if (!r.chain || r.chain.step <= 1) continue;
    const prev = results.find(
      (x) => x.chain?.id === r.chain.id && x.chain.step === r.chain.step - 1,
    );
    const label = `زنجیره ${r.chain.id} مرحله ${r.chain.step} (${r.name})`;
    if (!prev) {
      // مرحله‌ی قبل ممکنه چک نبوده باشه (مثلاً بدون ریسک)؛ تفاوت حساب نمیشه
      skip(`${label}: مرحله‌ی قبل چک نبود`);
    } else if (prev.margin >= 0)
      ok(`${label}: بعد از موفقیت مرحله‌ی قبل تاس شد`);
    else
      diff(
        `${label}: مرحله‌ی قبل موفق نبود (فاصله ${prev.margin}) ولی این مرحله تاس شده`,
      );
  }

  // ۲) زمان دور از منوی بسته
  if (dec && dec.timeIndex !== undefined && dec.timeIndex !== null) {
    const expKey = (TIME_MENU[dec.timeIndex] || TIME_MENU[1]).key;
    if (same(expKey, plan.time?.key))
      ok(`زمان دور: شماره ${dec.timeIndex + 1} ← ${expKey}`);
    else diff(`زمان دور — انتظار ${expKey}، ثبت‌شده ${plan.time?.key}`);
  } else {
    skip("زمان دور: تصمیم Resolver توی Plan نیست");
  }

  // ۳) ساعت جهان + خط زمان بالای صحنه (از trace همان تلاش)
  const clock = (attempt?.spans || []).find((s) => s.step === "clock")?.data;
  if (clock && clock.before !== null && clock.before !== undefined) {
    const c = computeClock(
      clock.before,
      plan.travel,
      plan.restPlan,
      plan.time?.hours ?? 0,
    );
    if (same(c.elapsed, clock.after))
      ok(`ساعت جهان: ${clock.before} ← ${c.elapsed}`);
    else diff(`ساعت جهان — انتظار ${c.elapsed}، ثبت‌شده ${clock.after}`);
    const firstLine = (planRow.sceneText || "").split("\n")[0];
    if (planRow.sceneText) {
      const tl = timeLine(clock.after);
      if (same(tl, firstLine)) ok(`خط زمان صحنه: ${tl}`);
      else diff(`خط زمان صحنه — انتظار «${tl}»، ثبت‌شده «${firstLine}»`);
    }
  } else {
    skip("ساعت جهان: span ساعت توی trace این تلاش نیست");
  }

  // ۴) Eventها
  if (planRow.status === "committed") {
    const natural = eventListFor({
      checkResults: plan.checkResults || [],
      travel: plan.travel,
      restPlan: plan.restPlan,
    }).map((e) => makeEventId(chatId, round, e.type, e.index));
    const exp = [...natural].sort();
    const act = [...appliedIds].sort();
    if (same(exp.join(","), act.join(",")))
      ok(`Eventها: ${natural.map(shortId).join("، ")}`);
    else
      diff(
        `Eventها — انتظار ${natural.map(shortId).join("، ")}، ثبت‌شده ${act.map(shortId).join("، ") || "هیچ"}`,
      );
  } else {
    skip("Eventها: این Plan هنوز COMMIT نشده");
  }

  // ۵) خط‌های تاس و استراحت داخل متن صحنه
  if (planRow.sceneText) {
    const wanted = [
      checksToDiceText(results),
      xpToDiceText(results),
      blockedToDiceText(plan.blocked),
      skippedToDiceText(plan.skipped),
      restToDiceText(plan.restPlan),
    ]
      .filter(Boolean)
      .join("\n")
      .split("\n")
      .filter(Boolean);
    const missing = wanted.filter((l) => !planRow.sceneText.includes(l));
    if (wanted.length === 0) skip("متن صحنه: خط تاس/استراحتی نبود");
    else if (missing.length === 0)
      ok(`متن صحنه: ${wanted.length} خط تاس/استراحت دقیقاً مثل بازسازی`);
    else
      for (const m of missing)
        diff(
          `متن صحنه — این خط بازسازی‌شده توی متن ارسالی نیست: «${clip(m, 90)}»`,
        );
  } else {
    skip("متن صحنه: ذخیره نشده");
  }

  // ۶) حافظه‌ی دور (فقط ۱۰ دور آخر)
  if (memory) {
    const rebuilt = buildMemoryRow({
      state: { players: [] },
      checkResults: results,
      travel: null,
      restPlan: plan.restPlan,
      blocked: plan.blocked || [],
      skipped: plan.skipped || [],
      autos: plan.autos || [],
      helps: plan.helps || [],
    });
    const texts = (arr) => (Array.isArray(arr) ? arr : []).map((x) => x.t);
    const expOut = texts(rebuilt.outcomes);
    const actOut = texts(memory.outcomes);
    if (same(expOut.join("|"), actOut.join("|")))
      ok(`حافظه‌ی دور: ${expOut.length} پیامد یکی است`);
    else
      diff(
        `حافظه‌ی دور — پیامدها فرق دارن (انتظار ${expOut.length}، ثبت‌شده ${actOut.length})`,
      );
    const restOf = (arr) => texts(arr).filter((x) => x.includes("استراحت"));
    const expRest = restOf(rebuilt.changes);
    const actRest = restOf(memory.changes);
    if (expRest.length || actRest.length) {
      if (same(expRest.join("|"), actRest.join("|")))
        ok("حافظه‌ی دور: جمله‌ی استراحت یکی است");
      else
        diff(
          `حافظه‌ی دور — جمله‌ی استراحت: انتظار «${expRest[0] || "-"}»، ثبت‌شده «${actRest[0] || "-"}»`,
        );
    }
  } else {
    skip("حافظه‌ی دور: پاک شده (فقط ۱۰ دور آخر نگه داشته میشه)");
  }

  const diffs = items.filter((i) => i.s === "diff").length;
  const okN = items.filter((i) => i.s === "ok").length;
  const skipN = items.filter((i) => i.s === "skip").length;
  const mark = { ok: "✅", diff: "⚠️", skip: "➖" };
  const lines = [
    `🔁 Replay دور ${round}` +
      (attempt
        ? ` — تلاش ${ctx.attemptNo} از ${ctx.attemptsTotal} (${attempt.traceId})`
        : " — بدون trace"),
    "فقط گام‌های کد دوباره اجرا شد؛ AI صدا زده نشد و تاس تازه نریخت.",
    `Plan: ${planRow.status}`,
    "",
    ...items.map((i) => `${mark[i.s]} ${i.text}`),
    "",
    diffs === 0
      ? `نتیجه: ✅ همه‌ی ${okN} بررسی با نتیجه‌ی اصلی یکی بود${skipN ? ` (${skipN} مورد بدون داده)` : ""}`
      : `نتیجه: ⚠️ ${diffs} تفاوت (و ${okN} مورد یکی${skipN ? `، ${skipN} بدون داده` : ""})`,
  ];
  return { lines, diffs, ok: okN, skipped: skipN };
}

async function handleReplay(chatId, args) {
  const parsed = parseReplayArgs(args);
  if (parsed.kind === "usage") {
    await say(chatId, REPLAY_USAGE);
    return;
  }
  const gid = await defaultChatId();
  if (gid === null || gid === undefined) {
    await say(chatId, "هنوز هیچ دوری ردگیری نشده.");
    return;
  }

  let round = null;
  let traceRow = null;
  let attemptIdx = null;
  if (parsed.kind === "trace") {
    const rows = await db
      .select()
      .from(traceRing)
      .where(eq(traceRing.chatId, gid))
      .all();
    for (const r of rows) {
      const i = (Array.isArray(r.attempts) ? r.attempts : []).findIndex(
        (a) => a.traceId === parsed.traceId,
      );
      if (i >= 0) {
        traceRow = r;
        round = r.round;
        attemptIdx = i;
        break;
      }
    }
    if (!traceRow) {
      await say(
        chatId,
        `traceId ${parsed.traceId} پیدا نشد (فقط ۵۰ دور آخر نگه داشته میشه).`,
      );
      return;
    }
  } else if (parsed.kind === "round") {
    round = parsed.round;
    traceRow = await db
      .select()
      .from(traceRing)
      .where(and(eq(traceRing.chatId, gid), eq(traceRing.round, round)))
      .get();
  } else {
    const latest = await db
      .select()
      .from(traceRing)
      .orderBy(sql`${traceRing.updated} DESC, ${traceRing.id} DESC`)
      .limit(1)
      .get();
    if (!latest) {
      await say(chatId, "هنوز هیچ دوری ردگیری نشده.");
      return;
    }
    traceRow = latest;
    round = latest.round;
  }

  const planRow = await db
    .select()
    .from(eventPlans)
    .where(and(eq(eventPlans.chatId, gid), eq(eventPlans.round, round)))
    .get();
  if (!planRow || !planRow.plan) {
    await say(
      chatId,
      `دور ${round} Plan ندارد (دور نبرد، یا قبل از V02)، پس قابل بازپخش نیست. گام‌هاش رو با /trace ${round} ببین.`,
    );
    return;
  }

  const attempts = Array.isArray(traceRow?.attempts) ? traceRow.attempts : [];
  if (attemptIdx === null) attemptIdx = commitAttemptIndex(attempts);
  const attempt = attemptIdx >= 0 ? attempts[attemptIdx] : null;

  const applied = await db
    .select()
    .from(appliedEvents)
    .where(and(eq(appliedEvents.chatId, gid), eq(appliedEvents.round, round)))
    .all();
  const memory = await db
    .select()
    .from(roundMemory)
    .where(and(eq(roundMemory.chatId, gid), eq(roundMemory.round, round)))
    .get();

  const { lines } = runReplay({
    chatId: gid,
    round,
    planRow,
    appliedIds: applied.map((r) => r.eventId),
    memory,
    attempt,
    attemptNo: attemptIdx + 1,
    attemptsTotal: attempts.length,
  });
  const chunks = splitChunks(lines);
  for (const c of chunks.slice(0, MAX_CHUNKS)) await say(chatId, c);
}

async function say(chatId, text) {
  await api.sendMessage({ chat_id: chatId, text });
}

// اگه متن یکی از دستورهای این فایل بود اجراش می‌کنه و true برمی‌گردونه؛ وگرنه false
export async function handleTraceCommand(chatId, text) {
  const [cmd, ...args] = text.split(/\s+/);

  if (cmd === "/debug") {
    const arg = args[0];
    if (arg === "on") {
      await setDebug(true);
      await say(
        chatId,
        `🐞 debug برای ${DEBUG_HOURS} ساعت روشن شد. از دورهای بعدی، متن کوتاه‌شده‌ی پرامپت و پاسخ AI (حداکثر ۱۵۰۰ نویسه) هم داخل trace ذخیره میشه و فقط خودت با /trace می‌بینی‌شون.`,
      );
    } else if (arg === "off") {
      await setDebug(false);
      await say(chatId, "🐞 debug خاموش شد.");
    } else if (!arg) {
      await say(chatId, describeDebug(await debugUntilSeconds()));
    } else {
      await say(chatId, "فرمت درست: /debug یا /debug on یا /debug off");
    }
    return true;
  }

  if (cmd === "/why") {
    await handleWhy(chatId, args);
    return true;
  }

  if (cmd === "/replay") {
    await handleReplay(chatId, args);
    return true;
  }

  if (cmd !== "/trace") return false;

  const wantsLast = !args[0] || args[0] === "last";
  const wantRound = wantsLast ? null : Number(args[0]);
  const wantAttempt = args[1] ? Number(args[1]) : null;
  if (
    (!wantsLast && !Number.isInteger(wantRound)) ||
    (args[1] && !Number.isInteger(wantAttempt))
  ) {
    await say(
      chatId,
      "فرمت درست: /trace یا /trace last یا /trace <شماره‌ی دور> [شماره‌ی تلاش]",
    );
    return true;
  }

  // «آخرین» = آخرین ردیفی که نوشته یا به‌روز شده (فعلاً یک گروه داریم)
  const latest = await db
    .select()
    .from(traceRing)
    .orderBy(sql`${traceRing.updated} DESC, ${traceRing.id} DESC`)
    .limit(1)
    .get();
  if (!latest) {
    await say(chatId, "هنوز هیچ دوری ردگیری نشده.");
    return true;
  }
  let row = latest;
  if (!wantsLast && wantRound !== latest.round) {
    row = await db
      .select()
      .from(traceRing)
      .where(
        and(
          eq(traceRing.chatId, latest.chatId),
          eq(traceRing.round, wantRound),
        ),
      )
      .get();
    if (!row) {
      await say(
        chatId,
        `دور ${wantRound} توی trace نیست (فقط ۵۰ دور آخر نگه داشته میشه، و دورهای قبل از V05 ردگیری نشدن).`,
      );
      return true;
    }
  }
  const n = Array.isArray(row.attempts) ? row.attempts.length : 0;
  if (wantAttempt !== null && (wantAttempt < 1 || wantAttempt > n)) {
    await say(chatId, `دور ${row.round} فقط ${n} تلاش دارد.`);
    return true;
  }

  const chunks = splitChunks(formatTrace(row, wantAttempt));
  for (const c of chunks.slice(0, MAX_CHUNKS)) await say(chatId, c);
  if (chunks.length > MAX_CHUNKS) {
    await say(
      chatId,
      `… ${chunks.length - MAX_CHUNKS} بخش دیگر نمایش داده نشد.`,
    );
  }
  return true;
}
