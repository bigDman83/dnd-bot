import { api, db } from "sdk";
import { partyMembers, characters, gameSessions } from "schema";
import { eq, and } from "sdk/db";
import { maybeStartOpening, sendOpeningMessage } from "lib/game/narrator";
import { refreshRoundStatusIfRunning } from "lib/game/rounds";
import { toast, getSession } from "./common.js";

// ---------- کمکی‌ها ----------

async function sendOpeningIfReady(chatId) {
  const opening = await maybeStartOpening(chatId);
  if (!opening) {
    // بازی از قبل در جریان است (مثلاً بازیکنی با /rejoin برگشته) ← پیام وضعیت دور به‌روز شود
    await refreshRoundStatusIfRunning(chatId);
    return;
  }
  await sendOpeningMessage(chatId, opening);
}

function findMember(chatId, tgId) {
  return db
    .select()
    .from(partyMembers)
    .where(and(eq(partyMembers.chatId, chatId), eq(partyMembers.tgId, tgId)))
    .get();
}

async function countReadyMembers(chatId) {
  const ready = await db
    .select()
    .from(partyMembers)
    .where(and(eq(partyMembers.chatId, chatId), eq(partyMembers.isReady, true)))
    .all();
  return ready.length;
}

// ---------- انتخاب تعداد بازیکن (بعد از /startgame) ----------

export async function onExpectedPlayers(ctx) {
  const { data, chatId, messageId } = ctx;
  const n = parseInt(data.replace("sp_expected_", ""), 10);
  await db
    .update(gameSessions)
    .set({ expectedPlayers: n, status: "idle" })
    .where(eq(gameSessions.chatId, chatId))
    .run();

  await toast(ctx, `${n} نفر ثبت شد`);
  // پیام انتخاب تعداد دیگه لازم نیست
  await api.deleteMessage({ chat_id: chatId, message_id: messageId });
  const readyMsg = await api.sendMessage({
    chat_id: chatId,
    text: `✅ قراره ${n} نفر بازی کنن. هر کی می‌خواد بازی کنه، روی دکمه‌ی زیر بزنه:\n(می‌تونی با /بساز_دنیا <حال‌وهوا> از الان تم دنیا رو هم مشخص کنی)`,
    reply_markup: {
      inline_keyboard: [[{ text: "✅ آماده‌ام", callback_data: "ready" }]],
    },
  });

  // شناسه‌ی پیام «آماده‌ام» رو نگه دار تا وقتی بازی شروع شد پاک بشه
  if (readyMsg) {
    await db
      .update(gameSessions)
      .set({ lobbyMessageId: readyMsg.message_id })
      .where(eq(gameSessions.chatId, chatId))
      .run();
  }
}

// ---------- «آماده‌ام» ----------

// اگه این بازیکن قبلاً آماده نبوده و ظرفیت پره، اجازه نده
async function isLobbyFull(chatId, tgId, session) {
  const alreadyMember = await findMember(chatId, tgId);
  if (alreadyMember?.isReady || !session?.expectedPlayers) return false;
  return (await countReadyMembers(chatId)) >= session.expectedPlayers;
}

// اگه با همین نفر ظرفیت پر شد، دکمه‌ی «آماده‌ام» رو غیرفعال کن که کس دیگه‌ای نتونه بزنه
async function closeLobbyIfFull(chatId, session) {
  if (!session?.expectedPlayers || !session.lobbyMessageId) return;
  if ((await countReadyMembers(chatId)) >= session.expectedPlayers) {
    await api.editMessageReplyMarkup({
      chat_id: chatId,
      message_id: session.lobbyMessageId,
      reply_markup: { inline_keyboard: [] },
    });
  }
}

// پیام «شخصیت قبلی رو انتخاب کن / شخصیت جدید بساز» برای این بازیکن
export async function sendCharacterPrompt(chatId, from) {
  const readyChars = await db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.ownerTgId, from.id),
        eq(characters.status, "ready"),
        eq(characters.dead, 0),
      ),
    )
    .all();

  // اگه قبلاً همین بازیکن این پیام رو گرفته بود (دوباره «آماده‌ام» زد)، قدیمی رو پاک کن
  const existingMember = await findMember(chatId, from.id);
  if (existingMember?.promptMessageId) {
    await api.deleteMessage({
      chat_id: chatId,
      message_id: existingMember.promptMessageId,
    });
  }

  let sent;

  if (readyChars.length > 0) {
    const buttons = readyChars.map((c) => [
      {
        text: `🧝 ${c.name} (سطح ${c.level})`,
        callback_data: `pick_char_${c.id}`,
      },
    ]);
    buttons.push([
      { text: "➕ ساخت شخصیت جدید", callback_data: `mkchar_${from.id}` },
    ]);

    sent = await api.sendMessage({
      chat_id: chatId,
      text: `${from.first_name}، یکی از شخصیت‌های قبلیت رو انتخاب کن یا یکی جدید بساز:`,
      reply_markup: { inline_keyboard: buttons },
    });
  } else {
    sent = await api.sendMessage({
      chat_id: chatId,
      text: `${from.first_name}، هنوز شخصیتی نساختی! برای ساختنش روی دکمه بزن (ادامه‌ش توی چت خصوصیه):`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧙 ساخت شخصیت", callback_data: `mkchar_${from.id}` }],
        ],
      },
    });
  }

  // شناسه‌ی این پیام رو ذخیره کن تا بعد از انتخاب/ساخت شخصیت پاک بشه
  if (sent) {
    await db
      .update(partyMembers)
      .set({ promptMessageId: sent.message_id })
      .where(
        and(eq(partyMembers.chatId, chatId), eq(partyMembers.tgId, from.id)),
      )
      .run();
  }
}

export async function onReady(ctx) {
  const { chatId, from } = ctx;
  const session = await getSession(chatId);

  if (await isLobbyFull(chatId, from.id, session)) {
    await toast(ctx, "ظرفیت این بازی تکمیله!");
    return;
  }

  // ثبت اعلام آمادگی این بازیکن برای این گروه
  await db
    .insert(partyMembers)
    .values({ chatId, tgId: from.id, isReady: true })
    .onConflictDoUpdate({
      target: [partyMembers.chatId, partyMembers.tgId],
      set: { isReady: true },
    })
    .run();

  await toast(ctx, "آماده شدی! ✅");

  await closeLobbyIfFull(chatId, session);
  await sendCharacterPrompt(chatId, from);
}

// ---------- ساخت و انتخاب شخصیت ----------

// دکمه‌ی «ساخت شخصیت» که در پیام گروه میاد؛ فقط صاحبش می‌تونه بزنه
export async function onMakeCharacter(ctx) {
  const { data, chatId, from } = ctx;
  const ownerTgId = parseInt(data.replace("mkchar_", ""), 10);
  if (ownerTgId !== from.id) {
    await toast(ctx, "این دکمه مال تو نیست!");
    return;
  }
  const me = await api.getMe();
  const deepLink = `https://t.me/${me.username}?start=create_character_${chatId}`;
  await api.answerCallbackQuery({
    callback_query_id: ctx.callbackQuery.id,
    url: deepLink,
  });
}

// انتخاب یکی از شخصیت‌های قبلی برای این بازی
export async function onPickCharacter(ctx) {
  const { data, chatId, messageId, from } = ctx;
  const characterId = parseInt(data.replace("pick_char_", ""), 10);
  // فقط صاحب شخصیت می‌تونه انتخابش کنه
  const chosen = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId))
    .get();
  if (!chosen || chosen.ownerTgId !== from.id) {
    await toast(ctx, "این شخصیت مال تو نیست!");
    return;
  }
  if (chosen.dead) {
    await toast(ctx, "این شخصیت مرده! یکی دیگه انتخاب کن یا شخصیت جدید بساز");
    return;
  }
  await db
    .update(partyMembers)
    .set({ characterId, promptMessageId: null })
    .where(and(eq(partyMembers.chatId, chatId), eq(partyMembers.tgId, from.id)))
    .run();

  await toast(ctx, "شخصیتت برای این بازی انتخاب شد! ✅");

  // پیام «شخصیتت رو انتخاب کن» دیگه لازم نیست
  await api.deleteMessage({ chat_id: chatId, message_id: messageId });
  await sendOpeningIfReady(chatId);
}
