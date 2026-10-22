import { SKILL_ABILITY_MAP, abilityModifier } from "lib/core/dndData";
import { rollD20 } from "lib/core/dice";

// برتری/ضعف: هر منبع برتری و هر منبع ضعف همدیگر رو کامل خنثی می‌کنن (قاعدهٔ 5e)،
// فرقی نمی‌کنه از هر طرف چند منبع باشه
export function netMode(advantageSources = [], disadvantageSources = []) {
  const a = (advantageSources || []).length > 0;
  const d = (disadvantageSources || []).length > 0;
  if (a && d) return "normal";
  if (a) return "advantage";
  if (d) return "disadvantage";
  return "normal";
}

// mode: "normal" | "advantage" | "disadvantage"
export function rollD20WithMode(mode = "normal") {
  const first = rollD20();
  if (mode !== "advantage" && mode !== "disadvantage") {
    return { roll: first, rolls: [first] };
  }
  const second = rollD20();
  const roll =
    mode === "advantage" ? Math.max(first, second) : Math.min(first, second);
  return { roll, rolls: [first, second] };
}

export function resolveSkillCheck(character, skillName, dc, mode = "normal") {
  const ability = SKILL_ABILITY_MAP[skillName] || "STR";
  const abilityScore =
    (character.abilities && character.abilities[ability]) || 10;
  const mod = abilityModifier(abilityScore);
  const isProficient = (character.skillProficiencies || []).includes(skillName);
  const profBonus = isProficient ? character.proficiencyBonus || 2 : 0;

  const { roll, rolls } = rollD20WithMode(mode);
  const total = roll + mod + profBonus;

  return {
    skillName,
    ability,
    roll,
    rolls,
    mode,
    mod,
    profBonus,
    total,
    dc,
    success: total >= dc,
  };
}

// چک مقابله‌ای (مثلاً چانه‌زنی با یک NPC): تاس بازیکن در برابر تاس + مودیفایر NPC
export function resolveContestedCheck(character, skillName, npcModifier) {
  const playerRoll = resolveSkillCheck(character, skillName, 0);
  const npcTotal = rollD20() + npcModifier;
  return { ...playerRoll, npcTotal, success: playerRoll.total >= npcTotal };
}
