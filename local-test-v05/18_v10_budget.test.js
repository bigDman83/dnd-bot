import assert from "node:assert/strict";
import {
  COMBAT_MENU,
  clampCount,
  partyBudget,
  budgetClassForTier,
  menuForTier,
  MAX_ENEMIES_ANON,
} from "lib/combat/monsters";
import { validateDecision } from "lib/game/resolver";

const pick = (suffix) => COMBAT_MENU.find((m) => m.key.endsWith(suffix));
let n = 0;
const ok = (name) => console.log(`✅ ${name}`) || n++;

// ۱) کاتالوگ: فیلدهای تازه روی هر ۲۱ ورودی
assert.equal(COMBAT_MENU.length, 21);
for (const m of COMBAT_MENU) {
  assert.ok(m.type && ["minion", "standard"].includes(m.rank), m.key);
  assert.ok(m.environments.length >= 1 && m.environments.length <= 4, m.key);
  assert.equal(typeof m.negotiable, "boolean");
  assert.equal(m.lastingEffect, "none");
}
ok("کاتالوگ: ۲۱ ورودی با فیلدهای تازه");

// ۲) نگاشت Tier ← کلاس
assert.deepEqual([1, 2, 3, 4].map(budgetClassForTier), [
  "low",
  "moderate",
  "high",
  "high",
]);
assert.equal(budgetClassForTier(99), "low");
ok("Tier ← کلاس بودجه");

// ۳) بودجه: ۵۰/۷۵/۱۰۰ به‌ازای هر نفر؛ گروه کمتر از ۴ نفر × (تعداد ÷ ۴)
assert.equal(partyBudget([1, 1, 1, 1], "low"), 200); // گروه کامل: بدون تغییر
assert.equal(partyBudget([1, 1, 1, 1], "high"), 400);
assert.equal(partyBudget([1, 1, 1, 1, 1, 1], "low"), 300); // بیشتر از ۴ نفر: ضریب ۱
assert.equal(partyBudget([1, 1], "low"), 50);
assert.equal(partyBudget([1, 1], "moderate"), 75);
assert.equal(partyBudget([1, 1], "high"), 100);
assert.equal(partyBudget([1], "high"), 25);
ok("بودجه: گروه کامل بدون تغییر، گروه کوچک‌تر مقیاس می‌شود");

// ۴) سطح بالاتر و سقف سطح ۵
assert.equal(partyBudget([1, 3, 1, 1], "high"), 700);
assert.equal(partyBudget([9, 9, 9, 9], "high"), 4400);
assert.equal(partyBudget([], "low"), 12);
assert.equal(partyBudget([1], "نامعتبر"), 12);
ok("بودجه: سطح‌های مختلف، سقف ۵، ورودی نامعتبر");

// ۵) clampCount
const gob = pick("goblin-minion");
const wolf = pick("_wolf");
const jackal = pick("jackal");
assert.equal(clampCount(gob, 10, [1, 1], "low"), 2);
assert.equal(clampCount(gob, 10, [1, 1], "moderate"), 3);
assert.equal(clampCount(wolf, 10, [1, 1, 1], "high"), 4);
assert.equal(
  clampCount(wolf, 10, [1, 1, 1, 1, 1, 1], "high"),
  MAX_ENEMIES_ANON,
);
assert.equal(clampCount(jackal, 10, [1, 1, 1, 1], "low"), MAX_ENEMIES_ANON); // ۲۰۰ ÷ ۱۰ = ۲۰ ← سقف ۶
assert.equal(clampCount(wolf, 0, [1], "low"), 1);
assert.equal(clampCount(wolf, 3, [1], "low"), 1);
// موردی که دوستان دیدند: سه گرگ برای دو نفر سطح ۱ ← حالا حداکثر دو گرگ (High) و یک گرگ (Moderate)
assert.equal(clampCount(wolf, 3, [1, 1], "high"), 2);
assert.equal(clampCount(wolf, 3, [1, 1], "moderate"), 1);
assert.equal(clampCount(wolf, 3, [1, 1, 1, 1], "high"), 3); // گروه چهارنفره همان سه گرگ
ok("clampCount: بودجه، سقف ۶، حداقل ۱، و مورد سه گرگ برای دو نفر");

// ۶) validateDecision همان نتیجه را با مسیر Resolver می‌دهد
const eligible = [
  { tgId: 1, characterId: 1 },
  { tgId: 2, characterId: 2 },
];
const d = (levels, tier) =>
  validateDecision(
    {
      type: "combat",
      combat: {
        monster: menuForTier(tier).indexOf(gob) + 1,
        count: 10,
        reason: "حمله شد",
      },
    },
    eligible,
    { tier, partyLevels: levels },
  );
assert.equal(d([1, 1], 1).combat.count, 2);
assert.equal(d([3, 3], 1).combat.count, 6);
assert.equal(d(null, 2).combat.count, 3);
ok("validateDecision: سطح شخصیت روی تعداد اثر دارد");

console.log(`📊 ${n} تست`);
