import { api, db } from "sdk";
import { eq, and } from "sdk/db";
import {
  characters,
  partyMembers,
  worldLore,
  sessionLog,
  quests,
  antagonists,
  npcs,
  gameSessions,
  sceneActions,
  locations,
} from "schema";
import { generateNarration } from "lib/ai/aiClient";
import { SPECIES, CLASSES, BACKGROUNDS } from "lib/core/dndData";
import { updateRoundStatus } from "lib/game/rounds";
import {
  locationContextText,
  hasClock,
  readClock,
  buildStartTimeMenuText,
  ensureStartClock,
  timeLabel,
} from "lib/world/locations";
import { buildContext } from "lib/game/context";
export function extractJson(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("پاسخ AI شامل JSON معتبر نبود: " + raw);
  return JSON.parse(match[0]);
}

// ---------- ساخت دنیا (یک‌بار، قبل از شروع بازی) ----------

export async function buildWorld(chatId, theme, forceProvider = null) {
  const raw = await generateNarration(
    "worldbuilder",
    [
      {
        role: "user",
        content:
          `یک دنیای فانتزی D&D بساز با تم: "${theme}". دقیقاً همین فرم JSON رو خروجی بده و هیچ متن اضافه‌ای قبل یا بعدش ننویس:\n` +
          `{"lore": "...", "mainQuestTitle": "...", "mainQuestPlot": "...", "antagonistName": "...", "antagonistMotive": "...", "antagonistPlan": "...", ` +
          `"npcs": [{"name": "...", "role": "...", "publicFacts": "..."}, {"name": "...", "role": "...", "publicFacts": "..."}]}\n` +
          `آرایه‌ی npcs باید دقیقاً ۲ یا ۳ شخصیت غیربازیکن اولیه (متحد، فروشنده، یا منبع اطلاعات) داشته باشه که بازیکن‌ها احتمالاً باهاشون روبه‌رو میشن.`,
      },
    ],
    forceProvider,
    { temperature: 0.4, jsonMode: true },
  );

  const data = extractJson(raw);

  await db
    .insert(worldLore)
    .values({ chatId, loreText: data.lore, locked: true })
    .onConflictDoUpdate({
      target: worldLore.chatId,
      set: { loreText: data.lore, locked: true },
    })
    .run();

  // نکته: فعلاً main quest بلافاصله فعال میشه؛ مکانیزم «افشای تدریجی بعد از چند side quest»
  // که در طراحی اولیه گفته بودیم، هنوز پیاده نشده و باید در یه پالیش بعدی اضافه بشه
  const quest = await db
    .insert(quests)
    .values({
      chatId,
      type: "main",
      title: data.mainQuestTitle,
      fullPlot: data.mainQuestPlot,
      status: "active",
      finalizedAt: Date.now(),
    })
    .returning()
    .get();

  await db
    .insert(antagonists)
    .values({
      chatId,
      name: data.antagonistName,
      motive: data.antagonistMotive,
      escalationPlan: data.antagonistPlan,
      linkedQuestId: quest.id,
    })
    .run();

  for (const npc of data.npcs || []) {
    await db
      .insert(npcs)
      .values({
        chatId,
        name: npc.name,
        role: npc.role,
        publicFacts: npc.publicFacts,
      })
      .run();
  }

  return data;
}

// ---------- کوئست اصلی و آنتاگونیست فعال (اگه هست) ----------

export async function buildQuestContext(chatId) {
  const activeMain = await db
    .select()
    .from(quests)
    .where(
      and(
        eq(quests.chatId, chatId),
        eq(quests.type, "main"),
        eq(quests.status, "active"),
      ),
    )
    .get();
  if (!activeMain) return "";

  let text = `کوئست اصلی فعال (فقط برای هدایت آروم داستان استفاده کن، مستقیم لو نده): ${activeMain.title} — ${activeMain.fullPlot}`;
  const ant = await db
    .select()
    .from(antagonists)
    .where(eq(antagonists.linkedQuestId, activeMain.id))
    .get();
  if (ant)
    text += `\nآنتاگونیست مرتبط (هنوز لزوماً برای بازیکن آشکار نیست): ${ant.name}`;
  return text;
}

// ---------- صحنه‌ی افتتاحیه: بعد از اینکه همه‌ی بازیکن‌های موردانتظار آماده و کاراکترشون مشخص شد ----------

export async function startOpeningScene(chatId, forceProvider = null) {
  const members = await db
    .select()
    .from(partyMembers)
    .where(and(eq(partyMembers.chatId, chatId), eq(partyMembers.isReady, true)))
    .all();

  const charDescs = [];
  const charNames = [];
  for (const m of members) {
    if (!m.characterId) continue;
    const c = await db
      .select()
      .from(characters)
      .where(eq(characters.id, m.characterId))
      .get();
    if (c) {
      charNames.push(c.name);
      charDescs.push(
        `${c.name} (${SPECIES[c.species]?.name || c.species}، ${CLASSES[c.charClass]?.name || c.charClass}، پیش‌زمینه: ${BACKGROUNDS[c.background]?.name || c.background})`,
      );
    }
  }

  const world = await db
    .select()
    .from(worldLore)
    .where(eq(worldLore.chatId, chatId))
    .get();
  // اگه ساعت دنیا از قبل هست (بازی دوم) فقط بازه‌ی فعلی رو می‌گیم؛ وگرنه AI ساعت شروع رو از منو انتخاب می‌کنه
  const clockExists = await hasClock(chatId);
  const timeText = clockExists
    ? `\n\nزمان فعلی دنیا: ${timeLabel((await readClock(chatId)).elapsedHours)}`
    : `\n\n${buildStartTimeMenuText()}`;
  // اگه AI اسم یکی از شخصیت‌ها رو توی متن نیاورد، یک بار دیگه با یادآوری امتحان کن
  let data;
  let extra = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generateNarration(
      "opening_scene",
      [
        {
          role: "user",
          content: `دنیا: ${world ? world.loreText : ""}\n\nشخصیت‌ها:\n${charDescs.join("\n")}${timeText}${extra}`,
        },
      ],
      forceProvider,
      { temperature: 0.8, jsonMode: true },
    );
    data = extractJson(raw);

    const missing = charNames.filter((n) => !data.intro.includes(n));
    if (missing.length === 0) break;
    extra = `\n\nمهم: اسم این شخصیت‌ها باید دقیقاً همین‌طور که نوشته شده توی متن intro بیاد: ${missing.join("، ")}`;
  }
  // ساعت شروع بازی: فقط وقتی هنوز ردیف ساعتی نیست
  if (!clockExists) {
    const start = await ensureStartClock(chatId, data.time);
    console.log(`🕐 ساعت شروع بازی: ${timeLabel(start.elapsed)}`);
  }
  await db
    .insert(sessionLog)
    .values({ chatId, role: "narrator", content: data.intro })
    .run();

  // بازی تازه: پاسخ‌های قدیمی (اگه از بازی قبلی مونده) پاک شن و دور از ۱ شروع بشه
  await db.delete(sceneActions).where(eq(sceneActions.chatId, chatId)).run();

  await db
    .update(gameSessions)
    .set({
      status: "in_narrative",
      pendingSuggestions: data.suggestions,
      currentRound: 1,
      roundMessageId: null,
    })
    .where(eq(gameSessions.chatId, chatId))
    .run();

  return data;
}

// ---------- بررسی مرکزی: آیا وقتشه ماجراجویی رو خودکار شروع کنیم؟ ----------
// از هم بعد از «آماده‌ام» و هم بعد از انتخاب/ساخت شخصیت صدا زده میشه

export async function maybeStartOpening(chatId, forceProvider = null) {
  const session = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
  if (!session || session.status !== "idle") return null; // یا هنوز شروع نشده یا قبلاً شروع شده

  const readyMembers = await db
    .select()
    .from(partyMembers)
    .where(and(eq(partyMembers.chatId, chatId), eq(partyMembers.isReady, true)))
    .all();
  const readyWithChar = readyMembers.filter((m) => m.characterId);

  const expected = session.expectedPlayers || readyMembers.length || 1;
  if (readyWithChar.length === 0 || readyWithChar.length < expected)
    return null;

  // قفل اتمی: از چند درخواست هم‌زمان فقط یکی می‌تونه وضعیت رو از idle به starting ببره
  const claimed = await db
    .update(gameSessions)
    .set({ status: "starting" })
    .where(
      and(eq(gameSessions.chatId, chatId), eq(gameSessions.status, "idle")),
    )
    .returning()
    .all();
  if (claimed.length === 0) return null;

  // پیام «آماده‌ام» رو با پیام «در حال ساخت» عوض کن (چون reply_markup نمی‌دیم، دکمه هم برداشته میشه)
  if (session.lobbyMessageId) {
    await api.editMessageText({
      chat_id: chatId,
      message_id: session.lobbyMessageId,
      text: "⏳ همه آماده‌ان! دارم دنیا و صحنه‌ی افتتاحیه رو می‌سازم... چند لحظه صبر کن.",
    });
  }

  try {
    const world = await db
      .select()
      .from(worldLore)
      .where(eq(worldLore.chatId, chatId))
      .get();
    if (!world) {
      await buildWorld(
        chatId,
        "یک ماجراجویی فانتزی کلاسیک با یک راز غیرمنتظره",
        forceProvider,
      );
    }
    const opening = await startOpeningScene(chatId, forceProvider);

    // پیام «در حال ساخت» رو اینجا پاک نمی‌کنیم؛ بعد از ارسال صحنه توی sendOpeningMessage پاک میشه
    opening.lobbyMessageId = session.lobbyMessageId || null;
    if (session.lobbyMessageId) {
      await db
        .update(gameSessions)
        .set({ lobbyMessageId: null })
        .where(eq(gameSessions.chatId, chatId))
        .run();
    }

    // پیام‌های انتخاب شخصیتِ باقی‌مونده دیگه لازم نیستن
    for (const m of readyMembers) {
      if (m.promptMessageId) {
        await api.deleteMessage({
          chat_id: chatId,
          message_id: m.promptMessageId,
        });
      }
    }
    return opening;
  } catch (err) {
    // اگه AI خطا داد، بازی توی حالت starting گیر نکنه
    console.error("Opening scene failed:", err);
    await db
      .update(gameSessions)
      .set({ status: "idle" })
      .where(eq(gameSessions.chatId, chatId))
      .run();
    if (session.lobbyMessageId) {
      await api.deleteMessage({
        chat_id: chatId,
        message_id: session.lobbyMessageId,
      });
    }
    await api.sendMessage({
      chat_id: chatId,
      text: "❌ ساخت صحنه‌ی افتتاحیه با خطا مواجه شد. ادمین /endgame بزنه و دوباره /startgame (شخصیت‌هات ذخیره‌ان).",
    });
    return null;
  }
}

// ارسال صحنه‌ی افتتاحیه توی گروه + پاک‌کردن پیام «در حال ساخت»
export async function sendOpeningMessage(chatId, opening) {
  const buttons = opening.suggestions.map((s, i) => [
    { text: s, callback_data: `sug_1_${i}` },
  ]);
  buttons.push([{ text: "⏭ رد می‌شم (Skip)", callback_data: "sug_skip_1" }]);

  const sent = await api.sendMessage({
    chat_id: chatId,
    text: `${opening.intro}\n\n📝 یادت باشه: دیالوگ رو داخل () و اکشن رو داخل [] بنویس.\n\nیکی از این‌ها رو انتخاب کن یا خودت بنویس چیکار می‌کنی:`,
    reply_markup: { inline_keyboard: buttons },
  });
  if (sent) {
    await db
      .update(gameSessions)
      .set({ sceneMessageId: sent.message_id })
      .where(eq(gameSessions.chatId, chatId))
      .run();
  }

  if (opening.lobbyMessageId) {
    await api.deleteMessage({
      chat_id: chatId,
      message_id: opening.lobbyMessageId,
    });
  }
  // پیام وضعیت دور اول («⏳ سال، ⏳ بال») زیر صحنه
  await updateRoundStatus(chatId);
}

// ارسال صحنه + ۳ پیشنهاد + Skip برای یک دور
export async function sendSceneMessage(chatId, text, suggestions, round) {
  const buttons = suggestions.map((s, i) => [
    { text: s, callback_data: `sug_${round}_${i}` },
  ]);
  buttons.push([
    { text: "⏭ رد می‌شم (Skip)", callback_data: `sug_skip_${round}` },
  ]);
  const sent = await api.sendMessage({
    chat_id: chatId,
    text: `${text}\n\nیکی از این‌ها رو انتخاب کن یا خودت بنویس چیکار می‌کنی:`,
    reply_markup: { inline_keyboard: buttons },
  });
  if (sent) {
    await db
      .update(gameSessions)
      .set({ sceneMessageId: sent.message_id })
      .where(eq(gameSessions.chatId, chatId))
      .run();
  }
  return !!sent; // false = تلگرام پیام رو نپذیرفت
}

// ---------- ادامه‌ی داستان بعد از پیروزی در نبرد ----------
// فقط از دکمه‌ی حمله (وقتی دشمن آخر می‌افته) صدا زده میشه؛ شکست پارتی نیازی به این نداره چون بازی تمومه

export async function continueAfterCombat(
  chatId,
  combatLog = [],
  forceProvider = null,
) {
  const session = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
  if (!session) return;

  // قفل اتمی، مثل resolveRound
  const claimed = await db
    .update(gameSessions)
    .set({ status: "resolving", resolvingSince: Math.floor(Date.now() / 1000) })
    .where(
      and(
        eq(gameSessions.chatId, chatId),
        eq(gameSessions.status, "in_combat"),
      ),
    )
    .returning()
    .all();
  if (claimed.length === 0) return;

  const questContext = await buildQuestContext(chatId);
  const location = session.currentLocationId
    ? await db
        .select()
        .from(locations)
        .where(eq(locations.id, session.currentLocationId))
        .get()
    : null;
  const locationText = locationContextText(location);
  const logText = combatLog.length
    ? `نتیجه‌ی قطعی نبردی که همین الان تموم شد (این‌ها واقعیت‌های اتفاق‌افتاده‌ن، تغییرشون نده): ${combatLog.join("؛ ")}`
    : "نبرد همین الان تموم شد و گروه پیروز شد.";
  // دنیا، حافظه‌ی ۳ دور آخر، آخرین روایت و کلمات ممنوعه رو buildContext می‌چینه (جایگزین getRecentLog)
  const { text: contextText, bannedLine } = await buildContext({
    chatId,
    audience: { kind: "group" },
    questText: questContext,
    locationText,
    tailText: logText,
  });

  // مثل بقیه‌ی جاهایی که AI ممکنه شکست بخوره: هیچ‌وقت بازی رو گیر نمی‌ندازیم
  let narration = null;
  let suggestions = [];
  for (let attempt = 0; attempt < 2 && !narration; attempt++) {
    try {
      const raw = await generateNarration(
        "round_narrator",
        [
          {
            role: "user",
            content: `${contextText}${bannedLine ? `\n${bannedLine}` : ""}\n\nصحنه‌ی بعد رو روایت کن.`,
          },
        ],
        forceProvider,
        { temperature: 0.85, jsonMode: true },
      );
      const data = extractJson(raw);
      if (typeof data.narration === "string" && data.narration.trim()) {
        narration = data.narration.trim();
        suggestions = Array.isArray(data.suggestions)
          ? data.suggestions.filter((s) => typeof s === "string").slice(0, 3)
          : [];
      }
    } catch (err) {
      console.warn("⚠️  روایت بعد از نبرد شکست خورد:", err.message);
    }
  }
  if (!narration) narration = "گروه نفس‌تازه می‌کند و به اطراف نگاه می‌کند.";

  await db
    .insert(sessionLog)
    .values({ chatId, role: "narrator", content: narration })
    .run();

  const nextRound = (session.currentRound || 1) + 1;
  await db
    .update(gameSessions)
    .set({
      status: "in_narrative",
      pendingSuggestions: suggestions,
      currentRound: nextRound,
      roundMessageId: null,
      resolvingSince: null,
    })
    .where(
      and(
        eq(gameSessions.chatId, chatId),
        eq(gameSessions.status, "resolving"),
      ),
    )
    .run();

  await sendSceneMessage(chatId, narration, suggestions, nextRound);
  await updateRoundStatus(chatId);
}
