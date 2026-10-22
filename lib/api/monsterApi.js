import { fetch } from "sdk";

// تبدیل رشته‌ی نوع تاس مثل "D6" یا "d8" به عدد وجه (۶، ۸ و...)
function parseDieSides(dieType) {
  const match = String(dieType || "D6").match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 6;
}

function normalizeMonster(c) {
  const actions = (c.actions || []).flatMap((a) =>
    (a.attacks || []).map((atk) => ({
      name: atk.name || a.name,
      toHit: atk.to_hit_mod ?? 4,
      damageDiceCount: atk.damage_die_count ?? 1,
      damageDieSides: parseDieSides(atk.damage_die_type),
      damageBonus: atk.damage_bonus ?? 0,
      damageType: atk.damage_type?.name || "",
    })),
  );

  return {
    name: c.name,
    maxHp: c.hit_points,
    ac: c.armor_class,
    dexMod: (c.modifiers && c.modifiers.dexterity) ?? 0,
    cr: c.challenge_rating,
    xp: c.experience_points ?? 0,
    pp: c.passive_perception ?? 10,
    actions: actions.length
      ? actions
      : [
          {
            name: "حمله",
            toHit: 4,
            damageDiceCount: 1,
            damageDieSides: 6,
            damageBonus: 0,
          },
        ],
  };
}

// گرفتن هیولا با شناسه‌ی دقیق Open5e (مثلاً "srd-2024_wolf")؛ برای نبرد از همین استفاده می‌کنیم
export async function fetchMonsterByKey(key) {
  const res = await fetch(
    `https://api.open5e.com/v2/creatures/${encodeURIComponent(key)}/`,
  );
  if (!res.ok) throw new Error(`Open5e HTTP ${res.status} برای ${key}`);
  return normalizeMonster(await res.json());
}
