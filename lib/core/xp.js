// XP چک مهارت (طراحی player_character.md بخش 15):
//   فقط DC نهایی ≥ 15 (بعد از تعدیل Tier مکان)، فقط وقتی چک موفق شده (فاصله ≥ 0)،
//   و فقط برای چک‌های بدون حریف (تقابل با NPC DC ندارد). هر XP به همان شخصیت می‌رسه و با دلیل دیده میشه.
//
// ⚠️ جدول DC←XP موقته: بخش 15 به «اسکیل 7.8-ب» ارجاع می‌ده که در بسته نبود.
// برای عوض‌کردن فقط همین جدول رو تغییر بده (از بالا به پایین؛ اولین ردیفی که DC بهش برسه).
export const SKILL_XP_MIN_DC = 15;
export const SKILL_XP_TABLE = [
  { minDc: 30, xp: 100 },
  { minDc: 25, xp: 50 },
  { minDc: 20, xp: 25 },
  { minDc: 15, xp: 10 },
];

// result: خروجی یک چک { dc, margin, opponentLabel? }
export function skillXpFor({ dc, margin, opponentLabel } = {}) {
  if (opponentLabel) return 0;
  if (!Number.isFinite(dc) || !Number.isFinite(margin)) return 0;
  if (dc < SKILL_XP_MIN_DC || margin < 0) return 0;
  for (const row of SKILL_XP_TABLE) if (dc >= row.minDc) return row.xp;
  return 0;
}

// خط‌های ✨ زیر روایت؛ هر چک موفقِ XPدار یک خط، با دلیل و «XP تا سطح بعد»
// r.xpNext: null = سطح بیشینه، 0 = آستانهٔ سطح بعد پر شد، عدد = باقی‌مانده
export function xpToDiceText(results) {
  return (results || [])
    .filter((r) => r.xp > 0)
    .map((r) => {
      const tail =
        r.xpNext === null
          ? " · به سطح بیشینه رسیده"
          : r.xpNext === 0
            ? " · آستانهٔ سطح بعد پر شد"
            : Number.isFinite(r.xpNext)
              ? ` · XP تا سطح بعد ${r.xpNext}`
              : "";
      return `✨ ${r.name}: +${r.xp} XP — ${r.reason || "چک مهارت"}${tail}`;
    })
    .join("\n");
}
