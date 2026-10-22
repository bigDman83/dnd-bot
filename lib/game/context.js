// ---------- Context Builder: ساخت متن زمینه‌ی راوی بر اساس مخاطب (integration.md بخش 5.1) ----------
// حافظه‌ی دورها (round_memory) + آخرین روایت + کلمات ممنوعه‌ی ضدتکرار رو می‌خونه و با بقیه‌ی زمینه یکی می‌کنه.
// جایگزین getRecentLog (۲۰ خط خام) در مسیر روایت.

import { db } from "sdk";
import { eq, and, sql } from "sdk/db";
import { worldLore, sessionLog, roundMemory } from "schema";
import { clockFields } from "lib/world/locations";
import {
  MEMORY_IN_CONTEXT,
  NARRATIONS_FOR_BANS,
  formatMemory,
  extractBannedWords,
  formatBannedLine,
} from "lib/game/memory";

// اسم فارسی بخش‌روز (تا V04 که بازه‌ها عوض میشن؛ ساعت دقیق توی round_memory ذخیره‌ست و این‌جا فقط نمایش داده میشه)
const TIME_OF_DAY_FA = {
  morning: "صبح",
  afternoon: "ظهر",
  evening: "عصر",
  night: "شب",
};

function whenLabel(worldHours) {
  const c = clockFields(worldHours);
  return `روز ${c.currentDay}، ${TIME_OF_DAY_FA[c.timeOfDay] || c.timeOfDay}`;
}

// چند روایت آخر این بازی (قدیمی‌ترین اول)؛ از session_log، چون روایت بعد از نبرد توی event_plans نیست
export async function getRecentNarrations(chatId, n = NARRATIONS_FOR_BANS) {
  const rows = await db
    .select()
    .from(sessionLog)
    .where(and(eq(sessionLog.chatId, chatId), eq(sessionLog.role, "narrator")))
    .orderBy(sql`${sessionLog.id} DESC`)
    .limit(n)
    .all();
  return rows.reverse().map((r) => r.content);
}

// n ردیف آخر حافظه‌ی دور (قدیمی‌ترین اول)
export async function readRecentMemory(chatId, n = MEMORY_IN_CONTEXT) {
  const rows = await db
    .select()
    .from(roundMemory)
    .where(eq(roundMemory.chatId, chatId))
    .orderBy(sql`${roundMemory.round} DESC`)
    .limit(n)
    .all();
  return rows.reverse();
}

// audience: { kind: "group" } | { kind: "private", ownerId } | { kind: "npc", npcId }
// questText / locationText / npcText / tailText رو فراخواننده می‌ده (چرخه‌ی import نداشته باشیم):
//   tailText = بخش مخصوص همین لحظه (اقدام‌های این دور، یا نتیجه‌ی نبرد)
// خروجی: { text, bannedLine }  ← bannedLine فقط برای راوی لازمه و جدا برمی‌گرده
export async function buildContext({
  chatId,
  audience = { kind: "group" },
  questText = "",
  locationText = "",
  npcText = "",
  tailText = "",
}) {
  if (audience.kind === "npc") {
    // Context مخصوص NPC (دانش ایزوله‌ی خودش) تا V12 پیاده نشده؛ بی‌صدا اشتباه ساختنش خطرناکه
    throw new Error("buildContext(npc) هنوز پیاده نشده (V12)");
  }

  const world = await db
    .select()
    .from(worldLore)
    .where(eq(worldLore.chatId, chatId))
    .get();

  const memoryRows = await readRecentMemory(chatId);
  const { text: memoryText, dmOnlyText } = formatMemory(
    memoryRows,
    audience,
    whenLabel,
  );

  const narrations = await getRecentNarrations(chatId);
  const last = narrations.length ? narrations[narrations.length - 1] : "";

  const parts = [
    `دنیا: ${world ? world.loreText : "(هنوز ساخته نشده)"}`,
    questText,
    locationText,
    npcText,
    memoryText,
    dmOnlyText,
    last
      ? `آخرین روایت (صحنه‌ای که گروه الان توشه؛ برای ادامه‌ی پیوسته، نه برای کپی‌کردن جمله‌ها):\n${last}`
      : "",
    tailText,
  ].filter(Boolean);

  const bannedWords = extractBannedWords(narrations);
  console.log(
    `🧠 Context: ${memoryRows.length} دور حافظه، ${narrations.length} روایت، ${bannedWords.length} کلمه‌ی ممنوعه`,
  );
  return {
    text: parts.join("\n"),
    bannedLine: formatBannedLine(bannedWords),
  };
}
