import { api, db } from "sdk";
import { characters, charCreationSessions, partyMembers } from "schema";
import { eq, and } from "sdk/db";
import {
  ABILITIES,
  ABILITY_FA,
  ABILITY_STANDARD_ARRAY,
  abilityModifier,
  SPECIES,
  CLASSES,
  BACKGROUNDS,
  SKILL_DESC_FA,
  BASE_EQUIPMENT,
  computeToolTags,
} from "lib/core/dndData";
import { fetchSpellOptions } from "lib/api/spellApi";
import { generateNarration } from "lib/ai/aiClient";
import { maybeStartOpening, sendOpeningMessage } from "lib/game/narrator";
import { refreshRoundStatusIfRunning } from "lib/game/rounds";

const SPELLCASTING_CLASSES = ["wizard", "cleric"];

// ---------- نمایش کارنامه (هر وقت بازیکن بخواد، نه فقط لحظه‌ی ساخت) ----------

export function formatCharacterSheet(c) {
  const abilityLines = ABILITIES.map((a) => {
    const mod = abilityModifier(c.abilities[a]);
    return `${ABILITY_FA[a]}: ${c.abilities[a]} (${mod >= 0 ? "+" : ""}${mod})`;
  }).join(" | ");

  const spellLines =
    c.spellsKnown && c.spellsKnown.length
      ? `\n✨ اسپل/کانتریپ‌ها: ${c.spellsKnown.join(", ")}`
      : "";

  return (
    `📜 کارنامه‌ی ${c.name}\n\n` +
    `نژاد: ${SPECIES[c.species]?.name || c.species} | کلاس: ${CLASSES[c.charClass]?.name || c.charClass} | پیش‌زمینه: ${BACKGROUNDS[c.background]?.name || c.background}\n` +
    `سطح: ${c.level}\n\n` +
    `${abilityLines}\n\n` +
    `❤️ HP: ${c.hp}/${c.maxHp} | 🛡️ AC: ${c.ac} | 🎯 مهارت مبارزه: +${c.proficiencyBonus}\n` +
    `🎒 مهارت‌ها: ${(c.skillProficiencies || []).join(", ")}` +
    spellLines +
    `\n⭐ ویژگی ویژه: ${c.feat || "—"}\n` +
    `💰 طلا: ${c.gold} سکه\n` +
    `🎒 تجهیزات: ${(c.equipment || []).join(" / ")}`
  );
}

// ---------- کمک‌تابع‌های داخلی ----------

async function getSession(tgId) {
  return db
    .select()
    .from(charCreationSessions)
    .where(eq(charCreationSessions.tgId, tgId))
    .get();
}

async function saveSession(tgId, step, tempData) {
  await db
    .update(charCreationSessions)
    .set({ step, tempData })
    .where(eq(charCreationSessions.tgId, tgId))
    .run();
}

function buttonsGrid(items, columns = 2) {
  const rows = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}

// نمایش/ویرایش پیام مرحله‌ی فعلی روی همون یک پیام (برای تجربه‌ی تمیزتر)
async function renderStep(chatId, messageId, text, keyboard) {
  const payload = {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: keyboard },
  };
  if (messageId) {
    payload.message_id = messageId;
    return api.editMessageText(payload);
  }
  return api.sendMessage(payload);
}

// ---------- شروع فرآیند ----------

export async function startCreation(
  chatId,
  tgId,
  draftCharacterId,
  originChatId = null,
) {
  await db
    .insert(charCreationSessions)
    .values({
      tgId,
      draftCharacterId,
      originChatId,
      step: "name",
      tempData: {},
    })
    .onConflictDoUpdate({
      target: charCreationSessions.tgId,
      set: { draftCharacterId, originChatId, step: "name", tempData: {} },
    })
    .run();

  await api.sendMessage({
    chat_id: chatId,
    text: "بریم شخصیتت رو بسازیم! 🧙\n\nاول بگو اسم شخصیتت چیه؟",
  });
}

// ---------- ورودی متنی (فقط مرحله‌ی نام) ----------

export async function handleTextInput(chatId, tgId, text) {
  const session = await getSession(tgId);
  if (!session || session.step !== "name") return false; // ربطی به این ماژول نداشت

  await db
    .update(characters)
    .set({ name: text.slice(0, 40) })
    .where(eq(characters.id, session.draftCharacterId))
    .run();

  await saveSession(tgId, "species", {});
  await sendSpeciesStep(chatId);
  return true;
}

async function sendSpeciesStep(chatId) {
  const buttons = Object.entries(SPECIES).map(([key, v]) => [
    { text: v.name, callback_data: `cc_species_${key}` },
  ]);
  await api.sendMessage({
    chat_id: chatId,
    text: `اسمت ثبت شد ✅\n\nحالا نژادت رو انتخاب کن:`,
    reply_markup: { inline_keyboard: buttons },
  });
}

// ---------- روتر اصلی کالبک‌ها ----------

export async function handleCallback(
  chatId,
  tgId,
  messageId,
  data,
  callbackQueryId,
  forceProvider = null,
) {
  const session = await getSession(tgId);
  if (!session) return false; // این کالبک به این ماژول ربطی نداره

  await api.answerCallbackQuery({ callback_query_id: callbackQueryId });

  if (data.startsWith("cc_species_"))
    return onSpecies(
      chatId,
      tgId,
      messageId,
      session,
      data.replace("cc_species_", ""),
    );
  if (data.startsWith("cc_class_"))
    return onClass(
      chatId,
      tgId,
      messageId,
      session,
      data.replace("cc_class_", ""),
    );
  if (data.startsWith("cc_bg_"))
    return onBackground(
      chatId,
      tgId,
      messageId,
      session,
      data.replace("cc_bg_", ""),
    );
  if (data.startsWith("cc_bgbonus_"))
    return onBgBonus(
      chatId,
      tgId,
      messageId,
      session,
      data.replace("cc_bgbonus_", ""),
    );
  if (data.startsWith("cc_amode_"))
    return onAbilityMode(
      chatId,
      tgId,
      messageId,
      session,
      data.replace("cc_amode_", ""),
    );
  if (data === "cc_aauto_confirm")
    return onAbilAutoConfirm(chatId, tgId, messageId, session);
  if (data.startsWith("cc_abil_"))
    return onAbilityValue(
      chatId,
      tgId,
      messageId,
      session,
      parseInt(data.replace("cc_abil_", ""), 10),
    );
  if (data.startsWith("cc_skill_"))
    return onSkillToggle(
      chatId,
      tgId,
      messageId,
      session,
      data.replace("cc_skill_", ""),
      forceProvider,
    );
  if (data.startsWith("cc_spell_"))
    return onSpellToggle(
      chatId,
      tgId,
      messageId,
      session,
      data.replace("cc_spell_", ""),
      forceProvider,
    );
  if (data === "cc_confirm")
    return onConfirm(chatId, tgId, messageId, session, forceProvider);

  return false;
}

// ---------- نژاد → کلاس ----------

async function onSpecies(chatId, tgId, messageId, session, speciesKey) {
  const tempData = { ...session.tempData, speciesKey };
  await saveSession(tgId, "class", tempData);

  const buttons = Object.entries(CLASSES).map(([key, v]) => [
    { text: v.name, callback_data: `cc_class_${key}` },
  ]);
  await renderStep(
    chatId,
    messageId,
    `نژادت: ${SPECIES[speciesKey].name}\n${SPECIES[speciesKey].traits}\n\nحالا کلاست رو انتخاب کن:`,
    buttons,
  );
}

// ---------- کلاس → پیش‌زمینه ----------

async function onClass(chatId, tgId, messageId, session, classKey) {
  const tempData = { ...session.tempData, classKey };
  await saveSession(tgId, "background", tempData);

  const buttons = Object.entries(BACKGROUNDS).map(([key, v]) => [
    { text: v.name, callback_data: `cc_bg_${key}` },
  ]);
  const cls = CLASSES[classKey];
  await renderStep(
    chatId,
    messageId,
    `کلاست: ${cls.name} (Hit Die: d${cls.hitDie})\n\nحالا پیش‌زمینه‌ت (Background) رو انتخاب کن — این روی توانایی‌ها، یک مهارت ویژه (Feat) و مهارت‌هات تاثیر می‌ذاره:`,
    buttons,
  );
}

// ---------- پیش‌زمینه → توزیع بونوس توانایی ----------

async function onBackground(chatId, tgId, messageId, session, bgKey) {
  const tempData = { ...session.tempData, bgKey };
  await saveSession(tgId, "bg_bonus", tempData);

  const bg = BACKGROUNDS[bgKey];
  const [a, b, c] = bg.abilityOptions;
  const buttons = [
    [
      {
        text: `+۲ ${ABILITY_FA[a]} / +۱ ${ABILITY_FA[b]}`,
        callback_data: "cc_bgbonus_a",
      },
    ],
    [
      {
        text: `+۱ ${ABILITY_FA[a]} / +۱ ${ABILITY_FA[b]} / +۱ ${ABILITY_FA[c]}`,
        callback_data: "cc_bgbonus_b",
      },
    ],
  ];
  await renderStep(
    chatId,
    messageId,
    `پیش‌زمینه‌ت: ${bg.name}\nمهارت ویژه: ${bg.feat}\n\nطبق این پیش‌زمینه، یکی از دو حالت افزایش توانایی رو انتخاب کن:`,
    buttons,
  );
}

// ---------- توزیع بونوس → شروع تخصیص Standard Array ----------

async function onBgBonus(chatId, tgId, messageId, session, choice) {
  const bg = BACKGROUNDS[session.tempData.bgKey];
  const [a, b, c] = bg.abilityOptions;
  const bonusMap =
    choice === "a" ? { [a]: 2, [b]: 1 } : { [a]: 1, [b]: 1, [c]: 1 };

  const tempData = { ...session.tempData, bonusMap };
  await saveSession(tgId, "ability_mode", tempData);
  await sendAbilityModeStep(chatId, messageId, tempData);
}

// ---------- انتخاب خودکار یا دستی برای چیدن توانایی‌ها ----------

const AUTO_ABILITY_PRIORITY = {
  fighter: ["STR", "CON", "DEX", "WIS", "CHA", "INT"],
  wizard: ["INT", "CON", "DEX", "WIS", "CHA", "STR"],
  rogue: ["DEX", "CON", "WIS", "CHA", "INT", "STR"],
  cleric: ["WIS", "CON", "STR", "CHA", "DEX", "INT"],
};

function autoAssignAbilities(classKey) {
  const order = AUTO_ABILITY_PRIORITY[classKey] || ABILITIES;
  const sorted = [...ABILITY_STANDARD_ARRAY].sort((x, y) => y - x);
  const baseAbilities = {};
  order.forEach((ability, i) => {
    baseAbilities[ability] = sorted[i];
  });
  return baseAbilities;
}

async function sendAbilityModeStep(chatId, messageId, tempData) {
  const cls = CLASSES[tempData.classKey];
  await renderStep(
    chatId,
    messageId,
    `برای چیدن اعداد توانایی‌ها (${ABILITY_STANDARD_ARRAY.join(", ")}) یکی رو انتخاب کن:`,
    [
      [
        {
          text: `⚡ خودکار (پیشنهادی برای ${cls.name})`,
          callback_data: "cc_amode_auto",
        },
      ],
      [{ text: "✏️ خودم دستی می‌چینم", callback_data: "cc_amode_manual" }],
    ],
  );
}

async function onAbilityMode(chatId, tgId, messageId, session, choice) {
  if (choice === "manual") {
    const tempData = {
      ...session.tempData,
      abilityIndex: 0,
      remainingValues: [...ABILITY_STANDARD_ARRAY],
      baseAbilities: {},
    };
    await saveSession(tgId, "abilities", tempData);
    await sendAbilityStep(chatId, messageId, tempData);
    return;
  }

  // حالت خودکار: بر اساس کلاس بچین و پیش‌نمایش نشون بده
  const baseAbilities = autoAssignAbilities(session.tempData.classKey);
  const tempData = { ...session.tempData, baseAbilities };
  await saveSession(tgId, "ability_auto_preview", tempData);
  await sendAbilityAutoPreview(chatId, messageId, tempData);
}

async function sendAbilityAutoPreview(chatId, messageId, tempData) {
  const finalAbilities = computeFinalAbilities(tempData);
  const lines = ABILITIES.map((a) => {
    const mod = abilityModifier(finalAbilities[a]);
    return `${ABILITY_FA[a]}: ${finalAbilities[a]} (${mod >= 0 ? "+" : ""}${mod})`;
  }).join("\n");

  await renderStep(
    chatId,
    messageId,
    `این توزیع پیشنهادیه (با احتساب بونوس پیش‌زمینه):\n\n${lines}\n\nتأیید می‌کنی یا خودت دستی می‌چینی؟`,
    [
      [{ text: "✅ همینو تأیید کن", callback_data: "cc_aauto_confirm" }],
      [{ text: "✏️ خودم دستی می‌چینم", callback_data: "cc_amode_manual" }],
    ],
  );
}

async function onAbilAutoConfirm(chatId, tgId, messageId, session) {
  const tempData = { ...session.tempData, selectedSkills: [] };
  await saveSession(tgId, "skills", tempData);
  await sendSkillStep(chatId, messageId, tempData);
}

async function sendAbilityStep(chatId, messageId, tempData) {
  const currentAbility = ABILITIES[tempData.abilityIndex];
  const buttons = buttonsGrid(
    tempData.remainingValues.map((v) => ({
      text: String(v),
      callback_data: `cc_abil_${v}`,
    })),
    3,
  );
  await renderStep(
    chatId,
    messageId,
    `چه عددی رو به «${ABILITY_FA[currentAbility]} (${currentAbility})» می‌دی؟\n(اعداد باقی‌مونده از آرایه‌ی استاندارد: ${tempData.remainingValues.join(", ")})`,
    buttons,
  );
}

// ---------- تخصیص یک عدد به یک توانایی ----------

async function onAbilityValue(chatId, tgId, messageId, session, value) {
  const tempData = { ...session.tempData };
  const currentAbility = ABILITIES[tempData.abilityIndex];

  tempData.baseAbilities[currentAbility] = value;
  tempData.remainingValues = tempData.remainingValues.filter(
    (v) => v !== value,
  );
  tempData.abilityIndex += 1;

  if (tempData.abilityIndex < ABILITIES.length) {
    await saveSession(tgId, "abilities", tempData);
    await sendAbilityStep(chatId, messageId, tempData);
    return;
  }

  // همه‌ی توانایی‌ها تخصیص داده شدن → مرحله‌ی مهارت‌ها
  tempData.selectedSkills = [];
  await saveSession(tgId, "skills", tempData);
  await sendSkillStep(chatId, messageId, tempData);
}

// ---------- انتخاب مهارت‌ها ----------

async function sendSkillStep(chatId, messageId, tempData) {
  const cls = CLASSES[tempData.classKey];
  const needed = cls.skillChoices;
  const buttons = buttonsGrid(
    cls.skillList.map((skill) => {
      const picked = tempData.selectedSkills.includes(skill);
      return {
        text: `${picked ? "✅ " : ""}${skill}`,
        callback_data: `cc_skill_${skill}`,
      };
    }),
    2,
  );

  if (tempData.selectedSkills.length === needed) {
    buttons.push([{ text: "➡️ ادامه", callback_data: "cc_skill_done" }]);
  }

  const legend = cls.skillList
    .map((s) => `• ${s}: ${SKILL_DESC_FA[s] || ""}`)
    .join("\n");

  await renderStep(
    chatId,
    messageId,
    `${tempData.selectedSkills.length}/${needed} مهارت انتخاب کن:\n\n${legend}`,
    buttons,
  );
}

async function onSkillToggle(
  chatId,
  tgId,
  messageId,
  session,
  value,
  forceProvider = null,
) {
  const tempData = { ...session.tempData };
  const cls = CLASSES[tempData.classKey];

  if (value === "done") {
    if (SPELLCASTING_CLASSES.includes(tempData.classKey)) {
      await saveSession(tgId, "spells_cantrip", tempData);
      await sendSpellStep(
        chatId,
        tgId,
        messageId,
        tempData,
        0,
        2,
        forceProvider,
      ); // ۲ کانتریپ
    } else {
      await saveSession(tgId, "review", tempData);
      await sendReviewStep(chatId, messageId, tempData);
    }
    return;
  }

  const skill = value;
  if (tempData.selectedSkills.includes(skill)) {
    tempData.selectedSkills = tempData.selectedSkills.filter(
      (s) => s !== skill,
    );
  } else if (tempData.selectedSkills.length < cls.skillChoices) {
    tempData.selectedSkills.push(skill);
  }

  await saveSession(tgId, "skills", tempData);
  await sendSkillStep(chatId, messageId, tempData);
}

// یه فراخوانی AI برای کل لیست (نه یکی‌یکی)، تا هم سریع‌تر باشه هم ارزون‌تر
async function attachPersianDesc(options, forceProvider = null) {
  if (options.length === 0) return options;
  try {
    const raw = await generateNarration(
      "translator",
      [
        {
          role: "user",
          content:
            `برای هر اسپل زیر، یک توضیح فارسی خیلی کوتاه (حداکثر ۸ کلمه) از کاربردش بنویس. ` +
            `خروجی فقط JSON به فرم {"اسم دقیق اسپل": "توضیح فارسی"} باشه:\n` +
            options.map((s) => `- ${s.name}: ${s.desc}`).join("\n"),
        },
      ],
      forceProvider,
      { temperature: 0.3, jsonMode: true },
    );
    const map = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    return options.map((s) => ({ ...s, descFa: map[s.name] || "" }));
  } catch (err) {
    console.warn("⚠️  ترجمه‌ی توضیح اسپل‌ها شکست خورد:", err.message);
    return options.map((s) => ({ ...s, descFa: "" }));
  }
}

async function sendSpellStep(
  chatId,
  tgId,
  messageId,
  tempData,
  level,
  needed,
  forceProvider = null,
) {
  const cacheKey = `spellOptions${level}`;
  if (!tempData[cacheKey]) {
    try {
      const options = await fetchSpellOptions(level, 8);
      tempData[cacheKey] = await attachPersianDesc(options, forceProvider);
    } catch (err) {
      console.warn("⚠️  گرفتن لیست اسپل از Open5e شکست خورد:", err.message);
      tempData[cacheKey] = [];
    }
  }

  const selectedField =
    level === 0 ? "selectedCantrips" : "selectedLevel1Spells";
  if (!tempData[selectedField]) tempData[selectedField] = [];

  const options = tempData[cacheKey];
  if (options.length === 0) {
    // Open5e جواب نداد → این مرحله رو رد می‌کنیم که کاربر گیر نکنه
    if (level === 0) {
      await saveSession(tgId, "spells_level1", tempData);
      await sendSpellStep(
        chatId,
        tgId,
        messageId,
        tempData,
        1,
        2,
        forceProvider,
      );
    } else {
      await saveSession(tgId, "review", tempData);
      await sendReviewStep(chatId, messageId, tempData);
    }
    return;
  }

  const buttons = buttonsGrid(
    options.map((s) => {
      const picked = tempData[selectedField].includes(s.name);
      return {
        text: `${picked ? "✅ " : ""}${s.name}`,
        callback_data: `cc_spell_${level}_${s.name}`,
      };
    }),
    2,
  );

  if (tempData[selectedField].length === needed) {
    buttons.push([
      { text: "➡️ ادامه", callback_data: `cc_spell_${level}_done` },
    ]);
  }

  const label = level === 0 ? "کانتریپ" : "اسپل سطح ۱";
  const legend = options
    .map((s) => `• ${s.name}: ${s.descFa || s.desc}`)
    .join("\n");
  await renderStep(
    chatId,
    messageId,
    `${tempData[selectedField].length}/${needed} ${label} انتخاب کن:\n\n${legend}`,
    buttons,
  );
}

async function onSpellToggle(
  chatId,
  tgId,
  messageId,
  session,
  rest,
  forceProvider = null,
) {
  const tempData = { ...session.tempData };
  const [levelStr, ...nameParts] = rest.split("_");
  const level = parseInt(levelStr, 10);
  const value = nameParts.join("_");
  const selectedField =
    level === 0 ? "selectedCantrips" : "selectedLevel1Spells";
  const needed = 2;

  if (value === "done") {
    if (level === 0) {
      await saveSession(tgId, "spells_level1", tempData);
      await sendSpellStep(
        chatId,
        tgId,
        messageId,
        tempData,
        1,
        2,
        forceProvider,
      );
    } else {
      await saveSession(tgId, "review", tempData);
      await sendReviewStep(chatId, messageId, tempData);
    }
    return;
  }

  if (!tempData[selectedField]) tempData[selectedField] = [];
  if (tempData[selectedField].includes(value)) {
    tempData[selectedField] = tempData[selectedField].filter(
      (s) => s !== value,
    );
  } else if (tempData[selectedField].length < needed) {
    tempData[selectedField].push(value);
  }

  await saveSession(
    tgId,
    level === 0 ? "spells_cantrip" : "spells_level1",
    tempData,
  );
  await sendSpellStep(
    chatId,
    tgId,
    messageId,
    tempData,
    level,
    needed,
    forceProvider,
  );
}

// ---------- مرور نهایی ----------

function computeFinalAbilities(tempData) {
  const result = {};
  for (const a of ABILITIES) {
    result[a] = tempData.baseAbilities[a] + (tempData.bonusMap[a] || 0);
  }
  return result;
}

async function sendReviewStep(chatId, messageId, tempData) {
  const cls = CLASSES[tempData.classKey];
  const species = SPECIES[tempData.speciesKey];
  const bg = BACKGROUNDS[tempData.bgKey];
  const finalAbilities = computeFinalAbilities(tempData);
  const maxHp = cls.hitDie + abilityModifier(finalAbilities.CON);
  const ac = 10 + abilityModifier(finalAbilities.DEX);

  const abilityLines = ABILITIES.map((a) => {
    const mod = abilityModifier(finalAbilities[a]);
    return `${ABILITY_FA[a]}: ${finalAbilities[a]} (${mod >= 0 ? "+" : ""}${mod})`;
  }).join(" | ");

  const spellLines =
    tempData.selectedCantrips || tempData.selectedLevel1Spells
      ? `\nکانتریپ‌ها: ${(tempData.selectedCantrips || []).join(", ") || "—"}\nاسپل‌های سطح ۱: ${(tempData.selectedLevel1Spells || []).join(", ") || "—"}\n`
      : "";

  const summary =
    `📜 مرور شخصیت — قبل از تایید نهایی:\n\n` +
    `نژاد: ${species.name}\nکلاس: ${cls.name}\nپیش‌زمینه: ${bg.name}\n\n` +
    `${abilityLines}\n\n` +
    `HP: ${maxHp} | AC: ${ac}\n` +
    `مهارت‌ها: ${tempData.selectedSkills.join(", ")}\n` +
    spellLines +
    `ویژگی ویژه: ${bg.feat}\n` +
    `طلای شروع: ${bg.gold} سکه\n` +
    `تجهیزات: ${[...cls.startingEquipment, ...bg.equipment, ...BASE_EQUIPMENT].join(" / ")}`;

  await renderStep(chatId, messageId, summary, [
    [{ text: "✅ تایید و شروع ماجراجویی", callback_data: "cc_confirm" }],
  ]);
}

// ---------- تایید نهایی و ذخیره ----------

async function onConfirm(
  chatId,
  tgId,
  messageId,
  session,
  forceProvider = null,
) {
  const tempData = session.tempData;
  const cls = CLASSES[tempData.classKey];
  const bg = BACKGROUNDS[tempData.bgKey];
  const finalAbilities = computeFinalAbilities(tempData);
  const maxHp = cls.hitDie + abilityModifier(finalAbilities.CON);
  const ac = 10 + abilityModifier(finalAbilities.DEX);

  await db
    .update(characters)
    .set({
      species: tempData.speciesKey,
      charClass: tempData.classKey,
      background: tempData.bgKey,
      abilities: finalAbilities,
      hp: maxHp,
      maxHp,
      ac,
      proficiencyBonus: 2,
      skillProficiencies: tempData.selectedSkills,
      spellsKnown: [
        ...(tempData.selectedCantrips || []),
        ...(tempData.selectedLevel1Spells || []),
      ],
      feat: bg.feat,
      equipment: [...cls.startingEquipment, ...bg.equipment, ...BASE_EQUIPMENT],
      toolTags: computeToolTags(tempData.classKey, tempData.bgKey),
      gold: bg.gold,
      status: "ready",
    })
    .where(eq(characters.id, session.draftCharacterId))
    .run();

  await db
    .delete(charCreationSessions)
    .where(eq(charCreationSessions.tgId, tgId))
    .run();

  await api.editMessageText({
    chat_id: chatId,
    message_id: messageId,
    text: "🎉 شخصیتت ساخته شد! برگرد توی گروه — الان اعلامش می‌کنم.",
  });

  // وصل‌کردن این شخصیت به بازیِ گروهی که ازش دعوت شده بود (اگه از دیپ‌لینک اومده باشه)
  if (session.originChatId) {
    // پیام «ساخت شخصیت» توی گروه دیگه لازم نیست
    const member = await db
      .select()
      .from(partyMembers)
      .where(
        and(
          eq(partyMembers.chatId, session.originChatId),
          eq(partyMembers.tgId, tgId),
        ),
      )
      .get();
    if (member?.promptMessageId) {
      await api.deleteMessage({
        chat_id: session.originChatId,
        message_id: member.promptMessageId,
      });
    }
    await db
      .update(partyMembers)
      .set({ characterId: session.draftCharacterId, promptMessageId: null })
      .where(
        and(
          eq(partyMembers.chatId, session.originChatId),
          eq(partyMembers.tgId, tgId),
        ),
      )
      .run();

    await api.sendMessage({
      chat_id: session.originChatId,
      text: `🧝 شخصیت جدید ساخته شد و وارد بازی شد!`,
    });

    const opening = await maybeStartOpening(
      session.originChatId,
      forceProvider,
    );
    if (opening) await sendOpeningMessage(session.originChatId, opening);
    else await refreshRoundStatusIfRunning(session.originChatId);
  }
}
