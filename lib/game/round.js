import { api, db } from "sdk";
import { eq, and } from "sdk/db";
import {
  sessionLog,
  npcs,
  npcCharacterMemory,
  gameSessions,
  eventPlans,
} from "schema";
import { generateNarration } from "lib/ai/aiClient";
import { xpToDiceText } from "lib/core/xp";
import {
  serializeBlocked,
  serializeAutos,
  serializeSkipped,
  summarizeBlocked,
  summarizeSkipped,
  blockedNarratorText,
  blockedToDiceText,
  skippedNarratorText,
  skippedToDiceText,
} from "lib/game/blocked";
import { isGroupAdmin } from "lib/api/telegram";
import { getRoundState, updateRoundStatus, nowSeconds } from "lib/game/rounds";
import {
  decideRound,
  rollChecks,
  checksToNarratorText,
  checksToDiceParts,
  TIME_MENU,
  DEFAULT_TIME_INDEX,
} from "lib/game/resolver";
import { planRest, restNarratorNote, restToDiceText } from "lib/world/rest";
import {
  ensureStartLocation,
  locationContextText,
  planTravel,
  travelNarratorNote,
  timeLine,
  timeNarratorNote,
} from "lib/world/locations";
import { beginCombat, presentCombatResult } from "lib/combat/combat";
import {
  extractJson,
  buildQuestContext,
  sendSceneMessage,
  continueAfterCombat,
} from "lib/game/narrator";
import { buildContext } from "lib/game/context";
import {
  composeScene,
  readNarratorOutput,
  effectiveSceneType,
  sceneTypeNote,
} from "lib/game/blocks";
import { buildMemoryRow } from "lib/game/memory";
import {
  runWithTrace,
  span,
  setOutcome,
  recordError,
  STEPS,
} from "lib/core/trace";
import {
  clockAfter,
  actionsFingerprint,
  serializeCheckResults,
  reviveCheckResults,
  getReusablePlan,
  savePlan,
  commitRound,
  eventIdsFor,
  isRoundCommitted,
  markSceneSent,
} from "lib/game/events";

// خلاصه‌ی فشرده‌ی تصمیم Resolver (فقط شماره و ID؛ بدون متن) برای trace
function summarizeDecision(d) {
  return {
    type: d.combat
      ? "combat"
      : d.checks?.length ||
          d.blocked?.length ||
          d.autos?.length ||
          d.skipped?.length ||
          d.helps?.length
        ? "checks"
        : "narrative",
    checks: (d.checks || []).map((c) => ({
      tgId: c.player?.tgId ?? null,
      skill: c.skill,
      difficulty: c.difficulty ?? null,
      opponentRole: c.opponentRole ?? null,
      actionId: c.actionId ?? null,
      chainStep: c.chain?.step ?? null,
    })),
    blocked: summarizeBlocked(d.blocked),
    skipped: summarizeSkipped(d.skipped),
    autos: (d.autos || []).length,
    helps: (d.helps || []).map((h) => ({
      from: h.helperTgId ?? null,
      to: h.targetTgId ?? null,
      used: !!h.used,
    })),
    moved: !!d.moved,
    distanceIndex: d.distanceIndex ?? null,
    rest: d.rest ?? null,
    timeIndex: d.timeIndex ?? null,
    sceneType: d.sceneType ?? null,
    combat: d.combat
      ? { key: d.combat.entry?.key ?? null, count: d.combat.count ?? null }
      : null,
    problems: d.problems?.length || 0,
  };
}
// span هر تاس: چک ساده (CHECK_ROLLED) یا تقابل با NPC (CHECK_CONTESTED)؛ فقط ID و عدد
function traceChecks(checkResults) {
  for (const r of checkResults) {
    span(
      STEPS.ROLL,
      r.opponentLabel ? "CHECK_CONTESTED" : "CHECK_ROLLED",
      {
        who: r.name,
        skill: r.skill,
        ability: r.ability,
        roll: r.roll,
        mod: r.mod,
        prof: r.profBonus,
        env: r.env ?? null,
        total: r.total,
        dc: r.dc ?? null,
        opponent: r.opponentLabel ?? null,
        margin: r.margin,
        degree: r.degree?.key ?? null,
        mode: r.mode ?? null,
        group: r.groupId ?? null,
        actionId: r.actionId ?? null,
        xp: r.xp ?? 0,
      },
      { ruleSource: "D&D CORE" },
    );
  }
}

// span زنجیره: مرحله‌ی تاس‌شده، مرحله‌ی شکسته‌شده و سقف زنجیره
function traceChains(checkResults, skipped) {
  for (const r of checkResults) {
    if (!r.chain) continue;
    span(
      STEPS.ROLL,
      "CHAIN_STEP_ROLLED",
      {
        actionId: r.actionId ?? null,
        chain: r.chain.id,
        step: r.chain.step,
        of: r.chain.total,
        margin: r.margin,
      },
      { ruleSource: "TARAN RULE" },
    );
  }
  for (const k of skipped) {
    span(
      STEPS.ROLL,
      k.why === "deferred" ? "CHAIN_CAP_REACHED" : "CHAIN_BROKEN_STEP",
      {
        who: k.player?.name ?? null,
        tgId: k.player?.tgId ?? null,
        actionId: k.actionId ?? null,
        chain: k.chainId ?? null,
        step: k.step ?? null,
        why: k.why,
      },
      { ruleSource: "TARAN RULE" },
    );
  }
}

// span اقدام‌های ردشده (Feasibility) و بدون ریسک؛ فقط ID و کد دلیل
function traceFeasibility(decision) {
  for (const b of decision.blocked || []) {
    span(
      STEPS.RESOLVER,
      b.code || null,
      {
        phase: "feasibility",
        who: b.player?.name ?? null,
        tgId: b.player?.tgId ?? null,
        action: b.actionKey,
        outcome: b.outcome,
        kind: b.kind ?? null,
        why: b.outcome === "impossible" ? (b.reason ?? null) : null,
        missingTool: b.missingTool ?? null,
      },
      { ruleSource: "TARAN RULE" },
    );
  }
  for (const h of decision.helps || []) {
    span(
      STEPS.RESOLVER,
      null,
      {
        phase: "help",
        from: h.helperTgId ?? null,
        to: h.targetTgId ?? null,
        used: !!h.used,
      },
      { ruleSource: "D&D CORE" },
    );
  }
  for (const a of decision.autos || []) {
    span(
      STEPS.RESOLVER,
      null,
      {
        phase: "risk_gate",
        who: a.player?.name ?? null,
        tgId: a.player?.tgId ?? null,
        action: a.actionKey,
        outcome: "auto",
      },
      { ruleSource: "TARAN RULE" },
    );
  }
}

// span سفر و استراحت (استراحت با کد دلیل نوع آن)
function traceTravelRest(decision, travel, restPlan) {
  if (decision.moved || travel) {
    span(STEPS.TRAVEL, null, {
      asked: !!decision.moved,
      traveled: !!travel?.traveled,
      hours: travel?.hours ?? null,
      tier: travel?.location?.tier ?? null,
    });
  }
  if (decision.rest) {
    span(
      STEPS.REST,
      restPlan
        ? restPlan.kind === "long"
          ? "REST_LONG_BENEFIT"
          : "REST_SHORT_BENEFIT"
        : null,
      {
        asked: decision.rest,
        kind: restPlan?.kind ?? null,
        downgraded: !!restPlan?.downgraded,
        hours: restPlan?.hours ?? null,
        startHour: restPlan?.startHour ?? null,
        members: restPlan?.results?.length ?? 0,
      },
    );
  }
}
// ---------- پایان یک دور: وقتی همه پاسخ دادن، یک روایت مشترک بساز و دور بعد رو شروع کن ----------
//
// مراحل resolveRound (همه با همین ترتیب):
//   ۱) قفل اتمی دور          ۲) ساخت متن زمینه        ۳) تصمیم Resolver
//   ۴) نبرد؟ → runCombatRound   یا   دور عادی → runNarrativeRound
//   ۵) اگه خطا شد → recoverFromRoundFailure (دور سالم برمی‌گرده)

// ---------- ساخت متن زمینه ----------

function actionLine(p) {
  if (p.action.kind === "skip") {
    return `${p.name}: فقط همراهی می‌کنه و اقدام خاصی نداره.`;
  }
  return `${p.name}: ${p.action.content}`;
}

// ---------- حافظه‌ی ایزوله‌ی NPC ها (فقط برای NPC هایی که در متن اقدام ذکر شدن) ----------

async function buildNpcContext(chatId, characterId, actionText) {
  const allNpcs = await db
    .select()
    .from(npcs)
    .where(eq(npcs.chatId, chatId))
    .all();
  const mentioned = allNpcs.filter((n) => actionText.includes(n.name));
  if (mentioned.length === 0) return "";

  const lines = [];
  for (const npc of mentioned) {
    lines.push(
      `NPC «${npc.name}» (${npc.role || "ناشناس"}): ${npc.publicFacts || ""}`,
    );
    if (characterId) {
      const mem = await db
        .select()
        .from(npcCharacterMemory)
        .where(
          and(
            eq(npcCharacterMemory.npcId, npc.id),
            eq(npcCharacterMemory.characterId, characterId),
          ),
        )
        .get();
      lines.push(
        mem
          ? `  → این NPC این شخصیت رو با نام «${mem.knownAlias || "نامشخص"}» می‌شناسه. سابقه: ${mem.history || "(هیچ سابقه‌ای ثبت نشده)"}`
          : `  → این NPC هیچ سابقه‌ی قبلی‌ای با این شخصیت نداره؛ باید مثل یه غریبه باهاش رفتار کنه.`,
      );
    }
  }
  return lines.join("\n");
}

// متن زمینه‌ی کامل دور (دنیا، کوئست، مکان، NPC ها، تاریخچه، اقدام هر بازیکن) + مکان فعلی
async function buildRoundContext(chatId, state, forceProvider) {
  const questContext = await buildQuestContext(chatId);
  // مکان فعلی (بار اول برای این دنیا ساخته می‌شه؛ اگه AI خطا بده null برمی‌گرده و دور بدون مکان ادامه پیدا می‌کنه)
  const location = await ensureStartLocation(chatId, forceProvider);
  const locationText = locationContextText(location);

  // اطلاعات ایزوله‌ی NPC ها، برای هر بازیکنی که اقدامش اسم یه NPC رو آورده
  const npcParts = [];
  for (const p of state.players) {
    if (p.action.kind === "skip") continue;
    const ctx = await buildNpcContext(chatId, p.characterId, p.action.content);
    if (ctx) npcParts.push(ctx);
  }

  const lines = state.players.map(actionLine);
  // دنیا، حافظه‌ی ۳ دور آخر، آخرین روایت و کلمات ممنوعه رو buildContext می‌چینه (جایگزین getRecentLog)
  const { text, bannedLine } = await buildContext({
    chatId,
    audience: { kind: "group" },
    questText: questContext,
    locationText,
    npcText: npcParts.length
      ? `اطلاعات NPC های ذکرشده در این دور (فقط از همین اطلاعات استفاده کن):\n${npcParts.join("\n")}`
      : "",
    tailText:
      `بازیکن‌های این صحنه: ${state.players.map((p) => p.name).join("، ")}\n` +
      `اقدام هر بازیکن در این دور:\n${lines.join("\n")}`,
  });

  return { contextText: text, bannedLine, location };
}
// ---------- قفل و پیام‌های دور ----------

// قفل اتمی: فقط یک درخواست می‌تونه دور رو ببنده
async function claimRoundLock(chatId) {
  const claimed = await db
    .update(gameSessions)
    .set({ status: "resolving", resolvingSince: nowSeconds() })
    .where(
      and(
        eq(gameSessions.chatId, chatId),
        eq(gameSessions.status, "in_narrative"),
      ),
    )
    .returning()
    .all();
  return claimed.length > 0 ? claimed[0] : null;
}
// آیا این اجرا هنوز صاحب قفله؟ (اگه آزاد شده یا اجرای دیگه‌ای قفل رو گرفته، نه)
async function stillHoldsLock(chatId, state) {
  const s = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
  return (
    !!s && s.status === "resolving" && s.resolvingSince === state.lockToken
  );
}
// ذخیره‌ی اقدام‌های این دور و روایت توی تاریخچه (تاریخچه = «اطلاعات قبلی» دور بعد)
async function logRoundToHistory(chatId, state, narration) {
  for (const p of state.players) {
    await db
      .insert(sessionLog)
      .values({
        chatId,
        role: "player",
        speakerTgId: p.tgId,
        content: actionLine(p),
      })
      .run();
  }
  await db
    .insert(sessionLog)
    .values({ chatId, role: "narrator", content: narration })
    .run();
}
// ردیف‌های تاریخچه‌ی این دور (اقدام‌ها + روایت) برای نوشتن توی COMMIT
function historyRowsFor(state, narration) {
  return [
    ...state.players.map((p) => ({
      role: "player",
      speakerTgId: p.tgId,
      content: actionLine(p),
    })),
    { role: "narrator", speakerTgId: null, content: narration },
  ];
}
// پیام وضعیت دور قبل دیگه لازم نیست
async function deleteRoundStatusMessage(chatId, state) {
  if (state.session.roundMessageId) {
    await api.deleteMessage({
      chat_id: chatId,
      message_id: state.session.roundMessageId,
    });
  }
}

// دکمه‌های پیام صحنه‌ی دور قبل رو بردار
async function removeSceneButtons(chatId, state) {
  if (state.session.sceneMessageId) {
    await api.editMessageReplyMarkup({
      chat_id: chatId,
      message_id: state.session.sceneMessageId,
      reply_markup: { inline_keyboard: [] },
    });
  }
}

// ---------- شاخه‌ی نبرد ----------

// این روایت فقط یه صدای AI جداست و هنوز چیزی از دور رو عوض نمی‌کنه
async function narrateCombatOpening(contextText, reason, forceProvider) {
  let openingText = reason;
  try {
    const raw = await generateNarration(
      "round_narrator",
      [
        {
          role: "user",
          content:
            `${contextText}\n\nدرگیری همین الان شروع می‌شه (${reason}). ` +
            `فقط همین لحظه‌ی شروع رو در یک پاراگراف کوتاه روایت کن، بدون اشاره به نتیجه‌ی نبرد.\n\nصحنه‌ی بعد رو روایت کن.`,
        },
      ],
      forceProvider,
      { temperature: 0.85, jsonMode: true },
    );
    openingText = readNarratorOutput(extractJson(raw)).narration;
  } catch (err) {
    console.warn(
      "⚠️  روایت شروع نبرد شکست خورد، از دلیل خام استفاده شد:",
      err.message,
    );
  }
  return openingText;
}

// این دور نبرده: روایت کوتاه شروع درگیری، بعد شروع واقعی نبرد
async function runCombatRound(
  chatId,
  state,
  decision,
  location,
  contextText,
  forceProvider,
) {
  const openingText = await narrateCombatOpening(
    contextText,
    decision.combat.reason,
    forceProvider,
  );

  if (!(await stillHoldsLock(chatId, state))) {
    console.warn("🔓 قفل این دور آزاد شده بود؛ شروع نبرد انجام نشد");
    return false;
  }
  // اگه شروع نبرد شکست بخوره (مثلاً خطای شبکه)، تا اینجا هیچی از دور عوض نشده
  // و خطا به catch بیرونی می‌ره که دور رو سالم برمی‌گردونه
  const result = await beginCombat(
    chatId,
    decision.combat.entry,
    decision.combat.count,
    location?.tier || 1,
    forceProvider,
  );

  await logRoundToHistory(chatId, state, openingText);

  await db
    .update(gameSessions)
    .set({
      pendingSuggestions: [],
      currentRound: state.round + 1,
      roundMessageId: null,
      resolvingSince: null,
    })
    .where(
      and(
        eq(gameSessions.chatId, chatId),
        eq(gameSessions.status, "in_combat"),
      ),
    )
    .run();

  await deleteRoundStatusMessage(chatId, state);
  await removeSceneButtons(chatId, state);

  await api.sendMessage({ chat_id: chatId, text: openingText });
  await api.sendMessage({ chat_id: chatId, text: result.initiativeText });
  await presentCombatResult(chatId, result, null);
  if (result.outcome === "victory") {
    await continueAfterCombat(chatId, result.finished?.log, forceProvider);
  }
  return true;
}

// ---------- شاخه‌ی دور عادی (چک، سفر، استراحت، روایت) ----------

// روایت مشترک دور + حداکثر ۳ پیشنهاد (فقط رشته‌ها قبول می‌شن)
async function generateRoundNarration(contextText, checksText, forceProvider) {
  const raw = await generateNarration(
    "round_narrator",
    [
      {
        role: "user",
        content: `${contextText}${checksText}\n\nصحنه‌ی بعد رو روایت کن.`,
      },
    ],
    forceProvider,
    { temperature: 0.85, jsonMode: true },
  );
  return readNarratorOutput(extractJson(raw)); // { narration, suggestions, newNames }
}

// PLAN دور عادی: تاس‌ها، پیش‌نویس مکان مقصد و حساب استراحت؛ هیچ‌چیز توی دیتابیس عوض نمیشه
async function buildNarrativePlan(
  chatId,
  decision,
  location,
  contextText,
  forceProvider,
) {
  const skippedOut = []; // مرحله‌های زنجیره که چون مرحله‌ی قبل شکست خورد تاس نشدن
  const checkResults = await rollChecks(decision.checks, location, {
    chatId,
    contextText,
    forceProvider,
    skippedOut,
  });
  const allSkipped = [...(decision.skipped || []), ...skippedOut];
  traceChecks(checkResults);
  traceFeasibility(decision);
  traceChains(checkResults, allSkipped);
  const travel = await planTravel(
    decision,
    contextText,
    location,
    forceProvider,
  );
  const restPlan = decision.rest ? await planRest(chatId, decision.rest) : null;
  traceTravelRest(decision, travel, restPlan);
  const time = TIME_MENU[decision.timeIndex] || TIME_MENU[DEFAULT_TIME_INDEX];
  return {
    checkResults: serializeCheckResults(checkResults),
    blocked: serializeBlocked(decision.blocked), // اقدام‌های ردشده (Feasibility)
    skipped: serializeSkipped(allSkipped), // مرحله‌های انجام‌نشده‌ی زنجیره
    helps: (decision.helps || [])
      .filter((h) => h.used)
      .map((h) => ({ helper: h.helperName, target: h.targetName })), // کمک‌های اثرگذار
    autos: serializeAutos(decision.autos), // اقدام‌های بدون ریسک (بدون تاس)
    travel,
    restPlan,
    time,
    // سفر و استراحت را کد تعیین می‌کند؛ بقیه همان انتخاب Resolver
    sceneType: effectiveSceneType({
      traveled: !!travel?.traveled,
      rested: !!restPlan,
      picked: decision.sceneType,
    }),
    decision: summarizeDecision(decision), // برای /replay و /why
  };
}

async function runNarrativeRound(
  chatId,
  state,
  plan,
  contextText,
  forceProvider,
  { location = null, bannedLine = "" } = {},
) {
  const checkResults = reviveCheckResults(plan.checkResults);
  const { travel, restPlan } = plan;
  const blocked = plan.blocked || []; // Plan قدیمی بدون blocked = خالی
  const skipped = plan.skipped || []; // Plan قدیمی بدون skipped = خالی
  // ساعت پایان دور (فقط خوندن؛ قبل از روایت، تا راوی بازه‌ی روز رو بدونه).
  // Plan قدیمی بدون time = دقایق
  const time = plan.time || TIME_MENU[DEFAULT_TIME_INDEX];
  const sceneType = plan.sceneType || "explore"; // Plan قدیمی بدون sceneType = اکتشاف
  const clock = await clockAfter(chatId, travel, restPlan, time.hours);
  const passedLabel =
    !travel?.traveled && !restPlan && time.hours >= 1 ? time.label : null;
  span(STEPS.CLOCK, null, {
    before: clock.before ?? null,
    after: clock.elapsed,
    timeKey: time.key ?? null,
    timeHours: time.hours,
    traveled: !!travel?.traveled,
    rest: restPlan?.kind ?? null,
  });
  const checksText =
    checksToNarratorText(checkResults) +
    blockedNarratorText(blocked) +
    skippedNarratorText(skipped) +
    travelNarratorNote(travel) +
    restNarratorNote(restPlan) +
    timeNarratorNote(clock.elapsed, passedLabel) +
    sceneTypeNote(sceneType) +
    (bannedLine ? `\n${bannedLine}` : "");

  const { narration, suggestions, newNames } = await generateRoundNarration(
    contextText,
    checksText,
    forceProvider,
  );
  span(STEPS.NARRATION, null, {
    narrationChars: narration.length,
    suggestions: suggestions.length,
    newNames: newNames.length,
    sceneType,
  });
  // ثبت NPC نام‌دار جدید کار V12 است؛ فعلاً فقط لاگ میشه
  if (newNames.length) {
    console.log(
      `🧑 newNames: ${newNames.map((n) => `${n.name}${n.role ? ` (${n.role})` : ""}`).join("، ")}`,
    );
  }
  // اگه ادمین وسط کار قفل رو آزاد کرده، این اجرای کهنه نباید چیزی بنویسه یا صحنه بفرسته
  if (!(await stillHoldsLock(chatId, state))) {
    console.warn(
      "🔓 قفل این دور آزاد شده بود؛ اجرای قدیمی بدون نوشتن چیزی متوقف شد",
    );
    span(STEPS.LOCK_CHECK, null, { held: false, phase: "before_commit" });
    setOutcome("lock_lost");
    return false;
  }
  const nextRound = state.round + 1;
  // پیام صحنه از بلوک‌ها ساخته میشه (V08): خط تاس ساده + جزئیات قابل‌جمع‌شدن، بعد XP و بقیه
  const dice = checksToDiceParts(checkResults);
  const sceneText = composeScene({
    timeLine: timeLine(clock.elapsed),
    narration,
    diceLines: dice.lines,
    diceDetails: dice.details,
    groups: [
      xpToDiceText(checkResults),
      blockedToDiceText(blocked),
      skippedToDiceText(skipped),
      restToDiceText(restPlan),
    ],
  });

  // ردیف حافظه‌ی دور؛ کدمحور از روی همین Plan (ساعت جهان رو خود commitRound پر می‌کنه)
  const memory = buildMemoryRow({
    state,
    checkResults,
    travel,
    restPlan,
    locationBefore: location?.name ?? null,
    blocked,
    skipped,
    autos: plan.autos || [],
    helps: plan.helps || [],
  });

  // COMMIT: همه‌ی تغییرهای دور توی یک batch اتمی (سفر، استراحت، NPC، تاریخچه، حافظه، دور بعد)
  try {
    await commitRound(chatId, state.round, state.lockToken, {
      travel,
      restPlan,
      checkResults,
      historyRows: historyRowsFor(state, narration),
      narration,
      suggestions,
      sceneText,
      nextRound,
      memory,
      clock,
    });
  } catch (err) {
    if (await isRoundCommitted(chatId, state.round)) {
      console.warn(
        `♻️ دور ${state.round} قبلاً COMMIT شده بود؛ چیزی اعمال یا ارسال نشد`,
      );
      span(STEPS.COMMIT, null, { round: state.round, alreadyCommitted: true });
      setOutcome("already_committed");
      return false;
    }
    if (!(await stillHoldsLock(chatId, state))) {
      console.warn(
        "🔓 قفل این دور آزاد شده بود؛ COMMIT رد شد و چیزی نوشته نشد",
      );
      span(STEPS.LOCK_CHECK, null, { held: false, phase: "commit" });
      setOutcome("lock_lost");
      return false;
    }
    throw err; // COMMIT شکست خورده و همه‌چیز برگشته؛ دور سالم برمی‌گرده
  }
  console.log(`✅ دور ${state.round} COMMIT شد`);
  span(
    STEPS.COMMIT,
    "CONSEQ_APPLIED",
    {
      round: state.round,
      nextRound,
      checks: checkResults.length,
      traveled: !!travel?.traveled,
      rested: !!restPlan,
    },
    {
      refs: {
        eventIds: eventIdsFor(chatId, state.round, {
          checkResults,
          travel,
          restPlan,
        }),
      },
    },
  );

  // از اینجا به بعد دور اعمال شده؛ شکست ارسال نباید دور رو خراب کنه
  try {
    await deleteRoundStatusMessage(chatId, state);
    const delivered = await sendSceneMessage(
      chatId,
      sceneText,
      suggestions,
      nextRound,
    );
    span(STEPS.SEND, null, { delivered: !!delivered });
    setOutcome(delivered ? "ok" : "commit_ok_send_failed");
    if (delivered) {
      await markSceneSent(chatId, state.round);
      await removeSceneButtons(chatId, state);
      await updateRoundStatus(chatId);
    } else {
      console.error("📤 دور COMMIT شد ولی تلگرام صحنه رو نپذیرفت");
      await notifySceneUnsent(chatId);
    }
  } catch (err) {
    console.error("📤 دور COMMIT شد ولی ارسال صحنه شکست خورد:", err);
    recordError(STEPS.SEND, err);
    setOutcome("commit_ok_send_failed");
    await notifySceneUnsent(chatId);
  }
  return true;
}

// پیام کوتاه به گروه وقتی صحنه ذخیره شده ولی نرسیده
async function notifySceneUnsent(chatId) {
  try {
    await api.sendMessage({
      chat_id: chatId,
      text: "⚠️ صحنه‌ی بعد ساخته و ذخیره شد ولی ارسالش به گروه شکست خورد. ادمین /resendscene رو بزنه.",
    });
  } catch (err) {
    console.error("📤 پیام هشدار هم ارسال نشد:", err);
  }
}

// دستور /resendscene: صحنه‌ی ذخیره‌شده‌ی ارسال‌نشده‌ی دور قبل رو دوباره می‌فرسته (فقط ادمین‌ها)
export async function resendScene(chatId, tgId) {
  if (!(await isGroupAdmin(chatId, tgId))) {
    return "⛔ فقط ادمین‌های گروه می‌تونن صحنه رو دوباره بفرستن.";
  }
  const session = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
  if (!session) return "اینجا بازی‌ای در جریان نیست.";
  if (session.status !== "in_narrative") {
    return "الان وسط ساخت صحنه، نبرد یا توقف بازی‌ایم؛ بعداً دوباره امتحان کن.";
  }

  // آخرین دورِ COMMIT‌شده‌ای که صحنه‌اش به گروه نرسیده
  const unsent = (
    await db
      .select()
      .from(eventPlans)
      .where(
        and(
          eq(eventPlans.chatId, chatId),
          eq(eventPlans.status, "committed"),
          eq(eventPlans.sceneSent, 0),
        ),
      )
      .all()
  ).sort((a, b) => b.round - a.round)[0];
  // فقط صحنه‌ی دور جاری معتبره (صحنه‌های قدیمی‌تر دیگه دکمه‌شون کار نمی‌کنه)
  if (!unsent || unsent.round + 1 !== session.currentRound) {
    return "صحنه‌ی ارسال‌نشده‌ای برای فرستادن نیست.";
  }

  const delivered = await sendSceneMessage(
    chatId,
    unsent.sceneText,
    unsent.suggestions,
    unsent.round + 1,
  );
  if (!delivered) {
    return "❌ تلگرام این بار هم صحنه رو نپذیرفت. یه کم بعد دوباره امتحان کن.";
  }
  await markSceneSent(chatId, unsent.round);
  await removeSceneButtons(chatId, { session }); // دکمه‌های صحنه‌ی قبلی (session قبل از ارسال خونده شده)
  await updateRoundStatus(chatId);
  return null; // خود صحنه کافیه؛ پیام اضافه لازم نیست
}
// ---------- خطا ----------

// دور رو سالم برگردون تا ادمین دوباره دکمه‌ی تأیید رو بزنه
async function recoverFromRoundFailure(chatId, err) {
  console.error("Round resolve failed:", err);
  await db
    .update(gameSessions)
    .set({ status: "in_narrative", resolvingSince: null })
    .where(
      and(
        eq(gameSessions.chatId, chatId),
        eq(gameSessions.status, "resolving"),
      ),
    )
    .run();
  await updateRoundStatus(chatId); // پیام وضعیت و دکمه‌ی تأیید برگرده
  await api.sendMessage({
    chat_id: chatId,
    text: "❌ ساخت صحنه‌ی بعد با خطا مواجه شد. ادمین دوباره دکمه‌ی تأیید رو بزنه تا دوباره امتحان کنم.",
  });
  return false;
}

// ---------- نقطه‌ی ورود ----------

export async function resolveRound(chatId, forceProvider = null) {
  const state = await getRoundState(chatId);
  if (!state || !state.allAnswered) return false;
  const lock = await claimRoundLock(chatId);
  if (!lock) return false;
  state.lockToken = lock.resolvingSince; // نشانهٔ قفلِ همین اجرا (برای چک بعد از AI)
  if (state.session.roundMessageId) {
    await api.editMessageText({
      chat_id: chatId,
      message_id: state.session.roundMessageId,
      text: "⏳ دارم صحنه‌ی بعد رو می‌سازم...\n(اگه بیشتر از ۲ دقیقه گیر کرد، ادمین بنویسه /unlockround)",
    });
  }
  return await runWithTrace(chatId, state.round, () =>
    runRoundBody(chatId, state, forceProvider),
  );
}

// بدنه‌ی اصلی یک دور؛ داخل trace اجرا میشه (resolveRound بالا قفل رو گرفته)
async function runRoundBody(chatId, state, forceProvider) {
  span(STEPS.LOCK, null, {
    round: state.round,
    players: state.players.length,
  });
  try {
    const { contextText, bannedLine, location } = await buildRoundContext(
      chatId,
      state,
      forceProvider,
    );

    span(STEPS.CONTEXT, null, {
      locationId: location?.id ?? null,
      tier: location?.tier ?? null,
      ctxChars: contextText.length,
      banned: !!bannedLine,
    });

    // اگه از تلاش قبلی همین دور یک Plan ذخیره شده (و اقدام‌ها عوض نشدن)، همون رو برگردون:
    // نه Resolver دوباره صدا زده میشه نه تاس تازه‌ای ریخته میشه
    const fingerprint = actionsFingerprint(state);
    const saved = await getReusablePlan(chatId, state.round, fingerprint);
    if (saved) {
      console.log(`♻️ Plan ذخیره‌شده‌ی دور ${state.round} دوباره استفاده شد`);
      span(STEPS.PLAN_REUSE, null, {
        round: state.round,
        hasDecision: !!saved.plan?.decision,
      });
      return await runNarrativeRound(
        chatId,
        state,
        saved.plan,
        contextText,
        forceProvider,
        { location, bannedLine },
      );
    }

    // تصمیم Resolver (چک لازمه، سفر شده یا نه، نبرد، استراحت)
    const decision = await decideRound(
      contextText,
      state,
      forceProvider,
      location,
    );

    span(STEPS.RESOLVER, null, summarizeDecision(decision));
    if (decision.combat) {
      setOutcome("combat");
      return await runCombatRound(
        chatId,
        state,
        decision,
        location,
        contextText,
        forceProvider,
      );
    }

    const plan = await buildNarrativePlan(
      chatId,
      decision,
      location,
      contextText,
      forceProvider,
    );
    await savePlan(chatId, state.round, plan, fingerprint);
    console.log(`🧩 Plan جدید دور ${state.round} ذخیره شد`);
    return await runNarrativeRound(
      chatId,
      state,
      plan,
      contextText,
      forceProvider,
      { location, bannedLine },
    );
  } catch (err) {
    recordError(STEPS.ERROR, err);
    setOutcome("error");
    return await recoverFromRoundFailure(chatId, err);
  }
}
