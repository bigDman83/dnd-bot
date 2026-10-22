import { api, db } from "sdk";
import { eq, and, sql } from "sdk/db";
import { isGroupAdmin } from "lib/api/telegram";
import {
  gameSessions,
  partyMembers,
  characters,
  sceneActions,
  sessionLog,
} from "schema";
import { generateNarration } from "lib/ai/aiClient";
// وضعیت دور فعلی: کی جواب داده، کی نه
export async function getRoundState(chatId) {
  const session = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
  if (!session) return null;

  const round = session.currentRound || 1;

  const members = await db
    .select()
    .from(partyMembers)
    .where(eq(partyMembers.chatId, chatId))
    .all();
  const actions = await db
    .select()
    .from(sceneActions)
    .where(and(eq(sceneActions.chatId, chatId), eq(sceneActions.round, round)))
    .all();

  const players = [];
  for (const m of members) {
    if (!m.characterId) continue;
    const c = await db
      .select()
      .from(characters)
      .where(eq(characters.id, m.characterId))
      .get();
    players.push({
      tgId: m.tgId,
      characterId: m.characterId,
      name: c?.name || "ناشناس",
      action: actions.find((a) => a.tgId === m.tgId) || null,
    });
  }

  return {
    session,
    round,
    players,
    allAnswered: players.length > 0 && players.every((p) => p.action),
  };
}

// ثبت (یا جایگزینی) پاسخ یک بازیکن در دور فعلی
export async function recordAction(
  chatId,
  tgId,
  kind,
  content,
  messageId = null,
) {
  const state = await getRoundState(chatId);
  if (!state || state.session.status !== "in_narrative") {
    return { ok: false, reason: "not_playing" };
  }
  if (!state.players.some((p) => p.tgId === tgId)) {
    return { ok: false, reason: "not_player" };
  }

  await db
    .insert(sceneActions)
    .values({ chatId, round: state.round, tgId, kind, content, messageId })
    .onConflictDoUpdate({
      target: [sceneActions.chatId, sceneActions.round, sceneActions.tgId],
      set: { kind, content, messageId },
    })
    .run();

  return { ok: true };
}

// آیا این پیام ویرایش‌شده، همان پیامیه که اقدام فعلی این بازیکن در دور فعلی ازش ساخته شده؟
// (اقدام دکمه‌ای message_id ندارد، پس ویرایش پیام قدیمی بعد از زدن دکمه هم رد می‌شود)
export async function isEditOfRecordedAction(chatId, tgId, messageId) {
  const session = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
  if (!session || session.status !== "in_narrative") return false;

  const action = await db
    .select()
    .from(sceneActions)
    .where(
      and(
        eq(sceneActions.chatId, chatId),
        eq(sceneActions.round, session.currentRound || 1),
        eq(sceneActions.tgId, tgId),
      ),
    )
    .get();
  return !!action && action.messageId != null && action.messageId === messageId;
}

// وقتی پیام بازیکن قالب (دیالوگ)[اکشن] رو نداره، با کمک AI و صحنه‌ی فعلی به همین قالب درش میاره.
// اگه AI تشخیص بده اصلاً اکشن نیست (چت معمولیه)، null برمی‌گردونه تا نادیده گرفته بشه.
// اگه AI خطا بده یا JSON نامعتبر بده، برای این‌که پیام بازیکن گم نشه، کل متن رو خودش یک اکشن در نظر می‌گیریم.
export async function normalizeFreeText(chatId, text, forceProvider = null) {
  const logs = await db
    .select()
    .from(sessionLog)
    .where(eq(sessionLog.chatId, chatId))
    .all();
  const lastScene = [...logs].reverse().find((l) => l.role === "narrator");
  const sceneText = lastScene ? lastScene.content : "(صحنه‌ای هنوز نیست)";

  try {
    const raw = await generateNarration(
      "action_normalizer",
      [
        {
          role: "user",
          content: `صحنه‌ی فعلی:\n${sceneText}\n\nپیام بازیکن:\n"${text}"\n\nتشخیص بده و قالب‌بندی کن.`,
        },
      ],
      forceProvider,
      { temperature: 0.3, jsonMode: true },
    );
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON پیدا نشد");
    const data = JSON.parse(match[0]);
    if (!data?.isAction) return null;
    const formatted = String(data.formatted || "").trim();
    if (formatted.includes("(") || formatted.includes("[")) return formatted;
    return `[${text}]`;
  } catch (err) {
    console.warn("⚠️  normalizeFreeText: خروجی AI معتبر نبود:", err.message);
    return `[${text}]`;
  }
}

// متن کوتاهی که موقع زدن دکمه بالای صفحه نشون داده میشه
export function actionToast(result) {
  if (result.ok) return "✅ ثبت شد";
  if (result.reason === "not_player") return "تو توی این بازی شخصیت نداری!";
  return "⏸ الان نمی‌شه (بازی متوقفه یا صحنه‌ی بعد در حال ساخته‌شدنه)";
}

// خلاصه‌ی کوتاه پاسخ یک بازیکن، برای نشون‌دادن جلوی اسمش توی پیام وضعیت دور
function formatActionPreview(action) {
  if (!action) return "";
  if (action.kind === "skip") return " — رد میشه (Skip)";
  const content = (action.content || "").replace(/\s+/g, " ").trim();
  if (!content) return "";
  const short = content.length > 60 ? `${content.slice(0, 60)}…` : content;
  return `: ${short}`;
}

function buildStatusText(state) {
  const lines = state.players.map(
    (p) =>
      `${p.action ? "✅" : "⏳"} ${p.name}${formatActionPreview(p.action)}`,
  );
  const header = state.allAnswered
    ? `🎭 دور ${state.round} — همه پاسخ دادن! منتظر تأیید ادمین`
    : `🎭 دور ${state.round} — منتظر پاسخ بازیکن‌ها:`;
  const hint = state.allAnswered
    ? "(هر کس تا قبل از تأیید ادمین می‌تونه جوابش رو عوض کنه)"
    : "(تا وقتی ادمین تأیید نکرده می‌تونی جوابت رو عوض کنی)";
  return `${header}\n${lines.join("\n")}\n\n${hint}`;
}

// پیام وضعیت دور رو بساز (اگه نبود) یا ویرایش کن (اگه بود)
export async function updateRoundStatus(chatId) {
  const state = await getRoundState(chatId);
  if (!state) return;
  const text = buildStatusText(state);
  const goButton = {
    inline_keyboard: [
      [
        {
          text: "✅ تأیید و ادامه‌ی داستان (ادمین)",
          callback_data: `round_go_${state.round}`,
        },
      ],
    ],
  };

  if (state.session.roundMessageId) {
    // ویرایش: اگه همه جواب ندادن، دکمه برداشته میشه (inline_keyboard خالی)
    await api.editMessageText({
      chat_id: chatId,
      message_id: state.session.roundMessageId,
      text,
      reply_markup: state.allAnswered ? goButton : { inline_keyboard: [] },
    });
  } else {
    const payload = { chat_id: chatId, text };
    if (state.allAnswered) payload.reply_markup = goButton;
    const sent = await api.sendMessage(payload);
    if (sent) {
      await db
        .update(gameSessions)
        .set({ roundMessageId: sent.message_id })
        .where(eq(gameSessions.chatId, chatId))
        .run();
    }
  }
}

// ---------- قفل گیرکردهٔ دور ----------

// مهلتی که بعدش ادمین می‌تونه قفل resolving رو آزاد کنه (قفل خودکار هیچ‌وقت باز نمی‌شه)
export const LOCK_TIMEOUT_SECONDS = 120;

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// آزادسازی اتمیِ قفل. فقط وقتی کار می‌کنه که status=resolving باشه و حداقل ۲ دقیقه گذشته باشه.
// (قفل‌های قدیمی بدون resolving_since هم قابل‌آزادسازی‌ان)
export async function releaseStuckLock(chatId) {
  const limit = nowSeconds() - LOCK_TIMEOUT_SECONDS;
  const released = await db
    .update(gameSessions)
    .set({ status: "in_narrative", resolvingSince: null })
    .where(
      and(
        eq(gameSessions.chatId, chatId),
        eq(gameSessions.status, "resolving"),
        sql`(${gameSessions.resolvingSince} IS NULL OR ${gameSessions.resolvingSince} <= ${limit})`,
      ),
    )
    .returning()
    .all();
  if (released.length > 0) return { ok: true };

  const session = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
  if (!session || session.status !== "resolving") {
    return { ok: false, reason: "no_lock" };
  }
  const secondsLeft = Math.max(
    1,
    (session.resolvingSince || 0) + LOCK_TIMEOUT_SECONDS - nowSeconds(),
  );
  return { ok: false, reason: "too_early", secondsLeft };
}

// کارِ مشترکِ دکمه و دستور: چک ادمین، آزادسازی، و ساخت دوبارهٔ پیام وضعیت.
// متن جوابی که باید به کاربر نشون داده بشه رو برمی‌گردونه.
export async function unlockRound(chatId, tgId) {
  if (!(await isGroupAdmin(chatId, tgId))) {
    return { ok: false, text: "فقط ادمین‌های گروه می‌تونن قفل رو آزاد کنن" };
  }
  const result = await releaseStuckLock(chatId);
  if (!result.ok) {
    return {
      ok: false,
      text:
        result.reason === "too_early"
          ? `⏳ هنوز زوده؛ ${result.secondsLeft} ثانیه‌ی دیگه دوباره امتحان کن`
          : "الان قفلی در کار نیست",
    };
  }
  await updateRoundStatus(chatId); // پیام وضعیت و دکمه‌ی تأیید دوباره ساخته میشه
  return { ok: true, text: "🔓 قفل آزاد شد؛ ادمین دوباره تأیید بده" };
}

// ---------- بازگرداندن بازیکن با شخصیت جدید (مثلاً بعد از مرگ شخصیتش) ----------

// بررسی‌ها + ساخت ردیف عضو بدون شخصیت؛ بعدش handler دستور پیام «انتخاب/ساخت شخصیت» را می‌فرستد.
// فقط ادمین‌ها، فقط وقتی بازی در حال روایت است (نه نبرد، نه توقف، نه ساخت صحنه).
export async function prepareRejoin(chatId, adminTgId, target) {
  if (!(await isGroupAdmin(chatId, adminTgId))) {
    return {
      ok: false,
      text: "فقط ادمین‌های گروه می‌تونن بازیکن رو برگردونن",
    };
  }
  if (!target || target.is_bot) {
    return {
      ok: false,
      text: "روی یکی از پیام‌های همون بازیکن ریپلای کن و /rejoin بنویس",
    };
  }

  const session = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
  if (!session || session.status !== "in_narrative") {
    return {
      ok: false,
      text: "الان نمی‌شه؛ بازیکن رو فقط وقتی می‌تونی برگردونی که بازی در حال روایته (نه نبرد، نه توقف، نه ساخت صحنه)",
    };
  }

  const member = await db
    .select()
    .from(partyMembers)
    .where(
      and(eq(partyMembers.chatId, chatId), eq(partyMembers.tgId, target.id)),
    )
    .get();

  if (member?.characterId) {
    const c = await db
      .select()
      .from(characters)
      .where(eq(characters.id, member.characterId))
      .get();
    if (c && !c.dead) {
      return {
        ok: false,
        text: `${target.first_name} الان با شخصیت زنده‌ی خودش (${c.name}) توی بازیه`,
      };
    }
  }

  if (member) {
    await db
      .update(partyMembers)
      .set({ isReady: true, characterId: null })
      .where(
        and(eq(partyMembers.chatId, chatId), eq(partyMembers.tgId, target.id)),
      )
      .run();
  } else {
    await db
      .insert(partyMembers)
      .values({ chatId, tgId: target.id, isReady: true })
      .run();
  }
  return { ok: true };
}

// بعد از ورود یک بازیکن وسط بازی (مثلاً با /rejoin): پیام وضعیت دور را به‌روز کن تا تازه‌وارد داخلش بیاید
// و اگر دکمهٔ تأیید ادمین بود برداشته شود (چون تازه‌وارد هنوز جواب نداده). وقتی بازی در حال روایت نیست کاری نمی‌کند.
export async function refreshRoundStatusIfRunning(chatId) {
  const session = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
  if (!session || session.status !== "in_narrative") return;
  await updateRoundStatus(chatId);
}
