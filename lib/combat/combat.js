import { api, db } from "sdk";
import { eq, and, sql } from "sdk/db";
import {
  combatState,
  gameSessions,
  partyMembers,
  characters,
  appliedEvents,
  xpLog,
} from "schema";
import { makeEventId } from "lib/game/events";
import { fetchMonsterByKey } from "lib/api/monsterApi";
import { effectiveGrade } from "lib/combat/monsters";
import { rollD20, rollDice } from "lib/core/dice";
import { abilityModifier, ABILITY_FA, xpToNext } from "lib/core/dndData";
import { signedPart } from "lib/core/utils";
import { generateNarration } from "lib/ai/aiClient";
import { resolveSkillCheck } from "lib/core/skillCheck";

// ---------- حمله‌ی هر کلاس (طبق 5e، سطح ۱) ----------
export const CLASS_ATTACK = {
  fighter: {
    weapon: "شمشیر بلند",
    ability: "STR",
    dice: 1,
    sides: 8,
    addMod: true,
  },
  rogue: {
    weapon: "شمشیر کوتاه",
    ability: "DEX",
    dice: 1,
    sides: 6,
    addMod: true,
  },
  cleric: { weapon: "گرز", ability: "STR", dice: 1, sides: 6, addMod: true },
  wizard: {
    weapon: "پرتاب آتش",
    ability: "INT",
    dice: 1,
    sides: 10,
    addMod: false,
  },
};

// ---------- تاس‌های پایه ----------

function rollAttack({ toHit, ac, advantage = false, disadvantage = false }) {
  let roll = rollD20();
  if (advantage !== disadvantage) {
    const second = rollD20();
    roll = advantage ? Math.max(roll, second) : Math.min(roll, second);
  }
  const crit = roll === 20;
  const hit = crit || (roll !== 1 && roll + toHit >= (ac ?? 10));
  return { roll, total: roll + toHit, hit, crit };
}

// برای دشمن‌ها: فقط جمع نهایی (عدد دقیق دشمن هیچ‌وقت دیده نمیشه)
function rollDamage(count, sides, bonus, crit) {
  const dice = crit ? count * 2 : count;
  return Math.max(0, rollDice(dice, sides) + bonus);
}

// برای بازیکن‌ها: جزئیات کامل (تاس خام + جمع) تا خط تاس آسیب جدا نشون داده بشه
function rollDamageDetailed(count, sides, bonus, crit) {
  const dice = crit ? count * 2 : count;
  const diceSum = rollDice(dice, sides);
  return { dice, sides, diceSum, total: Math.max(0, diceSum + bonus) };
}

// ---------- کلمه‌های وضعیت (عدد دشمن هیچ‌وقت نشون داده نمیشه) ----------

export function healthWord(hp, maxHp) {
  if (hp <= 0) return "از پا افتاده";
  const ratio = hp / maxHp;
  if (ratio > 0.5) return "سالم";
  if (ratio > 0.25) return "زخمی";
  return "نیمه‌جان";
}

function damageWord(damage, maxHp) {
  const ratio = damage / Math.max(1, maxHp);
  if (ratio >= 0.5) return "بسیار سنگین";
  if (ratio >= 0.25) return "سنگین";
  return "سبک";
}

// ---------- تاس نجات مرگ (طبق 5e کامل) ----------

export function rollDeathSave(character) {
  const roll = rollD20();
  let outcome;

  if (roll === 20) {
    character.hp = 1;
    character.stable = false;
    character.dead = false;
    character.deathSaveSuccesses = 0;
    character.deathSaveFailures = 0;
    outcome = "wake";
  } else {
    if (roll === 1) character.deathSaveFailures += 2;
    else if (roll >= 10) character.deathSaveSuccesses += 1;
    else character.deathSaveFailures += 1;

    if (character.deathSaveFailures >= 3) {
      character.dead = true;
      outcome = "death";
    } else if (character.deathSaveSuccesses >= 3) {
      character.stable = true;
      outcome = "stable";
    } else {
      outcome =
        roll === 1 ? "doubleFailure" : roll >= 10 ? "success" : "failure";
    }
  }

  const label = {
    wake: "بیدار شد! (۱ HP)",
    death: `سومین شکست — درگذشت (${character.deathSaveFailures}/۳)`,
    stable: `سومین موفقیت — پایدار شد (${character.deathSaveSuccesses}/۳)`,
    success: `موفقیت (${character.deathSaveSuccesses}/۳)`,
    failure: `شکست (${character.deathSaveFailures}/۳)`,
    doubleFailure: `شکست مضاعف (${character.deathSaveFailures}/۳)`,
  }[outcome];

  const diceLine = `🎲 ${character.name} — تاس نجات مرگ: ${roll} ← ${label}`;

  let text = null;
  if (outcome === "wake")
    text = `${character.name} ناگهان به هوش آمد و از جا بلند شد!`;
  else if (outcome === "death")
    text = `${character.name} آخرین نفس را کشید و از پا افتاد، این‌بار برای همیشه.`;
  else if (outcome === "stable")
    text = `${character.name} بی‌هوش ماند، اما دیگر در خطر مرگ فوری نیست.`;

  return { diceLine, text, outcome };
}

// اثر آسیب روی یک شخصیت بازیکن
function damagePlayer(char, damage, isCrit) {
  const wasConscious = char.hp > 0;
  let died = false;

  if (wasConscious) {
    const overflow = damage - char.hp;
    char.hp = Math.max(0, char.hp - damage);
    if (char.hp === 0) {
      if (overflow >= char.maxHp) {
        char.dead = true;
        died = true;
      } else {
        char.stable = false;
        char.deathSaveSuccesses = 0;
        char.deathSaveFailures = 0;
      }
    }
  } else if (!char.dead) {
    char.stable = false;
    if (damage >= char.maxHp) {
      char.dead = true;
      died = true;
    } else {
      char.deathSaveFailures += isCrit ? 2 : 1;
      if (char.deathSaveFailures >= 3) {
        char.dead = true;
        died = true;
      }
    }
  }

  return { wasConscious, wasDown: !wasConscious, died };
}

// ---------- انتخاب هدف دشمن بر اساس درجه‌ی زیرکی ----------

export function chooseEnemyTarget(grade, targetable) {
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  if (grade >= 3) {
    const minAc = Math.min(...targetable.map((p) => p.ac ?? 10));
    const weakest = targetable.filter((p) => (p.ac ?? 10) === minAc);
    const minHp = Math.min(...weakest.map((p) => p.hp));
    return rand(weakest.filter((p) => p.hp === minHp));
  }
  if (grade === 2) {
    const minHp = Math.min(...targetable.map((p) => p.hp));
    return rand(targetable.filter((p) => p.hp === minHp));
  }
  return rand(targetable);
}

// ---------- ترتیب نوبت ----------

export function findNextTurn(state, players) {
  const n = state.turnOrder.length;
  let idx = state.currentTurnIndex;
  let round = state.round;
  for (let step = 0; step < n; step++) {
    idx += 1;
    if (idx >= n) {
      idx = 0;
      round += 1;
    }
    const t = state.turnOrder[idx];
    const inOrder =
      t.type === "enemy"
        ? state.enemies.some((e) => e.id === t.id && e.hp > 0)
        : !players.get(t.id)?.dead;
    if (inOrder) return { index: idx, round };
  }
  return null;
}
// مزیت از هر منبعی (کمک، پنهان‌شدن) با ثبت منبع تا در خط تاس نشون داده بشه
function addAdvantage(entry, source) {
  const prev = entry.conditions || {};
  entry.conditions = {
    ...prev,
    advantage: true,
    advantageSources: [...new Set([...(prev.advantageSources || []), source])],
  };
}
// جابه‌جایی به نوبت بعدی + پایان خودکار اثر «دفاع» وقتی نوبتِ خودِ همون بازیکن دوباره برسه
function advanceTurn(state, next) {
  state.currentTurnIndex = next.index;
  state.round = next.round;
  const actor = state.turnOrder[next.index];
  if (actor?.type === "player" && actor.conditions?.defending) {
    actor.conditions.defending = false;
  }
}

function alivePlayerList(players) {
  return [...players.values()].filter((c) => c.hp > 0);
}

function targetablePlayerList(players) {
  return [...players.values()].filter((c) => !c.dead);
}

function pushLog(state, line) {
  state.log = [...(state.log || []), line].slice(-20);
}

// ---------- حمله‌ها ----------

export function resolvePlayerAttack(character, target, opts = {}) {
  const atk = CLASS_ATTACK[character.charClass] || CLASS_ATTACK.fighter;
  const mod = abilityModifier(character.abilities?.[atk.ability] ?? 10);
  const prof = character.proficiencyBonus || 2;
  const r = rollAttack({ toHit: mod + prof, ac: target.ac, ...opts });

  let damage = 0;
  let damageLine = null;
  let sneakAttack = false;
  if (r.hit) {
    const dmg = rollDamageDetailed(
      atk.dice,
      atk.sides,
      atk.addMod ? mod : 0,
      r.crit,
    );
    damage = dmg.total;
    damageLine =
      `🎲 ${character.name} — آسیب (${atk.weapon}): ${dmg.dice}d${dmg.sides}(${dmg.diceSum})` +
      `${signedPart(ABILITY_FA[atk.ability], atk.addMod ? mod : 0)} = ${dmg.total}`;

    // Sneak Attack (فقط دزد، فقط با مزیت، یک‌بار در هر نوبت)
    if (character.charClass === "rogue" && opts.advantage) {
      sneakAttack = true;
      const sneak = rollDamageDetailed(r.crit ? 2 : 1, 6, 0, false);
      damage += sneak.total;
      damageLine += ` + ضربه‌ی غافلگیرکننده (دزد): ${sneak.dice}d${sneak.sides}(${sneak.diceSum}) = ${sneak.total}`;
    }
  }
  target.hp = Math.max(0, target.hp - damage);
  const killed = r.hit && target.hp === 0;

  const resultWord = r.crit ? "ضربه‌ی مرگبار" : r.hit ? "ضربه" : "خطا";
  const advantageTag = opts.advantage
    ? ` (با مزیت، به‌خاطر ${opts.advantageReason || "کمک هم‌تیمی"})`
    : "";
  const diceLine =
    `🎲 ${character.name} — حمله (${atk.weapon}): تاس ${r.roll}` +
    `${signedPart(ABILITY_FA[atk.ability], mod)}${prof > 0 ? ` + مهارت ${prof}` : ""} = ${r.total} ← ${resultWord}${advantageTag}`;

  let text;
  if (!r.hit) {
    text = `${character.name} با ${atk.weapon} به ${target.name} حمله کرد ولی خطا رفت.`;
  } else {
    const strike = r.crit ? "ضربه‌ای مرگبار" : "ضربه‌ای";
    text = killed
      ? `${character.name} با ${atk.weapon} به ${target.name} حمله کرد، ${strike} زد و ${target.name} از پا افتاد.`
      : `${character.name} با ${atk.weapon} به ${target.name} حمله کرد، ${strike} زد و ${target.name} حالا ${healthWord(target.hp, target.maxHp)} است.`;
  }
  return {
    kind: "player",
    actor: character.name,
    target: target.name,
    hit: r.hit,
    crit: r.crit,
    killed,
    sneakAttack,
    diceLine,
    damageLine,
    text,
    logLine: killed ? `${character.name} ${target.name} را از پا انداخت` : null,
  };
}

export function resolveEnemyAttack(enemy, targetChar) {
  const list =
    enemy.actions && enemy.actions.length
      ? enemy.actions
      : [
          {
            name: "حمله",
            toHit: 4,
            damageDiceCount: 1,
            damageDieSides: 6,
            damageBonus: 0,
          },
        ];
  const action = list[Math.floor(Math.random() * list.length)];
  const targetWasDown = targetChar.hp === 0 && !targetChar.dead;
  const r = rollAttack({
    toHit: action.toHit,
    ac: targetChar.ac,
    advantage: targetWasDown,
    disadvantage: !!targetChar.conditions?.defending,
  });
  if (targetWasDown && r.hit) r.crit = true;

  let damage = 0;
  let outcome = {
    wasConscious: targetChar.hp > 0,
    wasDown: targetWasDown,
    died: false,
  };
  if (r.hit) {
    damage = rollDamage(
      action.damageDiceCount,
      action.damageDieSides,
      action.damageBonus,
      r.crit,
    );
    outcome = damagePlayer(targetChar, damage, r.crit);
  }

  const wasDefending = !!targetChar.conditions?.defending;
  let text;
  if (!r.hit) {
    text = `${enemy.name} به ${targetChar.name} حمله کرد ولی خطا رفت.`;
  } else if (outcome.died) {
    text = targetWasDown
      ? `${enemy.name} با یک ضربه‌ی نهایی کار ${targetChar.name} را تمام کرد.`
      : `${enemy.name} با یک ضربه‌ی مرگبار ${targetChar.name} را همان‌جا از پا درآورد.`;
  } else if (targetWasDown) {
    text = `${enemy.name} دوباره به ${targetChar.name}ِ بی‌هوش حمله کرد و ضربه‌ای وحشتناک زد.`;
  } else if (targetChar.hp === 0) {
    text = `${enemy.name} به ${targetChar.name} حمله کرد و ضربه‌ای ${damageWord(damage, targetChar.maxHp)} زد؛ ${targetChar.name} بی‌هوش شد.`;
  } else {
    text = `${enemy.name} به ${targetChar.name} حمله کرد و ضربه‌ای ${damageWord(damage, targetChar.maxHp)} زد.`;
  }
  if (wasDefending) {
    text += r.hit
      ? ` (${targetChar.name} در حالت دفاعی بود، ولی این‌بار کافی نبود.)`
      : ` (${targetChar.name} در حالت دفاعی بود و ضربه رو رد کرد.)`;
  }

  return {
    kind: "enemy",
    actor: enemy.name,
    target: targetChar.name,
    targetId: targetChar.id,
    hit: r.hit,
    crit: r.crit,
    died: outcome.died,
    text,
    logLine: outcome.died
      ? `${enemy.name} ${targetChar.name} را کشت`
      : r.hit && !outcome.wasDown && targetChar.hp === 0
        ? `${enemy.name} ${targetChar.name} را بیهوش کرد`
        : null,
  };
}

// فاز خودکار: نوبت دشمن‌ها و نوبت بازیکن‌های بی‌هوش/پایدار رو پشت‌سرهم پردازش می‌کنه
export function runAutoTurns(state, players, events, dirty) {
  for (let guard = 0; guard < 200; guard++) {
    const actor = state.turnOrder[state.currentTurnIndex];
    if (!actor) return "defeat";

    if (actor.type === "player") {
      const c = players.get(actor.id);
      if (c && !c.dead) {
        if (c.hp > 0) return null; // نوبت واقعی، منتظر بازیکن می‌مونیم
        if (!c.stable) {
          const roll = rollDeathSave(c);
          events.push({ kind: "deathsave", actor: c.name, ...roll });
          dirty.add(c.id);
          if (roll.outcome === "death")
            pushLog(state, `${c.name} بر اثر شکست تاس نجات درگذشت`);
          else if (roll.outcome === "wake")
            pushLog(state, `${c.name} خودش رو به هوش آورد`);
        }
      }
    } else {
      const enemy = state.enemies.find((e) => e.id === actor.id && e.hp > 0);
      if (enemy) {
        const targets = targetablePlayerList(players);
        if (targets.length === 0) return "defeat";
        const target = chooseEnemyTarget(enemy.grade || 1, targets);
        const ev = resolveEnemyAttack(enemy, target);
        events.push(ev);
        dirty.add(target.id);
        if (ev.logLine) pushLog(state, ev.logLine);
      }
    }

    if (alivePlayerList(players).length === 0) return "defeat";

    const next = findNextTurn(state, players);
    if (!next) return "defeat";
    advanceTurn(state, next);
  }
  return null;
}

// ---------- نمایش وضعیت نبرد ----------

function playerStatusText(c) {
  if (!c) return "؟";
  if (c.dead) return `${c.name} ✝️`;
  if (c.hp > 0) {
    const shield = c.conditions?.defending ? " 🛡" : "";
    return `${c.name} ${c.hp}/${c.maxHp}${shield}`;
  }
  if (c.stable) return `${c.name} 💤 پایدار`;
  return `${c.name} 💤 (${c.deathSaveSuccesses}✅/${c.deathSaveFailures}❌)`;
}

export function renderCombatText(state, players) {
  const actor = state.turnOrder[state.currentTurnIndex];
  const head = actor
    ? `⚔️ دور ${state.round} — نوبت ${actor.name}`
    : `⚔️ دور ${state.round}`;
  const party = state.turnOrder
    .filter((t) => t.type === "player")
    .map((t) => playerStatusText(players.get(t.id)))
    .join(" | ");
  const foes = state.enemies
    .map((e) =>
      e.hp > 0 ? `${e.name}: ${healthWord(e.hp, e.maxHp)}` : `${e.name}: 💀`,
    )
    .join(" | ");
  const order = state.turnOrder
    .map((t, i) => (i === state.currentTurnIndex ? `▶️ ${t.name}` : t.name))
    .join(" ← ");
  return `${head}\n❤️ ${party}\n👹 ${foes}\n\n🕒 ترتیب: ${order}`;
}

// تاس Initiative بازیکن‌ها قبل از شروع نبرد (فقط بازیکن‌ها با جزئیات؛ دشمن بدون عدد)
function buildInitiativeText(turnOrder) {
  const lines = turnOrder
    .filter((t) => t.type === "player")
    .map(
      (t) =>
        `${t.name}: تاس ${t.initRoll}${signedPart(ABILITY_FA.DEX, t.initMod)} = ${t.initiative}`,
    );
  const order = turnOrder.map((t) => t.name).join(" ← ");
  return `🎲 ترتیب نوبت:\n${lines.join("\n")}\n\nترتیب نهایی: ${order}`;
}

// ---------- روایت: یک صدای AI برای همه‌ی رویدادهای یک لحظه ----------

async function narrateEvents(events, forceProvider) {
  const withText = events.filter((e) => e.text);
  if (withText.length === 0) return null;
  const lines = withText.map((e) => `- ${e.text}`).join("\n");
  try {
    const raw = await generateNarration(
      "combat_narrator",
      [
        {
          role: "user",
          content: `رویدادهای قطعی این لحظه‌ی نبرد، به همین ترتیب:\n${lines}\n\nهمه رو در یک روایت پیوسته بنویس.`,
        },
      ],
      forceProvider,
      { temperature: 0.85 },
    );
    const text = String(raw || "").trim();
    if (text) return text;
  } catch (err) {
    console.warn("⚠️  روایت نبرد شکست خورد، متن ساده استفاده شد:", err.message);
  }
  return withText.map((e) => e.text).join(" ");
}

// ---------- خواندن/ذخیره ----------

async function getState(chatId) {
  return db
    .select()
    .from(combatState)
    .where(eq(combatState.chatId, chatId))
    .get();
}

async function loadPlayers(state) {
  const map = new Map();
  for (const t of state.turnOrder) {
    if (t.type !== "player") continue;
    const c = await db
      .select()
      .from(characters)
      .where(eq(characters.id, t.id))
      .get();
    if (c) {
      map.set(t.id, {
        ...c,
        dead: !!c.dead,
        stable: !!c.stable,
        deathSaveSuccesses: c.deathSaveSuccesses || 0,
        deathSaveFailures: c.deathSaveFailures || 0,
        conditions: t.conditions || {},
      });
    }
  }
  return map;
}

async function persistPlayers(players, dirty) {
  for (const id of dirty) {
    const c = players.get(id);
    if (c)
      await db
        .update(characters)
        .set({
          hp: c.hp,
          dead: c.dead ? 1 : 0,
          stable: c.stable ? 1 : 0,
          deathSaveSuccesses: c.deathSaveSuccesses,
          deathSaveFailures: c.deathSaveFailures,
        })
        .where(eq(characters.id, id))
        .run();
  }
}

export async function getCombatView(chatId) {
  const state = await getState(chatId);
  if (!state) return null;
  return { state, players: await loadPlayers(state) };
}

// ---------- شروع نبرد ----------

export async function startCombat(chatId, entry, count, tier = 1) {
  const template = await fetchMonsterByKey(entry.key);
  const grade = effectiveGrade(entry, tier);

  const enemies = [];
  for (let i = 0; i < count; i++) {
    enemies.push({
      id: `e${i}`,
      name: count > 1 ? `${entry.fa} ${i + 1}` : entry.fa,
      hp: template.maxHp,
      maxHp: template.maxHp,
      ac: template.ac,
      dexMod: template.dexMod,
      pp: template.pp,
      grade,
      xp: entry.xp || 0, // ارزش XP این دشمن؛ موقع پیروزی جمع و بین شرکت‌کننده‌ها تقسیم می‌شود
      actions: template.actions,
    });
  }

  const members = await db
    .select()
    .from(partyMembers)
    .where(eq(partyMembers.chatId, chatId))
    .all();
  const players = new Map();
  const turnOrder = [];
  for (const m of members) {
    if (!m.characterId) continue;
    const c = await db
      .select()
      .from(characters)
      .where(eq(characters.id, m.characterId))
      .get();
    if (!c || c.dead) continue;
    players.set(c.id, c);
    const dexMod = abilityModifier(c.abilities?.DEX ?? 10);
    const alertBonus = /^alert/i.test(c.feat || "")
      ? c.proficiencyBonus || 2
      : 0;
    const initMod = dexMod + alertBonus;
    const initRoll = rollD20();
    turnOrder.push({
      type: "player",
      id: c.id,
      tgId: m.tgId,
      name: c.name,
      initiative: initRoll + initMod,
      initRoll,
      initMod,
      tie: 1,
      conditions: {},
    });
  }
  for (const e of enemies) {
    turnOrder.push({
      type: "enemy",
      id: e.id,
      name: e.name,
      initiative: rollD20() + e.dexMod,
      tie: 0,
    });
  }
  turnOrder.sort((a, b) => b.initiative - a.initiative || b.tie - a.tie);

  const state = {
    chatId,
    round: 1,
    turnOrder,
    currentTurnIndex: -1,
    enemies,
    turnMessageId: null,
    log: [],
  };
  const first = findNextTurn(state, players);
  if (!first) throw new Error("هیچ بازیکن زنده‌ای برای نبرد نیست");
  state.currentTurnIndex = first.index;
  state.round = first.round;

  const values = {
    round: state.round,
    turnOrder,
    currentTurnIndex: state.currentTurnIndex,
    enemies,
    turnMessageId: null,
    log: [],
  };
  await db
    .insert(combatState)
    .values({ chatId, ...values })
    .onConflictDoUpdate({ target: combatState.chatId, set: values })
    .run();
  await db
    .update(gameSessions)
    .set({ status: "in_combat" })
    .where(eq(gameSessions.chatId, chatId))
    .run();

  return { state, players };
}

// ---------- پایان نبرد ----------

export async function finishCombat(chatId, outcome, log = []) {
  // پیروزی: بازیکن‌های بیهوش/پایدار با ۱ HP به هوش میان (تا بتونن استراحت کنن)
  const woke = [];
  if (outcome === "victory") {
    const state = await getState(chatId);
    for (const t of state?.turnOrder || []) {
      if (t.type !== "player") continue;
      const c = await db
        .select()
        .from(characters)
        .where(eq(characters.id, t.id))
        .get();
      if (c && !c.dead && (c.hp ?? 0) <= 0) {
        await db
          .update(characters)
          .set({
            hp: 1,
            stable: 0,
            deathSaveSuccesses: 0,
            deathSaveFailures: 0,
          })
          .where(eq(characters.id, t.id))
          .run();
        woke.push(c.name);
      }
    }
  }

  await db.delete(combatState).where(eq(combatState.chatId, chatId)).run();
  if (outcome === "defeat") {
    await db.delete(partyMembers).where(eq(partyMembers.chatId, chatId)).run();
    await db
      .update(gameSessions)
      .set({ status: "idle", pausedFrom: null })
      .where(eq(gameSessions.chatId, chatId))
      .run();
  }
  // پیروزی: وضعیت عمداً "in_combat" می‌مونه؛ continueAfterCombat با قفل خودش
  // اون رو به in_narrative می‌بره (وگرنه قفل continueAfterCombat هیچ‌وقت گرفته نمی‌شد)
  return { log, woke };
}

// ---------- XP و پیروزی (V06) ----------

const TRIVIAL_XP = 5; // حریفی که XP‌اش کمتر از ۱۰٪ بودجهٔ سطح «کم» (۵۰) باشد بی‌اهمیت است و XP نمی‌دهد

// «گابلین کوچک 2» → «گابلین کوچک»
function baseEnemyName(name) {
  return String(name || "").replace(/\s+\d+$/, "");
}

// شرح کوتاه دشمن‌ها برای دلیل XP: «گابلین کوچک ×3، گرگ»
function summarizeEnemies(enemies) {
  const counts = new Map();
  for (const e of enemies || []) {
    const n = baseEnemyName(e.name);
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join("، ");
}

// حساب خالص XP نبرد (به دیتابیس دست نمی‌زند):
// مجموع XP دشمن‌ها (بی‌اهمیت‌ها صفر) بین شرکت‌کننده‌های زنده مساوی تقسیم می‌شود (کسر دور ریخته می‌شود).
// بیهوش/پایدار سهم کامل می‌گیرد؛ شخصیتی که وسط نبرد مرده (dead) نه سهم می‌گیرد و نه در تقسیم حساب می‌شود.
export function planCombatXp(state, players) {
  let total = 0;
  for (const e of state.enemies || []) {
    const x = Number(e.xp) || 0;
    total += x < TRIVIAL_XP ? 0 : x;
  }

  const participants = (state.turnOrder || []).filter(
    (t) => t.type === "player",
  );
  const living = participants.filter((t) => !players.get(t.id)?.dead);
  const died = participants
    .filter((t) => players.get(t.id)?.dead)
    .map((t) => ({ charId: t.id, tgId: t.tgId, name: t.name }));

  const share = living.length ? Math.floor(total / living.length) : 0;
  const awards = living.map((t) => ({
    charId: t.id,
    tgId: t.tgId,
    name: t.name,
    xp: share,
  }));

  return {
    total,
    share,
    awards,
    died,
    reason: `نبرد با ${summarizeEnemies(state.enemies)}`,
  };
}

// ثبت اتمی پیروزی: Eventها + XP + بیدارشدن بیهوش‌ها + بیرون‌رفتن مرده‌ها + پایان نبرد، همه در یک db.batch.
// ردیف اول applied_events شمارهٔ دور را از یک subquery روی همین نوبتِ نبرد می‌گیرد؛
// اگه یکی زودتر زده باشد (نوبت عوض شده) مقدارش NULL می‌شود و قید NOT NULL کل batch را برمی‌گرداند.
export async function commitVictory(chatId, state, players, turn) {
  const { oldIndex, oldRound } = turn;
  const session = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.chatId, chatId))
    .get();
  const gameRound = session?.currentRound || 1;

  const plan = planCombatXp(state, players);
  const paid = plan.awards.filter((a) => a.xp > 0);

  // بیهوش/پایدارِ زنده با ۱ HP بیدار می‌شود (تا بتواند استراحت کند)
  const wakeIds = [];
  const woke = [];
  for (const t of state.turnOrder || []) {
    if (t.type !== "player") continue;
    const c = players.get(t.id);
    if (c && !c.dead && (c.hp ?? 0) <= 0) {
      wakeIds.push(c.id);
      woke.push(c.name);
    }
  }

  const events = [
    { type: "combat_result", index: 0 },
    ...paid.map((_, i) => ({ type: "xp_award", index: i })),
  ];
  const lockedRound = sql`(SELECT ${gameRound} FROM combat_state WHERE chat_id = ${chatId} AND current_turn_index = ${oldIndex} AND round = ${oldRound})`;

  const stmts = [];
  stmts.push(
    db.insert(appliedEvents).values(
      events.map((e, i) => ({
        eventId: makeEventId(chatId, gameRound, e.type, e.index),
        chatId,
        round: i === 0 ? lockedRound : gameRound,
        type: e.type,
      })),
    ),
  );
  paid.forEach((a, i) => {
    stmts.push(
      db
        .update(characters)
        .set({ xp: sql`coalesce(xp, 0) + ${a.xp}` })
        .where(eq(characters.id, a.charId)),
    );
    // دفتر XP: منبع و دلیل (همان eventId رویداد xp_award)
    stmts.push(
      db.insert(xpLog).values({
        chatId,
        round: gameRound,
        characterId: a.charId,
        amount: a.xp,
        source: "combat",
        reason: plan.reason,
        eventId: makeEventId(chatId, gameRound, "xp_award", i),
      }),
    );
  });
  for (const id of wakeIds) {
    stmts.push(
      db
        .update(characters)
        .set({
          hp: 1,
          stable: 0,
          deathSaveSuccesses: 0,
          deathSaveFailures: 0,
        })
        .where(and(eq(characters.id, id), eq(characters.dead, 0))),
    );
  }
  // شخصیت مرده از بازی بیرون می‌رود (با /rejoin ادمین می‌تواند با شخصیت جدید برگردد)
  for (const d of plan.died) {
    stmts.push(
      db
        .delete(partyMembers)
        .where(
          and(
            eq(partyMembers.chatId, chatId),
            eq(partyMembers.characterId, d.charId),
          ),
        ),
    );
  }
  stmts.push(db.delete(combatState).where(eq(combatState.chatId, chatId)));

  try {
    await db.batch(stmts);
  } catch (err) {
    const msg = `${err?.message || ""} ${err?.cause?.message || ""}`;
    if (/constraint|NOT NULL|UNIQUE/i.test(msg)) {
      return { ok: false, reason: "stale" };
    }
    throw err;
  }

  console.log(
    `🏆 پیروزی ثبت شد: دور ${gameRound} | XP کل ${plan.total} | سهم هر نفر ${plan.share} | ${paid.length} نفر | مرده: ${plan.died.length}`,
  );
  // راوی بعد از نبرد باید بداند همه‌ی دشمن‌ها شکست خورده‌اند (وگرنه ممکنه دوباره زنده‌شون کنه)
  const defeatedNames = [...new Set((state.enemies || []).map((e) => e.name))];
  const defeatedLine = defeatedNames.length
    ? `نتیجه‌ی نهایی: همه‌ی دشمن‌ها (${defeatedNames.join("، ")}) شکست خوردند و نبرد کاملاً تمام شد`
    : "نتیجه‌ی نهایی: همه‌ی دشمن‌ها شکست خوردند و نبرد کاملاً تمام شد";
  return {
    ok: true,
    finished: {
      log: [...(state.log || []), defeatedLine],
      woke,
      xp: plan,
      removed: plan.died,
    },
  };
}

// ---------- شروع کامل ----------

export async function beginCombat(
  chatId,
  entry,
  count,
  tier = 1,
  forceProvider = null,
) {
  const { state, players } = await startCombat(chatId, entry, count, tier);
  const initiativeText = buildInitiativeText(state.turnOrder);

  const events = [];
  const dirty = new Set();

  const outcome = runAutoTurns(state, players, events, dirty);
  if (events.length > 0) {
    await persistPlayers(players, dirty);
    await db
      .update(combatState)
      .set({
        turnOrder: state.turnOrder,
        log: state.log,
        currentTurnIndex: state.currentTurnIndex,
        round: state.round,
      })
      .where(eq(combatState.chatId, chatId))
      .run();
  }

  const diceLines = events.filter((e) => e.diceLine).map((e) => e.diceLine);
  const narration = await narrateEvents(events, forceProvider);
  let finished = null;
  if (outcome) finished = await finishCombat(chatId, outcome, state.log);
  return {
    diceLines,
    narration,
    outcome,
    finished,
    state,
    players,
    initiativeText,
  };
}

// ---------- حمله‌ی بازیکن ----------

export async function takePlayerAttack(
  chatId,
  tgId,
  targetId,
  forceProvider = null,
) {
  const state = await getState(chatId);
  if (!state) return { ok: false, reason: "no_combat" };

  const actorEntry = state.turnOrder[state.currentTurnIndex];
  if (!actorEntry || actorEntry.type !== "player" || actorEntry.tgId !== tgId)
    return { ok: false, reason: "not_your_turn" };

  const players = await loadPlayers(state);
  const me = players.get(actorEntry.id);
  if (!me || me.hp <= 0) return { ok: false, reason: "down" };

  const target = state.enemies.find((e) => e.id === targetId && e.hp > 0);
  if (!target) return { ok: false, reason: "bad_target" };

  const oldIndex = state.currentTurnIndex;
  const oldRound = state.round;
  const events = [];
  const dirty = new Set();

  const hadAdvantage = !!actorEntry.conditions?.advantage;
  const advantageReason =
    (actorEntry.conditions?.advantageSources || []).join(" و ") || "کمک";
  const mine = resolvePlayerAttack(me, target, {
    advantage: hadAdvantage,
    advantageReason,
  });
  if (hadAdvantage) {
    // مصرف شد، چه بخوره چه نخوره
    actorEntry.conditions.advantage = false;
    actorEntry.conditions.advantageSources = [];
  }
  events.push(mine);
  if (mine.logLine) pushLog(state, mine.logLine);

  let outcome = null;
  if (state.enemies.every((e) => e.hp === 0)) {
    // پیروزی: XP، بیدارشدن، بیرون‌رفتن مرده‌ها و پایان نبرد همه در یک batch اتمی
    // (جای claim جدا + finishCombat). اگه یکی زودتر زده باشد stale برمی‌گردد.
    const victory = await commitVictory(chatId, state, players, {
      oldIndex,
      oldRound,
    });
    if (!victory.ok) return { ok: false, reason: "stale" };

    const diceLines = [mine.diceLine];
    if (mine.damageLine) diceLines.push(mine.damageLine);
    const narration = await narrateEvents(events, forceProvider);
    return {
      ok: true,
      diceLines,
      narration,
      outcome: "victory",
      finished: victory.finished,
      state,
      players,
    };
  } else {
    const next = findNextTurn(state, players);
    advanceTurn(state, next);
    outcome = runAutoTurns(state, players, events, dirty);
  }

  const claimed = await db
    .update(combatState)
    .set({
      turnOrder: state.turnOrder,
      enemies: state.enemies,
      log: state.log,
      currentTurnIndex: state.currentTurnIndex,
      round: state.round,
    })
    .where(
      and(
        eq(combatState.chatId, chatId),
        eq(combatState.currentTurnIndex, oldIndex),
        eq(combatState.round, oldRound),
      ),
    )
    .returning()
    .all();
  if (claimed.length === 0) return { ok: false, reason: "stale" };

  await persistPlayers(players, dirty);

  const diceLines = [mine.diceLine];
  if (mine.damageLine) diceLines.push(mine.damageLine);
  for (const e of events.slice(1)) if (e.diceLine) diceLines.push(e.diceLine);

  const narration = await narrateEvents(events, forceProvider);
  let finished = null;
  if (outcome) finished = await finishCombat(chatId, outcome, state.log);

  return { ok: true, diceLines, narration, outcome, finished, state, players };
}

// ---------- دفاع (Dodge) ----------
// تا نوبت بعدیِ خودش، حمله‌های دشمن به او ضعف دارن

export async function takePlayerDefend(chatId, tgId, forceProvider = null) {
  const state = await getState(chatId);
  if (!state) return { ok: false, reason: "no_combat" };

  const actorEntry = state.turnOrder[state.currentTurnIndex];
  if (!actorEntry || actorEntry.type !== "player" || actorEntry.tgId !== tgId)
    return { ok: false, reason: "not_your_turn" };

  const players = await loadPlayers(state);
  const me = players.get(actorEntry.id);
  if (!me || me.hp <= 0) return { ok: false, reason: "down" };

  const oldIndex = state.currentTurnIndex;
  const oldRound = state.round;
  actorEntry.conditions = { ...(actorEntry.conditions || {}), defending: true };

  const events = [
    {
      kind: "defend",
      actor: me.name,
      announceLine: `🛡 ${me.name} حالت دفاعی گرفت — تا نوبت بعدیِ خودش، حمله‌های دشمن به او ضعف دارن.`,
      text: `${me.name} حالت دفاعی می‌گیرد و مراقب ضربه‌های بعدی می‌ماند.`,
    },
  ];
  const dirty = new Set();

  const next = findNextTurn(state, players);
  advanceTurn(state, next);
  const outcome = runAutoTurns(state, players, events, dirty);

  const claimed = await db
    .update(combatState)
    .set({
      turnOrder: state.turnOrder,
      enemies: state.enemies,
      log: state.log,
      currentTurnIndex: state.currentTurnIndex,
      round: state.round,
    })
    .where(
      and(
        eq(combatState.chatId, chatId),
        eq(combatState.currentTurnIndex, oldIndex),
        eq(combatState.round, oldRound),
      ),
    )
    .returning()
    .all();
  if (claimed.length === 0) return { ok: false, reason: "stale" };

  await persistPlayers(players, dirty);
  const diceLines = events.flatMap((e) =>
    [e.diceLine, e.announceLine].filter(Boolean),
  );
  const narration = await narrateEvents(events, forceProvider);
  let finished = null;
  if (outcome) finished = await finishCombat(chatId, outcome, state.log);

  return { ok: true, diceLines, narration, outcome, finished, state, players };
}

// ---------- کمک (Help) ----------
// حمله‌ی بعدیِ یک هم‌تیمیِ هوشیار مزیت می‌گیره

export async function takePlayerHelp(
  chatId,
  tgId,
  targetCharId,
  forceProvider = null,
) {
  const state = await getState(chatId);
  if (!state) return { ok: false, reason: "no_combat" };

  const actorEntry = state.turnOrder[state.currentTurnIndex];
  if (!actorEntry || actorEntry.type !== "player" || actorEntry.tgId !== tgId)
    return { ok: false, reason: "not_your_turn" };

  const players = await loadPlayers(state);
  const me = players.get(actorEntry.id);
  if (!me || me.hp <= 0) return { ok: false, reason: "down" };

  const targetEntry = state.turnOrder.find(
    (t) => t.type === "player" && t.id === Number(targetCharId),
  );
  const targetChar = targetEntry && players.get(targetEntry.id);
  if (
    !targetEntry ||
    !targetChar ||
    targetChar.hp <= 0 ||
    targetEntry.id === actorEntry.id
  )
    return { ok: false, reason: "bad_target" };

  const oldIndex = state.currentTurnIndex;
  const oldRound = state.round;
  addAdvantage(targetEntry, "کمک");

  const events = [
    {
      kind: "help",
      actor: me.name,
      announceLine: `🤝 ${me.name} به ${targetChar.name} کمک کرد — حمله‌ی بعدی ${targetChar.name} مزیت می‌گیره.`,
      text: `${me.name} به ${targetChar.name} کمک می‌کند؛ حمله‌ی بعدی او آسان‌تر خواهد بود.`,
    },
  ];
  const dirty = new Set();

  const next = findNextTurn(state, players);
  advanceTurn(state, next);
  const outcome = runAutoTurns(state, players, events, dirty);

  const claimed = await db
    .update(combatState)
    .set({
      turnOrder: state.turnOrder,
      enemies: state.enemies,
      log: state.log,
      currentTurnIndex: state.currentTurnIndex,
      round: state.round,
    })
    .where(
      and(
        eq(combatState.chatId, chatId),
        eq(combatState.currentTurnIndex, oldIndex),
        eq(combatState.round, oldRound),
      ),
    )
    .returning()
    .all();
  if (claimed.length === 0) return { ok: false, reason: "stale" };

  await persistPlayers(players, dirty);
  const diceLines = events.flatMap((e) =>
    [e.diceLine, e.announceLine].filter(Boolean),
  );
  const narration = await narrateEvents(events, forceProvider);
  let finished = null;
  if (outcome) finished = await finishCombat(chatId, outcome, state.log);

  return { ok: true, diceLines, narration, outcome, finished, state, players };
}

// ---------- پنهان‌شدن (Hide) ----------
// چک مخفی‌کاری با سختی ثابت ۱۵، مقایسه‌شده با بالاترین ادراک غیرفعال دشمن‌های زنده.
// موفقیت = حمله‌ی بعدیِ خودش مزیت می‌گیره (+ ضربه‌ی غافلگیرکننده اگه دزد باشه)

const HIDE_DC = 15;

export async function takePlayerHide(chatId, tgId, forceProvider = null) {
  const state = await getState(chatId);
  if (!state) return { ok: false, reason: "no_combat" };

  const actorEntry = state.turnOrder[state.currentTurnIndex];
  if (!actorEntry || actorEntry.type !== "player" || actorEntry.tgId !== tgId)
    return { ok: false, reason: "not_your_turn" };

  const players = await loadPlayers(state);
  const me = players.get(actorEntry.id);
  if (!me || me.hp <= 0) return { ok: false, reason: "down" };

  const oldIndex = state.currentTurnIndex;
  const oldRound = state.round;

  const check = resolveSkillCheck(me, "Stealth", HIDE_DC);
  const aliveEnemies = state.enemies.filter((e) => e.hp > 0);
  const highestPp = aliveEnemies.length
    ? Math.max(...aliveEnemies.map((e) => e.pp ?? 10))
    : 0;
  const succeeded = check.success && check.total > highestPp;

  const diceLine =
    `🎲 ${me.name} — مخفی‌کاری: تاس ${check.roll}` +
    `${signedPart(ABILITY_FA.DEX, check.mod)}${check.profBonus > 0 ? ` + مهارت ${check.profBonus}` : ""} = ${check.total} ← ${succeeded ? "موفق" : "ناموفق"}`;

  if (succeeded) addAdvantage(actorEntry, "پنهان‌شدن");

  const events = [
    {
      kind: "hide",
      actor: me.name,
      diceLine,
      announceLine: succeeded
        ? `🫥 ${me.name} موفق شد در سایه پنهان بشه — حمله‌ی بعدیش مزیت داره.`
        : `🫥 ${me.name} سعی کرد پنهان بشه ولی موفق نشد.`,
      text: succeeded
        ? `${me.name} بی‌صدا در سایه‌ها ناپدید می‌شود.`
        : `${me.name} سعی می‌کند پنهان شود، اما به‌راحتی دیده می‌شود.`,
    },
  ];
  const dirty = new Set();

  const next = findNextTurn(state, players);
  advanceTurn(state, next);
  const outcome = runAutoTurns(state, players, events, dirty);

  const claimed = await db
    .update(combatState)
    .set({
      turnOrder: state.turnOrder,
      enemies: state.enemies,
      log: state.log,
      currentTurnIndex: state.currentTurnIndex,
      round: state.round,
    })
    .where(
      and(
        eq(combatState.chatId, chatId),
        eq(combatState.currentTurnIndex, oldIndex),
        eq(combatState.round, oldRound),
      ),
    )
    .returning()
    .all();
  if (claimed.length === 0) return { ok: false, reason: "stale" };

  await persistPlayers(players, dirty);
  const diceLines = events.flatMap((e) =>
    [e.diceLine, e.announceLine].filter(Boolean),
  );
  const narration = await narrateEvents(events, forceProvider);
  let finished = null;
  if (outcome) finished = await finishCombat(chatId, outcome, state.log);

  return { ok: true, diceLines, narration, outcome, finished, state, players };
}

// ---------- پیام نوبت در گروه (تلگرام) ----------

function buildTurnKeyboard(state, players) {
  const actor = state.turnOrder[state.currentTurnIndex];
  if (!actor || actor.type !== "player") return { inline_keyboard: [] };

  const rows = state.enemies
    .filter((e) => e.hp > 0)
    .map((e) => [
      { text: `⚔️ حمله به ${e.name}`, callback_data: `cmb_atk_${e.id}` },
    ]);

  rows.push([{ text: "🛡 دفاع", callback_data: "cmb_def" }]);
  rows.push([{ text: "🫥 پنهان‌شدن", callback_data: "cmb_hide" }]);
  const allies = state.turnOrder.filter(
    (t) =>
      t.type === "player" &&
      t.id !== actor.id &&
      (players.get(t.id)?.hp ?? 0) > 0,
  );
  for (const ally of allies) {
    rows.push([
      { text: `🤝 کمک به ${ally.name}`, callback_data: `cmb_help_${ally.id}` },
    ]);
  }

  return { inline_keyboard: rows };
}

export async function sendTurnMessage(chatId) {
  const view = await getCombatView(chatId);
  if (!view) return;
  const sent = await api.sendMessage({
    chat_id: chatId,
    text: renderCombatText(view.state, view.players),
    reply_markup: buildTurnKeyboard(view.state, view.players),
  });
  if (sent) {
    await db
      .update(combatState)
      .set({ turnMessageId: sent.message_id })
      .where(eq(combatState.chatId, chatId))
      .run();
  }
}

async function clearTurnButtons(chatId, turnMessageId) {
  if (!turnMessageId) return;
  try {
    await api.editMessageReplyMarkup({
      chat_id: chatId,
      message_id: turnMessageId,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (_) {
    // پیام قبلاً پاک شده یا خیلی قدیمیه؛ مهم نیست
  }
}
// متن پیام پیروزی: دلیل XP هر شخصیت + فاصله تا سطح بعد + بیدارشدن‌ها + بیرون‌رفتن مرده‌ها
export async function buildVictoryText(finished) {
  const lines = ["🏆 نبرد تموم شد! دشمن‌ها شکست خوردن."];

  const xp = finished?.xp;
  if (xp) {
    if (xp.share > 0 && xp.awards.length > 0) {
      lines.push(`✨ +${xp.share} XP برای هر نفر — ${xp.reason}`);
      for (const a of xp.awards) {
        try {
          const c = await db
            .select()
            .from(characters)
            .where(eq(characters.id, a.charId))
            .get();
          const next = xpToNext(c?.level, c?.xp);
          const tail = next.maxLevel
            ? "به سطح بیشینه رسیده"
            : next.remaining > 0
              ? `XP تا سطح بعد ${next.remaining}`
              : "آستانهٔ سطح بعد پر شد";
          lines.push(`• ${a.name}: ${tail}`);
        } catch (err) {
          console.warn("⚠️  خواندن XP شخصیت برای پیام ممکن نشد:", err.message);
          lines.push(`• ${a.name}`);
        }
      }
    } else {
      lines.push("این نبرد XP نداشت.");
    }
  }

  const woke = finished?.woke || [];
  if (woke.length) lines.push(`💤 ${woke.join("، ")} با ۱ HP به هوش اومد.`);

  const removed = finished?.removed || [];
  for (const d of removed) {
    lines.push(`☠️ ${d.name} برای همیشه از دست رفت و از بازی بیرون رفت.`);
  }
  if (removed.length) {
    lines.push("(ادمین می‌تونه با /rejoin بازیکن رو با شخصیت جدید برگردونه)");
  }
  return lines.join("\n");
}
export async function presentCombatResult(chatId, result, prevTurnMessageId) {
  await clearTurnButtons(chatId, prevTurnMessageId);

  const parts = [];
  if (result.diceLines?.length) parts.push(result.diceLines.join("\n"));
  if (result.narration) parts.push(result.narration);
  if (parts.length > 0) {
    await api.sendMessage({ chat_id: chatId, text: parts.join("\n\n") });
  }

  if (result.outcome === "victory") {
    await api.sendMessage({
      chat_id: chatId,
      text: await buildVictoryText(result.finished),
    });
  } else if (result.outcome === "defeat") {
    await api.sendMessage({
      chat_id: chatId,
      text: "💀 همه‌ی گروه بیهوش یا کشته شدن... بازی همین‌جا تموم میشه.",
    });
  } else {
    await sendTurnMessage(chatId);
  }
}
