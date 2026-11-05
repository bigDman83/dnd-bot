import { api, db, getOwnerTgId } from "sdk";
import {
  users,
  gameSessions,
  characters,
  partyMembers,
  settings,
  combatState,
  sessionLog,
  locations,
} from "schema";
import { eq, and } from "sdk/db";
import {
  startCreation,
  handleTextInput,
  formatCharacterSheet,
} from "lib/character/characterCreation";
import { buildWorld } from "lib/game/narrator";
import { beginCombat, presentCombatResult } from "lib/combat/combat";
import { monsterMenuText, monsterByIndex } from "lib/combat/monsters";
import {
  recordAction,
  updateRoundStatus,
  normalizeFreeText,
  isEditOfRecordedAction,
  unlockRound,
  prepareRejoin,
} from "lib/game/rounds";
import { isGroupAdmin } from "lib/api/telegram";
import { clearEventsForChat } from "lib/game/events";
import { resendScene } from "lib/game/round";
import { handleTraceCommand } from "./traceCommands.js";
import { sendCharacterPrompt } from "./callbacks/lobby.js";

// دستورهایی که بازی رو توی یه گروه شروع می‌کنن

const START_GAME_COMMANDS = ["/شروع_بازی", "/startgame"];
const BUILD_WORLD_PREFIXES = ["/buildworld ", "/بساز_دنیا "];
const COMBAT_COMMANDS = ["/combat", "/نبرد"];
const SHEET_COMMANDS = ["/کارنامه", "/inventory", "/sheet"];
const HELP_COMMANDS = ["/help", "/راهنما"];
const END_GAME_COMMANDS = ["/پایان_بازی", "/endgame"];
const PAUSE_GAME_COMMANDS = ["/توقف_بازی", "/pausegame"];
const CONTINUE_GAME_COMMANDS = ["/ادامه_بازی", "/continuegame"];
const UNLOCK_ROUND_COMMANDS = ["/آزادسازی_دور", "/unlockround"];
const RESEND_SCENE_COMMANDS = ["/ارسال_دوباره_صحنه", "/resendscene"];
const REJOIN_COMMANDS = ["/بازگشت_بازیکن", "/rejoin"];

// اگه متن با یکی از این پیشوندها شروع میشه، همون پیشوند رو برمی‌گردونه
function matchPrefix(text, prefixes) {
  return prefixes.find((p) => text.startsWith(p)) || null;
}

const HELP_TEXT =
  "📖 راهنمای دستورها:\n\n" +
  "— توی گروه —\n" +
  "/startgame — شروع یه بازی جدید\n" +
  "/endgame — تموم کردن بازی فعلی (فقط ادمین‌ها)\n" +
  "/pausegame — متوقف‌کردن بازی روی همین صحنه (فقط ادمین‌ها)\n" +
  "/continuegame — ادامه‌ی بازی از همین صحنه (فقط ادمین‌ها)\n" +
  "/unlockround — آزادکردن قفل وقتی ساخت صحنه بیشتر از ۲ دقیقه گیر کرده (فقط ادمین‌ها)\n" +
  "/resendscene — فرستادن دوباره‌ی صحنه‌ای که ساخته شد ولی به گروه نرسید (فقط ادمین‌ها)\n" +
  "/rejoin — (ریپلای روی پیام بازیکن) برگردوندن بازیکنی که شخصیتش مرده، با شخصیت جدید (فقط ادمین‌ها)\n" +
  "/buildworld <حال‌وهوا> — (اختیاری) از قبل تم دنیا رو مشخص کن\n" +
  "/combat <شماره> <تعداد> — شروع دستی یه نبرد (فقط ادمین‌ها؛ /combat تنها برای دیدن فهرست)\n" +
  "وقتی بازی در حال اجراست، فقط پیامت رو بنویس — دیالوگ داخل () و اکشن داخل [] باشه\n\n" +
  "— توی چت خصوصی با من —\n" +
  "/sheet — دیدن کامل شخصیت(های) خودت، هر وقت بخوای\n" +
  "/help — همین راهنما";

// شناسه‌ی عددی صاحب بات از secret به اسم OWNER_TG_ID می‌آد (نه از کد)؛ با getOwnerTgId() خونده میشه.
// تنظیمش: npx wrangler secret put OWNER_TG_ID  (اگه تنظیم نباشه، دستورهای صاحب بات خاموش می‌مونن)
export default async function (message, options = {}) {
  const chatId = message.chat.id;
  const from = message.from;
  // تلگرام موقع انتخاب از منو، دستور رو به شکل /cmd@BotName می‌فرسته؛ @BotName رو برمی‌داریم
  const text = (message.text || "")
    .trim()
    .replace(/^(\/[A-Za-z0-9_]+)@\w+/, "$1");

  if (!from) return;

  // ویرایش پیام: فقط وقتی قبول می‌شه که همان پیامِ اقدام ثبت‌شدهٔ این بازیکن در دور فعلی باشه.
  // بقیهٔ ویرایش‌ها (دستورها، چت خصوصی، پیام‌های دور قبل) نادیده گرفته می‌شن.
  if (options.edited) {
    if (
      message.chat.type !== "private" &&
      text &&
      !text.startsWith("/") &&
      (await isEditOfRecordedAction(chatId, from.id, message.message_id))
    ) {
      await handleGroupAction(message, text);
    } else {
      console.log(
        `✏️ ویرایش نادیده گرفته شد: chat ${chatId}, message ${message.message_id}`,
      );
    }
    return;
  }
  // ۱) ثبت یا به‌روزرسانی کاربر در هر پیامی که می‌فرسته
  await db
    .insert(users)
    .values({ tgId: from.id, name: from.first_name, username: from.username })
    .onConflictDoUpdate({
      target: users.tgId,
      set: { name: from.first_name, username: from.username },
    })
    .run();

  // ۰) دستور مخفی صاحب بات: ذخیره‌ی کلید API در دیتابیس (تنها راه ممکن، چون پلتفرم secrets vault نداره)
  if (
    message.chat.type === "private" &&
    from.id === getOwnerTgId() &&
    text.startsWith("/setkey ")
  ) {
    const parts = text.split(" ");
    const provider = parts[1]; // openrouter یا groq
    const value = parts.slice(2).join(" ");

    if (!provider || !value) {
      await api.sendMessage({
        chat_id: chatId,
        text: "فرمت درست: /setkey openrouter sk-or-v1-...",
      });
      return;
    }

    await db
      .insert(settings)
      .values({ key: `${provider}_api_key`, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();

    // پیام حاوی کلید رو از تاریخچه‌ی چت پاک می‌کنیم تا جایی به‌صورت متن باز نمونه
    try {
      await api.deleteMessage({
        chat_id: chatId,
        message_id: message.message_id,
      });
    } catch (e) {
      /* اگه پاک نشد مهم نیست */
    }

    await api.sendMessage({
      chat_id: chatId,
      text: `✅ کلید ${provider} ذخیره شد (و پیامت پاک شد).`,
    });
    return;
  }
  // ۰.۴) ردگیری و debug (V05): فقط صاحب بات و فقط چت خصوصی؛ بقیه چیزی نمی‌بینن
  if (
    message.chat.type === "private" &&
    from.id === getOwnerTgId() &&
    (await handleTraceCommand(chatId, text))
  ) {
    return;
  }
  // ۰.۵) راهنما (همه‌جا کار می‌کنه)
  if (HELP_COMMANDS.includes(text)) {
    await api.sendMessage({ chat_id: chatId, text: HELP_TEXT });
    return;
  }

  // ۰.۶) کارنامه — هر وقت بازیکن بخواد، توی چت خصوصی
  if (message.chat.type === "private" && SHEET_COMMANDS.includes(text)) {
    const myChars = await db
      .select()
      .from(characters)
      .where(
        and(eq(characters.ownerTgId, from.id), eq(characters.status, "ready")),
      )
      .all();

    if (myChars.length === 0) {
      await api.sendMessage({
        chat_id: chatId,
        text: "هنوز شخصیتی نساختی! از توی گروه شروع کن.",
      });
    } else {
      for (const c of myChars) {
        await api.sendMessage({
          chat_id: chatId,
          text: formatCharacterSheet(c),
        });
      }
    }
    return;
  }

  // ۱.۵) پایان بازی — فقط ادمین‌های گروه
  if (message.chat.type !== "private" && END_GAME_COMMANDS.includes(text)) {
    if (!(await isGroupAdmin(chatId, from.id))) {
      await api.sendMessage({
        chat_id: chatId,
        text: "⛔ فقط ادمین‌های گروه می‌تونن بازی رو تموم کنن.",
      });
      return;
    }

    await db
      .update(gameSessions)
      .set({ status: "idle", pendingSuggestions: null, pausedFrom: null })
      .where(eq(gameSessions.chatId, chatId))
      .run();
    await db.delete(combatState).where(eq(combatState.chatId, chatId)).run();
    await db.delete(partyMembers).where(eq(partyMembers.chatId, chatId)).run();

    await api.sendMessage({
      chat_id: chatId,
      text: "🏁 بازی تموم شد. برای یه ماجراجویی جدید /startgame رو بزن.",
    });
    return;
  }

  // ۱.۶) توقف بازی — فقط ادمین‌های گروه
  if (message.chat.type !== "private" && PAUSE_GAME_COMMANDS.includes(text)) {
    if (!(await isGroupAdmin(chatId, from.id))) {
      await api.sendMessage({
        chat_id: chatId,
        text: "⛔ فقط ادمین‌های گروه می‌تونن بازی رو متوقف کنن.",
      });
      return;
    }

    const session = await db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.chatId, chatId))
      .get();
    if (!session || !["in_narrative", "in_combat"].includes(session.status)) {
      await api.sendMessage({
        chat_id: chatId,
        text: "الان بازی‌ای در جریان نیست که متوقف بشه.",
      });
      return;
    }

    await db
      .update(gameSessions)
      .set({ status: "paused", pausedFrom: session.status })
      .where(eq(gameSessions.chatId, chatId))
      .run();
    await api.sendMessage({
      chat_id: chatId,
      text: "⏸ بازی متوقف شد. صحنه همین‌جا می‌مونه. هر وقت آماده بودین، ادمین /continuegame رو بزنه.",
    });
    return;
  }
  // ۱.۶.۵) آزادسازی قفل گیرکردهٔ دور — فقط ادمین‌ها، فقط بعد از ۲ دقیقه
  if (message.chat.type !== "private" && UNLOCK_ROUND_COMMANDS.includes(text)) {
    const result = await unlockRound(chatId, from.id);
    await api.sendMessage({ chat_id: chatId, text: result.text });
    return;
  }
  // ۱.۶.۶) ارسال دوبارهٔ صحنه‌ی ذخیره‌شده‌ی ارسال‌نشده — فقط ادمین‌ها
  if (message.chat.type !== "private" && RESEND_SCENE_COMMANDS.includes(text)) {
    const result = await resendScene(chatId, from.id);
    if (result) await api.sendMessage({ chat_id: chatId, text: result });
    return;
  }
  // ۱.۶.۷) بازگرداندن بازیکن با شخصیت جدید — فقط ادمین‌ها، با ریپلای روی پیام همان بازیکن
  if (message.chat.type !== "private" && REJOIN_COMMANDS.includes(text)) {
    const target = message.reply_to_message?.from;
    const result = await prepareRejoin(chatId, from.id, target);
    if (!result.ok) {
      await api.sendMessage({ chat_id: chatId, text: result.text });
      return;
    }
    await sendCharacterPrompt(chatId, target);
    return;
  }
  // ۱.۷) ادامه‌ی بازی — فقط ادمین‌های گروه
  if (
    message.chat.type !== "private" &&
    CONTINUE_GAME_COMMANDS.includes(text)
  ) {
    if (!(await isGroupAdmin(chatId, from.id))) {
      await api.sendMessage({
        chat_id: chatId,
        text: "⛔ فقط ادمین‌های گروه می‌تونن بازی رو ادامه بدن.",
      });
      return;
    }

    const session = await db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.chatId, chatId))
      .get();
    if (!session || session.status !== "paused") {
      await api.sendMessage({
        chat_id: chatId,
        text: "بازی‌ای متوقف نشده که ادامه پیدا کنه.",
      });
      return;
    }

    await db
      .update(gameSessions)
      .set({ status: session.pausedFrom || "in_narrative", pausedFrom: null })
      .where(eq(gameSessions.chatId, chatId))
      .run();

    // آخرین صحنه‌ی راوی رو دوباره نشون بده تا همه بدونن از کجا ادامه میدن
    const logs = await db
      .select()
      .from(sessionLog)
      .where(eq(sessionLog.chatId, chatId))
      .all();
    const lastScene = [...logs].reverse().find((l) => l.role === "narrator");

    await api.sendMessage({
      chat_id: chatId,
      text:
        "▶️ بازی ادامه پیدا کرد!" +
        (lastScene ? `\n\n📜 آخرین صحنه:\n${lastScene.content}` : ""),
    });
    return;
  }
  // ۲) شروع بازی در گروه — اول می‌پرسیم چند نفر می‌خوان بازی کنن
  if (message.chat.type !== "private" && START_GAME_COMMANDS.includes(text)) {
    // 2.۱) اگه بازی در جریانه، ریست نکن
    const existing = await db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.chatId, chatId))
      .get();

    if (
      existing &&
      ["starting", "in_narrative", "in_combat", "paused", "resolving"].includes(
        existing.status,
      )
    ) {
      await api.sendMessage({
        chat_id: chatId,
        text: "⚠️ یه بازی در جریانه! برای شروع بازی جدید باید اول این یکی تموم بشه.",
      });
      return;
    }

    // 2.۲) بازیکن‌های بازی قبلی رو پاک کن
    await db.delete(partyMembers).where(eq(partyMembers.chatId, chatId)).run();
    // Planها و Eventهای بازی قبلی (وگرنه شناسه‌ی Event دور ۱ با قبلی برخورد می‌کنه)
    await clearEventsForChat(chatId);
    await db
      .insert(gameSessions)
      .values({ chatId, status: "idle" })
      .onConflictDoUpdate({
        target: gameSessions.chatId,
        set: { status: "idle" },
      })
      .run();

    await api.sendMessage({
      chat_id: chatId,
      text: "🎲 یک ماجراجویی جدید در راهه! اول بگو چند نفر می‌خوان بازی کنن:",
      reply_markup: {
        inline_keyboard: [
          [2, 3, 4, 5, 6].map((n) => ({
            text: String(n),
            callback_data: `sp_expected_${n}`,
          })),
        ],
      },
    });
    return;
  }

  // ۳) ورود به چت خصوصی از طریق دیپ‌لینک (چون ربات نمی‌تونه خودش پیشقدم بشه)
  if (message.chat.type === "private" && text.startsWith("/start")) {
    const parts = text.split(" ");
    const payload = parts[1]; // مثلاً create_character_-1001234567890

    if (payload && payload.startsWith("create_character")) {
      const segments = payload.split("_");
      const originChatId =
        segments.length > 2 ? parseInt(segments[2], 10) : null;

      let draft = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.ownerTgId, from.id),
            eq(characters.status, "draft"),
          ),
        )
        .get();

      if (!draft) {
        const inserted = await db
          .insert(characters)
          .values({ ownerTgId: from.id, status: "draft" })
          .returning()
          .get();
        draft = inserted;
      }

      await startCreation(chatId, from.id, draft.id, originChatId);
    } else {
      await api.sendMessage({
        chat_id: chatId,
        text: "سلام! برای شروع بازی، یه گروه بساز، منو بهش اضافه کن، و دستور /startgame رو اونجا بفرست.",
      });
    }
    return;
  }

  // ۴) اگه کاربر وسط فرآیند شخصیت‌سازیه (فقط مرحله‌ی نام، بقیه با دکمه‌ست)
  if (message.chat.type === "private" && !text.startsWith("/")) {
    const handled = await handleTextInput(chatId, from.id, text);
    if (handled) return;
  }

  // ۵) ساخت دستی دنیا (اختیاری، قبل از رسیدن همه به آمادگی)
  const worldPrefix = matchPrefix(text, BUILD_WORLD_PREFIXES);
  if (message.chat.type !== "private" && worldPrefix) {
    const theme = text.slice(worldPrefix.length).trim();
    await api.sendMessage({
      chat_id: chatId,
      text: "🌍 در حال ساختن دنیا... چند لحظه صبر کن.",
    });

    try {
      await buildWorld(chatId, theme);
      await api.sendMessage({
        chat_id: chatId,
        text: "✅ دنیا ساخته و قفل شد! به‌محض این‌که همه آماده بشن، ماجراجویی شروع میشه.",
      });
    } catch (err) {
      await api.sendMessage({
        chat_id: chatId,
        text: "❌ ساخت دنیا با خطا مواجه شد، دوباره امتحان کن.",
      });
    }
    return;
  }

  // ۶) شروع دستی نبرد در گروه (فقط ادمین‌ها): /combat <شماره> <تعداد>
  const combatCmd = COMBAT_COMMANDS.find(
    (c) => text === c || text.startsWith(c + " "),
  );
  if (message.chat.type !== "private" && combatCmd) {
    if (!(await isGroupAdmin(chatId, from.id))) {
      await api.sendMessage({
        chat_id: chatId,
        text: "فقط ادمین‌های گروه می‌تونن نبرد دستی شروع کنن.",
      });
      return;
    }

    const session = await db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.chatId, chatId))
      .get();
    if (session?.status === "in_combat") {
      await api.sendMessage({
        chat_id: chatId,
        text: "یه نبرد از قبل در جریانه.",
      });
      return;
    }

    const location = session?.currentLocationId
      ? await db
          .select()
          .from(locations)
          .where(eq(locations.id, session.currentLocationId))
          .get()
      : null;
    const tier = location?.tier || 1;

    const args = text
      .slice(combatCmd.length)
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (args.length === 0) {
      await api.sendMessage({
        chat_id: chatId,
        text: `برای شروع دستی نبرد: /combat <شماره> <تعداد>\n${monsterMenuText(tier)}`,
      });
      return;
    }

    const entry = monsterByIndex(tier, args[0]);
    if (!entry) {
      await api.sendMessage({
        chat_id: chatId,
        text: "شماره‌ی هیولا نامعتبره. برای دیدن فهرست فقط /combat رو بفرست.",
      });
      return;
    }
    const count = parseInt(args[1] || "1", 10);

    try {
      const result = await beginCombat(chatId, entry, count, tier);
      await api.sendMessage({ chat_id: chatId, text: result.initiativeText });
      await presentCombatResult(chatId, result, null);
    } catch (err) {
      await api.sendMessage({
        chat_id: chatId,
        text: `❌ نتونستم نبرد رو شروع کنم: ${err.message}`,
      });
    }
    return;
  }

  // ۷) روایت آزاد: هر پیام معمولی توی گروه
  if (message.chat.type !== "private" && !text.startsWith("/")) {
    await handleGroupAction(message, text);
  }
}

// پیام معمولی (یا ویرایش‌شده) یک بازیکن در گروه → اگه اقدامه، برای دور فعلی ثبت میشه
async function handleGroupAction(message, text) {
  const chatId = message.chat.id;
  const from = message.from;
  const session = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();

  if (session && session.status === "in_narrative") {
    // اگه دیالوگ () یا اکشن [] داشت، همون خودشه؛ وگرنه فقط برای بازیکن‌های
    // همین بازی با کمک AI و صحنه‌ی فعلی بررسی می‌کنیم که واقعاً اکشنه یا فقط چت معمولیه
    let actionText = text.includes("(") || text.includes("[") ? text : null;

    if (!actionText) {
      const member = await db
        .select()
        .from(partyMembers)
        .where(
          and(eq(partyMembers.chatId, chatId), eq(partyMembers.tgId, from.id)),
        )
        .get();
      if (member?.characterId) {
        actionText = await normalizeFreeText(chatId, text);
      }
    }

    if (actionText) {
      const result = await recordAction(
        chatId,
        from.id,
        "free",
        actionText,
        message.message_id,
      );
      if (result.ok) await updateRoundStatus(chatId);
    }
  }
}
