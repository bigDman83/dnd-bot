import { db } from "sdk";
import { eq } from "sdk/db";
import { characters, partyMembers, worldClock } from "schema";
import { rollDie } from "lib/core/dice";
import { abilityModifier, CLASSES } from "lib/core/dndData";
import { signedPart } from "lib/core/utils";
import { readClock } from "lib/world/locations";
// ---------- استراحت (طبق 5e) ----------
// استراحت کوتاه ۱ ساعت، استراحت طولانی ۸ ساعت؛ فقط یک استراحت طولانی در هر ۲۴ ساعت بازی
// (از شروع استراحت طولانی قبلی حساب میشه). اگه زود باشه، به استراحت کوتاه تبدیل میشه.

export const SHORT_REST_HOURS = 1;
export const LONG_REST_HOURS = 8;
export const LONG_REST_COOLDOWN_HOURS = 24;

function hitDiceTotal(c) {
  return Math.max(1, c.level || 1);
}

// استراحت کوتاه برای یک شخصیت: تاس جان خودکار خرج میشه تا HP پر بشه یا تاس تموم بشه
export function shortRestFor(c) {
  const spentBefore = c.hitDiceSpent || 0;
  const base = { id: c.id, name: c.name, hp: c.hp, hitDiceSpent: spentBefore };

  if ((c.hp ?? 0) <= 0) {
    return {
      ...base,
      lines: [`⚠️ ${c.name} بی‌هوشه و نمی‌تونه استراحت کنه.`],
    };
  }
  if (c.hp >= c.maxHp) {
    return {
      ...base,
      lines: [`💚 ${c.name} — HP کامل بود (${c.hp}/${c.maxHp})`],
    };
  }

  const die = CLASSES[c.charClass]?.hitDie || 8;
  const total = hitDiceTotal(c);
  const conMod = abilityModifier(c.abilities?.CON ?? 10);
  let hp = c.hp;
  let spent = spentBefore;
  const lines = [];

  while (hp < c.maxHp && spent < total) {
    const roll = rollDie(die);
    const gain = Math.max(1, roll + conMod);
    const before = hp;
    hp = Math.min(c.maxHp, hp + gain);
    spent += 1;
    lines.push(
      `🎲 ${c.name} — تاس جان (d${die}): ${roll}${signedPart("سرسختی", conMod)} = ${gain} ← HP ${before} → ${hp}/${c.maxHp}`,
    );
  }
  if (lines.length === 0) {
    lines.push(`⚠️ ${c.name} — تاس جانی نمونده (HP ${hp}/${c.maxHp})`);
  }
  return { ...base, hp, hitDiceSpent: spent, lines };
}

// استراحت طولانی برای یک شخصیت: HP کامل، همه‌ی تاس جان‌ها برمی‌گردن
export function longRestFor(c) {
  const base = {
    id: c.id,
    name: c.name,
    hp: c.hp,
    hitDiceSpent: c.hitDiceSpent || 0,
  };
  if ((c.hp ?? 0) <= 0) {
    return {
      ...base,
      lines: [`⚠️ ${c.name} بی‌هوشه و نمی‌تونه استراحت کنه.`],
    };
  }
  const line =
    c.hp < c.maxHp
      ? `❤️ ${c.name} — HP ${c.hp} → ${c.maxHp}/${c.maxHp}`
      : `💚 ${c.name} — HP کامل بود (${c.hp}/${c.maxHp})`;
  return { ...base, hp: c.maxHp, hitDiceSpent: 0, lines: [line] };
}

// نوع نهایی استراحت: طولانیِ زودهنگام به کوتاه تبدیل میشه
export function decideRestKind(requested, elapsedHours, lastLongRestHours) {
  if (requested !== "long") {
    return { kind: "short", downgraded: false, hoursSince: null };
  }
  if (lastLongRestHours == null) {
    return { kind: "long", downgraded: false, hoursSince: null };
  }
  const since = elapsedHours - lastLongRestHours;
  if (since >= LONG_REST_COOLDOWN_HOURS) {
    return { kind: "long", downgraded: false, hoursSince: since };
  }
  return { kind: "short", downgraded: true, hoursSince: since };
}

// مرحله‌ی برنامه‌ریزی: هیچ‌چیز توی دیتابیس عوض نمیشه (اگه روایت شکست بخورد و دور دوباره اجرا بشه، دوبار اعمال نمیشه)
export async function planRest(chatId, requested) {
  const members = await db
    .select()
    .from(partyMembers)
    .where(eq(partyMembers.chatId, chatId))
    .all();
  const chars = [];
  for (const m of members) {
    if (!m.characterId) continue;
    const c = await db
      .select()
      .from(characters)
      .where(eq(characters.id, m.characterId))
      .get();
    if (c && !c.dead) chars.push(c);
  }
  if (chars.length === 0) return null;

  const { elapsedHours, lastLongRestHours } = await readClock(chatId);
  const decision = decideRestKind(requested, elapsedHours, lastLongRestHours);
  const results = chars.map((c) =>
    decision.kind === "long" ? longRestFor(c) : shortRestFor(c),
  );
  const hours = decision.kind === "long" ? LONG_REST_HOURS : SHORT_REST_HOURS;

  const lines = [];
  if (decision.downgraded) {
    lines.push(
      `⏳ از شروع استراحت طولانی قبلی فقط ${Math.floor(decision.hoursSince)} ساعت گذشته؛ استراحت طولانی دوباره ممکن نیست، پس فقط یک استراحت کوتاه انجام شد.`,
    );
  }
  lines.push(
    decision.kind === "long"
      ? `🛏️ استراحت طولانی — ${LONG_REST_HOURS} ساعت گذشت.`
      : `🛏️ استراحت کوتاه — ${SHORT_REST_HOURS} ساعت گذشت.`,
  );
  for (const r of results) lines.push(...r.lines);

  return { ...decision, hours, startHour: elapsedHours, results, lines };
}

// خط‌های تضمین‌شده‌ی زیر روایت (مستقل از AI)
export function restToDiceText(plan) {
  return plan ? plan.lines.join("\n") : "";
}

// یادداشت برای راوی (بدون عدد و اصطلاح فنی)
export function restNarratorNote(plan) {
  if (!plan) return "";
  const what =
    plan.kind === "long"
      ? "یک شب کامل استراحت کرد"
      : "کمی نفس تازه کرد و زخم‌هاش رو بست";
  let note = `\n\nگروه در همین دور ${what}؛ روایت باید همین استراحت و حس تازه‌شدن رو نشون بده، بدون اشاره به عدد یا اصطلاح فنی.`;
  if (plan.downgraded) {
    note +=
      " (گروه می‌خواست تا صبح بخوابه ولی هنوز زوده و فقط کمی نفس تازه کرد؛ روایت نباید یک شب کامل خواب رو نشون بده.)";
  }
  return note;
}
