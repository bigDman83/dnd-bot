import { api, db } from "sdk";
import { eq } from "sdk/db";
import { gameSessions } from "schema";

// ctx = { callbackQuery, data, chatId, messageId, from } — توی callback_query.js ساخته می‌شه

// جواب کوتاهی که بالای صفحه‌ی کاربر نشون داده می‌شه (toast)
export function toast(ctx, text) {
  return api.answerCallbackQuery({
    callback_query_id: ctx.callbackQuery.id,
    text,
  });
}

export function getSession(chatId) {
  return db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
}

// دکمه‌ی یه دور قدیمی؟ اگه آره: جواب بده، دکمه‌های پیام رو بردار و true برگردون
export async function rejectStaleRound(ctx, session, round, text) {
  if (session && round === (session.currentRound || 1)) return false;
  await toast(ctx, text);
  await api.editMessageText({
    chat_id: ctx.chatId,
    message_id: ctx.messageId,
    text: ctx.callbackQuery.message.text,
  });
  return true;
}
