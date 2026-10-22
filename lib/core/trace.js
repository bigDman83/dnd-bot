import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "sdk";
import { eq, and, sql } from "sdk/db";
import { traceRing, settings } from "schema";

// ---------- Observability: ردگیری گام‌به‌گام هر دور ----------
// هر دور = یک traceId؛ هر گام = یک span با «کد دلیل» بسته.
// حریم (اصل ۷): داخل data فقط ID و عدد بذار، نه متن بازیکن و نه روایت؛
// متن فقط در حالت debug و فقط از طریق opts.debug (کوتاه‌شده) ذخیره میشه.
// نوشتن trace بهترین‌تلاش (best-effort) است: هیچ‌وقت نباید دور بازی رو خراب کنه.

export const TRACE_KEEP_ROUNDS = 50; // ردیف دورهای قدیمی‌تر پاک میشن
export const MAX_ATTEMPTS = 5; // تلاش‌های دوباره‌ی یک دور (تأیید دوباره‌ی ادمین)
export const MAX_SPANS = 80; // سقف span در هر تلاش (خطاها همیشه جا دارن)
export const DEBUG_HOURS = 24;
const DEBUG_KEY = "debug_until"; // در جدول settings: ثانیه‌ی یونیکس پایان حالت debug

// فهرست بسته‌ی کدهای دلیل (observability.md بخش 3)؛ فقط بعضی‌ها الان استفاده میشن
export const REASON_CODES = new Set([
  "FEAS_MISSING_TOOL",
  "FEAS_KNOWS_MATCH",
  "FEAS_NOT_KNOWN",
  "FEAS_SPELL_LEVEL",
  "FEAS_NPC_ABSENT",
  "FEAS_CONDITION_BLOCK",
  "CHAIN_BROKEN_STEP",
  "CHAIN_STEP_ROLLED",
  "CHAIN_CAP_REACHED",
  "CHECK_ROLLED",
  "CHECK_CONTESTED",
  "CHECK_PASSIVE",
  "GATE_SKIP_COOLDOWN",
  "GATE_REUSE_SNAPSHOT",
  "GATE_ROLL",
  "GATE_SKIP_HOSTILITY_NONE",
  "BUDGET_CLASS_BUMP",
  "BUDGET_CLAMP_ENEMIES",
  "BUDGET_TRIVIAL",
  "DMG_IMMUNE",
  "DMG_RESISTED",
  "DMG_VULNERABLE",
  "DEFEAT_OUTCOME",
  "DEFEAT_FLEE_ROLL",
  "DEFEAT_SURRENDER",
  "CONSEQ_APPLIED",
  "CONSEQ_LASTING",
  "CONSEQ_PERMANENT",
  "CONSEQ_SEVERITY",
  "CLOCK_TICK",
  "CLOCK_FINAL_STAGE",
  "CLOCK_RECOVERY_ARC",
  "QUEST_OFFERED",
  "QUEST_ACCEPTED",
  "QUEST_COMPLETED",
  "QUEST_FAILED",
  "QUEST_EXTINGUISHED",
  "NPC_REACTION",
  "NPC_RELATION_DELTA",
  "NPC_SERVICE_HEAL",
  "PVP_CONSENT_PENDING",
  "PVP_CONSENT_GIVEN",
  "VALIDATOR_DMONLY_LEAK",
  "VALIDATOR_REDLINE",
  "VALIDATOR_REWRITE",
  "VALIDATOR_FALLBACK_KEYWORD",
  "DECISION_REVIEW_BAND",
  "DECISION_AUTO",
  "DECISION_REJECT",
  "AI_FALLBACK_USED",
  "AI_PROVIDER_COOLDOWN",
  "AI_TIMEOUT",
  "REST_INTERRUPTED",
  "REST_SHORT_BENEFIT",
  "REST_LONG_BENEFIT",
  "CALL_FOR_HELP",
]);

// اسم گام‌ها (برای یکدستی بین فایل‌ها)
export const STEPS = {
  LOCK: "lock",
  CONTEXT: "context",
  PLAN_REUSE: "plan_reuse",
  RESOLVER: "resolver",
  ROLL: "roll",
  TRAVEL: "travel",
  REST: "rest",
  CLOCK: "clock",
  NARRATION: "narration",
  LOCK_CHECK: "lock_check",
  COMMIT: "commit",
  SEND: "send",
  AI_CALL: "ai_call",
  COMBAT: "combat",
  ERROR: "error",
};

const LEVELS = new Set(["INFO", "DEBUG", "AUDIT", "ERROR"]);
const storage = new AsyncLocalStorage();

// ---------- ابزارهای کوچک ----------

function newTraceId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// hash کوتاه (۱۲ حرف) برای promptHash؛ متن کامل ذخیره نمیشه
export async function hashText(text) {
  const bytes = new TextEncoder().encode(String(text ?? ""));
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// داده‌ی قابل‌ذخیره در JSON، با رشته‌های کوتاه‌شده
function plain(obj, maxStr = 200) {
  try {
    return JSON.parse(
      JSON.stringify(obj ?? {}, (_k, v) =>
        typeof v === "string" && v.length > maxStr
          ? `${v.slice(0, maxStr)}…`
          : v,
      ),
    );
  } catch {
    return { note: "داده قابل ذخیره نبود" };
  }
}

// ---------- حالت debug (۲۴ ساعته) ----------

export async function debugUntilSeconds() {
  try {
    const row = await db
      .select()
      .from(settings)
      .where(eq(settings.key, DEBUG_KEY))
      .get();
    return row ? Number(row.value) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function isDebugOn() {
  return (await debugUntilSeconds()) > Date.now() / 1000;
}

// on=true: ۲۴ ساعت از الان؛ on=false: خاموش. پایان حالت (ثانیه‌ی یونیکس یا 0) برمی‌گرده
export async function setDebug(on) {
  const until = on ? Math.floor(Date.now() / 1000) + DEBUG_HOURS * 3600 : 0;
  const value = String(until);
  await db
    .insert(settings)
    .values({ key: DEBUG_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
  return until;
}

// ---------- ثبت span ----------

export function currentTraceId() {
  return storage.getStore()?.traceId || null;
}

// یک گام رو ثبت کن. بیرون از runWithTrace هیچ اتفاقی نمی‌افته (امن برای صدا زدن از هرجا)
// opts: { level: INFO|DEBUG|AUDIT|ERROR، ruleSource، refs: {eventIds، actionIds، npcIds}،
//         debug: {...} (فقط وقتی حالت debug روشنه ذخیره میشه) }
export function span(step, reasonCode = null, data = {}, opts = {}) {
  const store = storage.getStore();
  if (!store) return;
  const level = LEVELS.has(opts.level) ? opts.level : "INFO";
  if (level === "DEBUG" && !store.debug) return;
  if (reasonCode && !REASON_CODES.has(reasonCode)) {
    console.warn(
      `⚠️ trace: کد دلیل ناشناخته «${reasonCode}» (در فهرست بسته نیست)`,
    );
    reasonCode = null;
  }
  if (store.spans.length >= MAX_SPANS && level !== "ERROR") {
    store.dropped++;
    return;
  }
  const s = {
    n: store.seq++,
    t: Date.now() - store.startedAt, // میلی‌ثانیه از شروع این تلاش
    step,
    level,
    reasonCode,
    ruleSource: opts.ruleSource || "TARAN RULE",
    data: plain(data),
  };
  if (opts.refs) s.refs = plain(opts.refs);
  if (opts.debug && store.debug) s.dbg = plain(opts.debug, 1500);
  store.spans.push(s);
}

// نتیجه‌ی این تلاش: ok | error | lock_lost | combat | already_committed ...
export function setOutcome(outcome) {
  const store = storage.getStore();
  if (store) store.outcome = outcome;
}

// خطا رو هم به‌صورت span سطح ERROR ثبت کن
export function recordError(step, err, data = {}) {
  span(
    step,
    null,
    { ...data, message: err?.message || String(err) },
    {
      level: "ERROR",
    },
  );
}

// ---------- اجرای یک تلاش داخل trace ----------

// fn داخل یک trace اجرا میشه و آخرش (حتی با خطا) یک بار توی trace_ring نوشته میشه
export async function runWithTrace(chatId, round, fn) {
  const store = {
    traceId: newTraceId(),
    chatId,
    round,
    startedAt: Date.now(),
    spans: [],
    dropped: 0,
    seq: 0,
    outcome: null,
    debug: await isDebugOn(),
  };
  return storage.run(store, async () => {
    try {
      return await fn();
    } catch (err) {
      store.outcome = "error";
      recordError(STEPS.ERROR, err);
      throw err;
    } finally {
      await flushTrace(store);
    }
  });
}

async function flushTrace(store) {
  try {
    const outcome = store.outcome || "ended";
    const ms = Date.now() - store.startedAt;
    const attempt = {
      traceId: store.traceId,
      startedAt: Math.floor(store.startedAt / 1000),
      ms,
      outcome,
      debug: store.debug,
      dropped: store.dropped,
      spans: store.spans,
    };
    const where = and(
      eq(traceRing.chatId, store.chatId),
      eq(traceRing.round, store.round),
    );
    const existing = await db.select().from(traceRing).where(where).get();
    const old = Array.isArray(existing?.attempts) ? existing.attempts : [];
    const attempts = [...old, attempt].slice(-MAX_ATTEMPTS);
    if (existing) {
      await db
        .update(traceRing)
        .set({ outcome, attempts, updated: sql`(unixepoch())` })
        .where(where)
        .run();
    } else {
      await db
        .insert(traceRing)
        .values({ chatId: store.chatId, round: store.round, outcome, attempts })
        .run();
    }
    // حلقوی: فقط ۵۰ دور آخر
    await db
      .delete(traceRing)
      .where(
        and(
          eq(traceRing.chatId, store.chatId),
          sql`${traceRing.round} <= ${store.round - TRACE_KEEP_ROUNDS}`,
        ),
      )
      .run();
    console.log(
      `📊 trace ${store.traceId} | دور ${store.round} | ${outcome} | ${store.spans.length} span | ${ms}ms`,
    );
  } catch (err) {
    console.error("⚠️ نوشتن trace شکست خورد (بازی ادامه پیدا می‌کنه):", err);
  }
}
