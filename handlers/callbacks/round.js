import { api } from "sdk";
import { resolveRound } from "lib/game/round";
import {
  recordAction,
  actionToast,
  updateRoundStatus,
  unlockRound,
} from "lib/game/rounds";
import { isGroupAdmin } from "lib/api/telegram";
import { toast, getSession, rejectStaleRound } from "./common.js";

// یکی از ۳ پیشنهاد ادامه‌ی داستان — فقط ثبت میشه؛ اگه همه جواب بدن، دکمه‌ی تأیید ادمین میاد
export async function onSuggestion(ctx) {
  const { data, chatId, from } = ctx;
  const [, roundStr, idxStr] = data.split("_");
  const round = parseInt(roundStr, 10);
  const idx = parseInt(idxStr, 10);
  const session = await getSession(chatId);

  if (
    await rejectStaleRound(ctx, session, round, "این پیشنهاد مال دور قبلیه")
  ) {
    return;
  }

  const suggestion = session.pendingSuggestions?.[idx];
  if (!suggestion) {
    await toast(ctx, "دیگه معتبر نیست");
    return;
  }

  const result = await recordAction(chatId, from.id, "suggestion", suggestion);
  await toast(ctx, actionToast(result));
  if (result.ok) await updateRoundStatus(chatId);
}

// رد کردن نوبت (فقط همراهی می‌کنه)
export async function onSuggestionSkip(ctx) {
  const { data, chatId, from } = ctx;
  const round = parseInt(data.split("_")[2], 10);
  const session = await getSession(chatId);

  if (await rejectStaleRound(ctx, session, round, "این دکمه مال دور قبلیه")) {
    return;
  }

  const result = await recordAction(chatId, from.id, "skip", null);
  await toast(ctx, actionToast(result));
  if (result.ok) await updateRoundStatus(chatId);
}

// ادمین دور رو تأیید می‌کنه → روایت مشترک ساخته میشه
export async function onRoundGo(ctx) {
  const { data, chatId, from } = ctx;
  const round = parseInt(data.replace("round_go_", ""), 10);

  if (!(await isGroupAdmin(chatId, from.id))) {
    await toast(ctx, "فقط ادمین‌های گروه می‌تونن دور رو تأیید کنن");
    return;
  }

  const session = await getSession(chatId);
  if (session && session.status === "resolving") {
    await toast(ctx, "⏳ دارم صحنه‌ی بعد رو می‌سازم، یه کم صبر کن");
    return;
  }
  if (
    !session ||
    session.status !== "in_narrative" ||
    round !== (session.currentRound || 1)
  ) {
    await toast(ctx, "این دکمه دیگه معتبر نیست");
    return;
  }

  await toast(ctx, "✅ تأیید شد");
  await resolveRound(chatId);
}
// ادمین قفل گیرکردهٔ دور رو آزاد می‌کنه (فقط بعد از ۲ دقیقه)
export async function onRoundUnlock(ctx) {
  const { chatId, from } = ctx;
  const result = await unlockRound(chatId, from.id);
  await toast(ctx, result.text);
}
