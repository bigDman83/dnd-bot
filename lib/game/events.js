import { db } from "sdk";
import { eq, and, sql } from "sdk/db";
import {
  eventPlans,
  appliedEvents,
  locations,
  locationLinks,
  worldClock,
  characters,
  creatures,
  sessionLog,
  gameSessions,
  roundMemory,
  traceRing,
  xpLog,
} from "schema";
import { DEGREES } from "lib/core/degrees";
import { readClock, clockFields } from "lib/world/locations";
import { MEMORY_KEEP } from "lib/game/memory"; // ---------- Plan ← روایت ← COMMIT ----------
// اینجا فقط ابزارهای Plan هست: شناسه‌ی Event، اثر انگشت اقدام‌ها، و ذخیره/بارگذاری Plan.
// شکل Plan (json): { decision, checkResults, travel, restPlan }؛ این فایل به محتوای آن کاری ندارد.

// شناسه‌ی یکتای هر Event: chatId:round:type:index
export function makeEventId(chatId, round, type, index = 0) {
  return `${chatId}:${round}:${type}:${index}`;
}

// اثر انگشت اقدام‌های این دور؛ اگه بازیکنی جوابش رو عوض کنه، Plan قدیمی کنار می‌ره
export function actionsFingerprint(state) {
  return [...state.players]
    .sort((a, b) => a.tgId - b.tgId)
    .map((p) => `${p.tgId}|${p.action?.kind || ""}|${p.action?.content || ""}`)
    .join("\n");
}

// درجه‌ها رو فقط با key ذخیره می‌کنیم (min: -Infinity در JSON به null تبدیل میشه)
export function serializeCheckResults(results) {
  return (results || []).map((r) => ({ ...r, degree: r.degree?.key }));
}

export function reviveCheckResults(results) {
  return (results || []).map((r) => ({
    ...r,
    degree: DEGREES.find((d) => d.key === r.degree) || DEGREES[0],
  }));
}

// ردیف Plan این دور (یا null)
export async function loadPlan(chatId, round) {
  const row = await db
    .select()
    .from(eventPlans)
    .where(and(eq(eventPlans.chatId, chatId), eq(eventPlans.round, round)))
    .get();
  return row || null;
}

// آیا این دور قبلاً COMMIT شده؟
export async function isRoundCommitted(chatId, round) {
  const row = await loadPlan(chatId, round);
  return !!row && row.status === "committed";
}

// Plan قابل‌استفاده‌ی دوباره: فقط اگه هنوز COMMIT نشده و اقدام‌ها دقیقاً همونن
export async function getReusablePlan(chatId, round, fingerprint) {
  const row = await loadPlan(chatId, round);
  if (!row || row.status !== "planned") return null;
  if (row.actionsFingerprint !== fingerprint) return null;
  return row;
}

// ذخیره‌ی Plan (ساخت یا جایگزینی Plan قدیمی همین دور)؛ روی دور COMMIT‌شده هرگز
export async function savePlan(chatId, round, plan, fingerprint) {
  const existing = await loadPlan(chatId, round);
  if (existing && existing.status === "committed") {
    throw new Error("Plan این دور قبلاً COMMIT شده");
  }
  const values = {
    plan,
    actionsFingerprint: fingerprint,
    status: "planned",
    narration: null,
    suggestions: null,
    sceneText: null,
    sceneSent: 0,
  };
  if (existing) {
    await db
      .update(eventPlans)
      .set(values)
      .where(and(eq(eventPlans.chatId, chatId), eq(eventPlans.round, round)))
      .run();
  } else {
    await db
      .insert(eventPlans)
      .values({ chatId, round, ...values })
      .run();
  }
}

// ---------- COMMIT: همه‌ی تغییرهای دور توی یک db.batch (اتمی: یا همه اعمال میشن یا هیچ‌کدوم) ----------
//
// ردیف اول appliedEvents (scene) هم قفل رو چک می‌کنه: اگه این اجرا دیگه صاحب قفل نباشه،
// ستون round مقدار NULL می‌گیره و کل batch رد میشه. eventId تکراری هم (کلید اصلی) کل batch رو رد می‌کنه.

// ساعت بعد از دور (مقدار مطلق، چون داخل batch «بخون و جلو ببر» نداریم): سفر + استراحت + زمان عادی.
// فقط می‌خونه و چیزی نمی‌نویسه؛ قبل از روایت صدا زده میشه تا راوی ساعت پایان دور رو بدونه.
// حساب خالص ساعت جهان بعد از یک دور (بدون دیتابیس)؛ clockAfter و /replay هر دو از همین استفاده می‌کنن
export function computeClock(before, travel, restPlan, timeHours = 0) {
  let elapsed = before;
  if (travel?.traveled) {
    elapsed += Math.max(1, Math.round(travel.hours / 6)) * 6;
  }
  let lastLongRestHours = null;
  if (restPlan) {
    if (restPlan.kind === "long") lastLongRestHours = elapsed; // شروع استراحت طولانی
    elapsed += Math.max(0, Math.round(restPlan.hours));
  }
  // زمان عادی دور (timeCost) فقط وقتی جمع میشه که سفر یا استراحت نبوده؛ هرکدوم زمان خودشون رو دارن
  if (!travel?.traveled && !restPlan) elapsed += timeHours;
  return { elapsed, lastLongRestHours, before };
}

export async function clockAfter(chatId, travel, restPlan, timeHours = 0) {
  const { elapsedHours } = await readClock(chatId);
  return computeClock(elapsedHours, travel, restPlan, timeHours);
}
// فهرست Eventهای یک دور (نوع + اندیس)؛ هم commitRound هم trace از همین استفاده می‌کنن
export function eventListFor({ checkResults, travel, restPlan }) {
  const events = [{ type: "scene", index: 0 }];
  checkResults.forEach((_, i) =>
    events.push({ type: "skill_check", index: i }),
  );
  // XP چک مهارت: برای هر چک موفقِ XPدار یک Event (اندیس = اندیس چک)
  checkResults.forEach((r, i) => {
    if (r.xp > 0) events.push({ type: "skill_xp", index: i });
  });
  if (travel?.traveled) events.push({ type: "travel", index: 0 });
  if (restPlan) events.push({ type: "rest", index: 0 });
  return events;
}

export function eventIdsFor(chatId, round, parts) {
  return eventListFor(parts).map((e) =>
    makeEventId(chatId, round, e.type, e.index),
  );
}
export async function commitRound(chatId, round, lockToken, c) {
  const {
    travel,
    restPlan,
    checkResults,
    historyRows,
    narration,
    suggestions,
    sceneText,
    nextRound,
    memory,
    clock, // { elapsed, lastLongRestHours } از clockAfter (قبل از روایت)
  } = c;
  const stmts = [];

  // ۱) Eventها (اولی قفل رو چک می‌کنه)
  const events = eventListFor({ checkResults, travel, restPlan });
  const lockedRound = sql`(SELECT ${round} FROM game_sessions WHERE chat_id = ${chatId} AND status = 'resolving' AND resolving_since = ${lockToken})`;
  stmts.push(
    db.insert(appliedEvents).values(
      events.map((e, i) => ({
        eventId: makeEventId(chatId, round, e.type, e.index),
        chatId,
        round: i === 0 ? lockedRound : round,
        type: e.type,
      })),
    ),
  );

  // ۲) سفر: مکان جدید + لینک (شناسه‌ی مکان جدید با subquery، چون توی batch returning نداریم)
  if (travel?.traveled) {
    const loc = travel.location;
    stmts.push(
      db.insert(locations).values({
        chatId,
        name: loc.name,
        tier: loc.tier,
        theme: loc.theme,
        rules: loc.rules,
        // Planهای قبل از V09 این فیلدها را ندارند ← پیش‌فرض
        hostility: loc.hostility ?? "none",
        environments: loc.environments ?? [],
        population: loc.population ?? null,
      }),
    );
    if (travel.fromLocationId) {
      const newId = sql`(SELECT max(id) FROM locations WHERE chat_id = ${chatId})`;
      stmts.push(
        db.insert(locationLinks).values({
          chatId,
          locationAId: sql`min(${travel.fromLocationId}, ${newId})`,
          locationBId: sql`max(${travel.fromLocationId}, ${newId})`,
          distanceHours: travel.hours,
        }),
      );
    }
  }

  // ۳) ساعت بازی (سفر، استراحت و زمان عادی دور؛ از قبل و قبل از روایت حساب شده)
  let worldHours = null; // ساعت جهان بعد از این دور (برای حافظه‌ی دور)
  if (clock) {
    const { elapsed, lastLongRestHours } = clock;
    worldHours = elapsed;
    const fields = clockFields(elapsed);
    const extra = lastLongRestHours != null ? { lastLongRestHours } : {};
    stmts.push(
      db
        .insert(worldClock)
        .values({ chatId, ...fields, ...extra })
        .onConflictDoUpdate({
          target: worldClock.chatId,
          set: { ...fields, ...extra },
        }),
    );
  }

  // ۴) استراحت: HP و تاس جان هر شخصیت
  if (restPlan) {
    for (const r of restPlan.results) {
      const set = { hp: r.hp, hitDiceSpent: r.hitDiceSpent };
      if (restPlan.kind === "long") {
        set.stable = 0;
        set.deathSaveSuccesses = 0;
        set.deathSaveFailures = 0;
      }
      stmts.push(db.update(characters).set(set).where(eq(characters.id, r.id)));
    }
  }

  // ۵) NPC های تقابل
  for (const r of checkResults) {
    if (!r.creature) continue;
    stmts.push(
      db.insert(creatures).values({
        chatId,
        locationId: r.creature.locationId,
        role: r.creature.role,
        tier: r.creature.tier,
        abilities: r.creature.abilities,
        proficiencyBonus: r.creature.proficiencyBonus,
      }),
    );
  }
  // ۵ب) XP چک مهارت: ستون xp + دفتر xp_log (منبع و دلیل)، همه داخل همین batch اتمی
  checkResults.forEach((r, i) => {
    if (!(r.xp > 0) || !r.characterId) return;
    stmts.push(
      db
        .update(characters)
        .set({ xp: sql`coalesce(xp, 0) + ${r.xp}` })
        .where(eq(characters.id, r.characterId)),
    );
    stmts.push(
      db.insert(xpLog).values({
        chatId,
        round,
        characterId: r.characterId,
        amount: r.xp,
        source: "skill_check",
        reason: r.reason || "چک مهارت",
        eventId: makeEventId(chatId, round, "skill_xp", i),
      }),
    );
  });
  // ۶) تاریخچه
  stmts.push(
    db.insert(sessionLog).values(
      historyRows.map((h) => ({
        chatId,
        role: h.role,
        speakerTgId: h.speakerTgId ?? null,
        content: h.content,
      })),
    ),
  );
  // ۶ب) حافظه‌ی دور (Round Memory): همین‌جا داخل batch، پس چیزی که اعمال نشده ثبت نمیشه؛ فقط ۱۰ دور آخر می‌مونه
  if (memory) {
    if (worldHours == null) worldHours = (await readClock(chatId)).elapsedHours;
    stmts.push(
      db.insert(roundMemory).values({
        chatId,
        round,
        worldHours,
        location: memory.location,
        actions: memory.actions,
        outcomes: memory.outcomes,
        changes: memory.changes,
        knowledgeDelivered: memory.knowledgeDelivered,
        newEntities: memory.newEntities,
      }),
    );
    stmts.push(
      db
        .delete(roundMemory)
        .where(
          and(
            eq(roundMemory.chatId, chatId),
            sql`${roundMemory.round} <= ${round - MEMORY_KEEP}`,
          ),
        ),
    );
  }

  // ۷) متن صحنه‌ی ذخیره‌شده (برای ارسال دوباره) + علامت COMMIT
  stmts.push(
    db
      .update(eventPlans)
      .set({
        status: "committed",
        narration,
        suggestions,
        sceneText,
        sceneSent: 0,
      })
      .where(and(eq(eventPlans.chatId, chatId), eq(eventPlans.round, round))),
  );

  // ۸) رفتن به دور بعد و آزادشدن قفل
  const sessionSet = {
    status: "in_narrative",
    pendingSuggestions: suggestions,
    currentRound: nextRound,
    roundMessageId: null,
    resolvingSince: null,
  };
  if (travel?.traveled) {
    sessionSet.currentLocationId = sql`(SELECT max(id) FROM locations WHERE chat_id = ${chatId})`;
  }
  stmts.push(
    db
      .update(gameSessions)
      .set(sessionSet)
      .where(
        and(
          eq(gameSessions.chatId, chatId),
          eq(gameSessions.status, "resolving"),
        ),
      ),
  );

  await db.batch(stmts);
}

// صحنه‌ی این دور به گروه رسید
export async function markSceneSent(chatId, round) {
  await db
    .update(eventPlans)
    .set({ sceneSent: 1 })
    .where(and(eq(eventPlans.chatId, chatId), eq(eventPlans.round, round)))
    .run();
}

// پاک‌کردن Planها و Eventهای یک گروه (شروع بازی جدید؛ وگرنه eventId دور ۱ با بازی قبلی برخورد می‌کنه)
export async function clearEventsForChat(chatId) {
  await db.delete(eventPlans).where(eq(eventPlans.chatId, chatId)).run();
  await db.delete(appliedEvents).where(eq(appliedEvents.chatId, chatId)).run();
  await db.delete(roundMemory).where(eq(roundMemory.chatId, chatId)).run();
  await db.delete(traceRing).where(eq(traceRing.chatId, chatId)).run();
}
