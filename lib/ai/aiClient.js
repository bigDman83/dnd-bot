import { fetch, db } from "sdk";
import { prompts, settings, errorLogs } from "schema";
import { eq } from "sdk/db";
import { DEFAULT_PROMPTS } from "lib/ai/defaultPrompts";
import { remainingMs } from "lib/core/budget";
import { span, currentTraceId, hashText, STEPS } from "lib/core/trace";

const CALL_TIMEOUT_MS = 20000; // سقف هر درخواست AI
const MAX_RETRY_WAIT_MS = 5000; // بیشتر از این صبر نمی‌کنیم؛ می‌ریم سراغ provider بعدی
const MIN_CALL_MS = 4000; // کمتر از این زمان مونده باشه، درخواست تازه نمی‌زنیم
const LAST_PROVIDER_MAX_WAIT_MS = 10000; // provider آخر (جایگزینی نداره) تا این‌قدر صبر می‌کنه

// خطاهایی که یعنی «این provider الان شلوغه/خرابه»: اگه provider دیگه‌ای مونده، فوراً می‌ریم سراغش
const FAST_FAIL_STATUS = [429, 500, 502, 503, 504];

// فقط برای Groq و مدل‌های gpt-oss: "low" | "medium" | "high" (null = ارسال نشه)
// "low" توکن فکرکردن رو خیلی کم می‌کنه و فشار روی سقف توکن در دقیقه (TPM) رو کم می‌کنه
const GROQ_REASONING_EFFORT = "low";

class BudgetError extends Error {}

const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
// timeout یعنی provider عملاً از دسترس خارجه و هر امتحان ۲۰ ثانیه از دور می‌خوره
const TIMEOUT_COOLDOWN_MS = 20 * 60 * 1000;
const _cooldowns = {}; // providerName -> timestamp تا کی نادیده گرفته بشه

async function getSetting(key) {
  const row = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row ? row.value : null;
}

async function getPromptText(key) {
  const row = await db.select().from(prompts).where(eq(prompts.key, key)).get();
  return row ? row.content : DEFAULT_PROMPTS[key] || "";
}

async function logError(source, errorMessage, context) {
  await db
    .insert(errorLogs)
    .values({
      source,
      errorMessage: String(errorMessage),
      context: JSON.stringify(context || {}),
    })
    .run();
}

// cooldown هم در حافظه (سریع) و هم در جدول settings نگه داشته میشه، چون Worker
// ممکنه هر درخواست روی یه نمونه‌ی تازه اجرا بشه و حافظه خالی باشه
const COOLDOWN_KEY = "ai_cooldown_";

async function isOnCooldown(name) {
  if (_cooldowns[name] && _cooldowns[name] > Date.now()) return true;
  try {
    const until = Number(await getSetting(COOLDOWN_KEY + name)) || 0;
    if (until > Date.now()) {
      _cooldowns[name] = until;
      return true;
    }
  } catch {}
  return false;
}

// 429 با Retry-After کوتاه (مثل سقف توکن در دقیقه‌ی Groq) cooldown کوتاه می‌گیره،
// بقیه‌ی شکست‌ها ۵ دقیقه
async function markFailure(name, err) {
  let ms = err?.timeout ? TIMEOUT_COOLDOWN_MS : FAILURE_COOLDOWN_MS;
  if (err?.status === 429 && err.retryAfter) {
    ms = Math.min(Math.max(err.retryAfter * 1000, 5000), 60000);
  }
  const until = Date.now() + ms;
  _cooldowns[name] = until;
  try {
    const value = String(until);
    await db
      .insert(settings)
      .values({ key: COOLDOWN_KEY + name, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  } catch {}
}

// فراخوانی هر endpoint سازگار با فرمت OpenAI (OpenRouter، Groq، و حتی Ollama لوکال)
async function callOpenAiCompatible(
  url,
  apiKey,
  model,
  messages,
  opts = {},
  info = {},
) {
  const body = { model, messages, temperature: opts.temperature ?? 0.9 };
  if (opts.jsonMode) body.response_format = { type: "json_object" };
  if (opts.extraBody) Object.assign(body, opts.extraBody);

  const left = remainingMs();
  if (left < MIN_CALL_MS) {
    throw new BudgetError("زمان کافی برای درخواست تازه نمونده");
  }
  info.attempts = (info.attempts || 0) + 1; // برای trace: تعداد درخواست‌های واقعی
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(CALL_TIMEOUT_MS, left - 1000),
  );

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey || "none"}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {}
      const limitHeaders = [...res.headers]
        .filter(([k]) => k.startsWith("x-ratelimit") || k === "retry-after")
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      console.warn(`📉 ${res.status} از ${url} | ${detail} | ${limitHeaders}`);
      const err = new Error(`HTTP ${res.status} از ${url}`);
      err.status = res.status;
      err.retryAfter = Number(res.headers.get("retry-after")) || null;
      throw err;
    }
    const data = await res.json();
    info.usage = data.usage || null; // برای trace
    info.model = data.model || null;
    return data.choices[0].message.content;
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error(`timeout از ${url}`);
      e.timeout = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
async function withRetry(fn, { isLast = true } = {}) {
  const defaultDelays = [1000, 3000, 7000];
  let lastErr;
  for (let i = 0; i < defaultDelays.length; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // بودجه تموم شده یا provider کنده: دوباره‌زدن همین provider فایده ندارد
      if (err instanceof BudgetError || err.timeout) throw err;
      // provider شلوغ/خرابه و provider دیگه‌ای مونده: وقت رو تلف نکن، برو سراغ بعدی
      if (!isLast && FAST_FAIL_STATUS.includes(err.status)) throw err;
      if (i === defaultDelays.length - 1) break;
      const wait = err.retryAfter ? err.retryAfter * 1000 : defaultDelays[i];
      // provider آخر جایگزین نداره، پس کمی بیشتر صبر می‌کنه
      const maxWait = isLast ? LAST_PROVIDER_MAX_WAIT_MS : MAX_RETRY_WAIT_MS;
      if (wait > maxWait || wait + MIN_CALL_MS > remainingMs()) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
/**
 * promptKey: کلید پرامپت سیستم در جدول prompts (یا پیش‌فرض)
 * contextMessages: آرایه‌ی پیام‌های [{role, content}]
 * forceProvider: (اختیاری، فقط برای تست محلی) { name, url, model, apiKey }
 */
export async function generateNarration(
  promptKey,
  contextMessages,
  forceProvider = null,
  opts = {},
) {
  const systemText = await getPromptText(promptKey);
  const messages = [
    { role: "system", content: systemText },
    ...contextMessages,
  ];

  const providers = [];

  if (forceProvider) {
    providers.push({
      name: forceProvider.name,
      model: forceProvider.model,
      fn: (info) =>
        callOpenAiCompatible(
          forceProvider.url,
          forceProvider.apiKey,
          forceProvider.model,
          messages,
          opts,
          info,
        ),
    });
  }

  const openrouterKey = await getSetting("openrouter_api_key");
  if (openrouterKey) {
    providers.push({
      name: "openrouter",
      model: "google/gemma-4-31b-it:free",
      fn: (info) =>
        callOpenAiCompatible(
          "https://openrouter.ai/api/v1/chat/completions",
          openrouterKey,
          "google/gemma-4-31b-it:free",
          messages,
          opts,
          info,
        ),
    });
  }

  const groqKey = await getSetting("groq_api_key");
  if (groqKey) {
    providers.push({
      name: "groq",
      model: "openai/gpt-oss-120b",
      fn: (info) =>
        callOpenAiCompatible(
          "https://api.groq.com/openai/v1/chat/completions",
          groqKey,
          "openai/gpt-oss-120b",
          messages,
          GROQ_REASONING_EFFORT
            ? {
                ...opts,
                extraBody: { reasoning_effort: GROQ_REASONING_EFFORT },
              }
            : opts,
          info,
        ),
    });
  }

  // providerهای در cooldown کنار می‌روند، ولی اگه هیچ provider سالمی نمونده
  // همه دوباره امتحان می‌شن (cooldown فقط وقتی کار می‌کنه که جایگزین سالم داریم)
  const cooling = {};
  for (const p of providers) cooling[p.name] = await isOnCooldown(p.name);
  const healthy = providers.filter((p) => !cooling[p.name]);
  if (healthy.length === 0 && providers.length > 0) {
    console.warn("⚠️  همهٔ providerها در cooldown بودن؛ دوباره امتحان می‌شن");
  }
  const toTry = healthy.length > 0 ? healthy : providers;

  // ردگیری (فقط وقتی داخل trace یک دور هستیم)؛ از متن پرامپت فقط hash ذخیره میشه
  const traced = !!currentTraceId();
  const promptHash = traced ? await hashText(JSON.stringify(messages)) : null;
  if (traced && healthy.length > 0) {
    for (const p of providers) {
      if (!healthy.includes(p)) {
        span(STEPS.AI_CALL, "AI_PROVIDER_COOLDOWN", {
          promptKey,
          provider: p.name,
        });
      }
    }
  }

  const failed = []; // provider هایی که توی همین درخواست شکست خوردن
  for (const provider of toTry) {
    const info = { attempts: 0 };
    const t0 = Date.now();
    const isLast = provider === toTry[toTry.length - 1];
    try {
      const content = await withRetry(() => provider.fn(info), { isLast });
      if (traced) {
        span(
          STEPS.AI_CALL,
          failed.length ? "AI_FALLBACK_USED" : null,
          {
            promptKey,
            provider: provider.name,
            model: provider.model,
            respModel: info.model ?? null,
            ok: true,
            ms: Date.now() - t0,
            attempts: info.attempts,
            promptTokens: info.usage?.prompt_tokens ?? null,
            completionTokens: info.usage?.completion_tokens ?? null,
            chars: typeof content === "string" ? content.length : null,
            promptHash,
            failedBefore: failed.length ? failed : null,
          },
          {
            debug: {
              prompt: messages[messages.length - 1].content,
              response: content,
            },
          },
        );
      }
      return content;
    } catch (err) {
      if (traced) {
        span(
          STEPS.AI_CALL,
          err.timeout ? "AI_TIMEOUT" : null,
          {
            promptKey,
            provider: provider.name,
            model: provider.model,
            ok: false,
            ms: Date.now() - t0,
            attempts: info.attempts,
            status: err.status ?? null,
            timeout: !!err.timeout,
            budget: err instanceof BudgetError,
            promptHash,
          },
          { level: "ERROR" },
        );
      }
      if (err instanceof BudgetError) {
        // مشکل از provider نیست؛ زمان این درخواست تموم شده، پس cooldown نمی‌ذاریم
        console.error("⏱ بودجه‌ی زمان این درخواست تموم شد:", err.message);
        break;
      }
      console.error(`⚠️  provider "${provider.name}" شکست خورد:`, err.message);
      failed.push(provider.name);
      await markFailure(provider.name, err);
      await logError("ai", err.message, {
        provider: provider.name,
        promptKey,
        traceId: currentTraceId(),
      });
    }
  }
  await logError("ai", "همه‌ی providerهای AI شکست خوردن", {
    promptKey,
    traceId: currentTraceId(),
  });
  if (traced) {
    span(
      STEPS.AI_CALL,
      "AI_FALLBACK_USED",
      { promptKey, allFailed: true, tried: failed, promptHash },
      { level: "ERROR" },
    );
  }
  return "یه لحظه صبر کن، دنیا داره نفس می‌کشه 🌙";
}
