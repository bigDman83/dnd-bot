import assert from "node:assert/strict";
import {
  decideGate,
  rollDifficulty,
  enemyPool,
  poolMenuText,
  poolByIndex,
  snapshotAfterRoll,
  markEngaged,
  markCleared,
  pendingEncounter,
  isResetDue,
  applyReset,
  readSnapshot,
  cooldownActive,
  RESET_DAYS,
} from "lib/combat/encounter";
import { COMBAT_MENU } from "lib/combat/monsters";

let n = 0;
const ok = (name) => console.log(`✅ ${name}`) || n++;
const fixed = (v) => () => v;

// ۱) تیربندی d20
const bands = (d, h = "moderate", r = 0) => rollDifficulty(h, r, fixed(d));
assert.equal(bands(1).budgetClass, "low");
assert.equal(bands(5).budgetClass, "low");
assert.equal(bands(6).budgetClass, "moderate");
assert.equal(bands(10).budgetClass, "moderate");
assert.equal(bands(11).budgetClass, "high");
assert.equal(bands(15).difficulty, "hard");
assert.equal(bands(16).difficulty, "very_hard");
assert.equal(bands(20).budgetClass, "high");
ok("تیربندی d20 (۱–۵، ۶–۱۰، ۱۱–۱۵، ۱۶–۲۰)");

// ۲) اثر hostility
assert.equal(bands(3, "low").empty, true);
assert.equal(bands(7, "low").empty, false);
assert.equal(bands(3, "moderate").empty, false);
const hi = bands(3, "high");
assert.equal(hi.empty, false);
assert.equal(hi.budgetClass, "moderate");
assert.equal(hi.difficulty, "medium");
ok("hostility: low ← خالی، high ← ساده به متوسط");

// ۳) سقف بعد از اولین Reset
assert.equal(bands(18, "high", 1).budgetClass, "moderate");
assert.equal(bands(18, "high", 1).capped, true);
assert.equal(bands(18, "high", 2).budgetClass, "high");
assert.equal(bands(18, "high", 0).capped, false);
ok("اولین تاس بعد از Reset حداکثر Moderate");

// ۴) توزیع واقعی تاس
const counts = {};
for (let i = 0; i < 20000; i++) {
  const r = rollDifficulty("moderate", 0);
  counts[r.difficulty] = (counts[r.difficulty] || 0) + 1;
}
for (const k of ["easy", "medium", "hard", "very_hard"]) {
  assert.ok(Math.abs(counts[k] / 20000 - 0.25) < 0.02, k);
}
ok("توزیع d20 تقریباً ۲۵٪ هر بازه");

// ۵) Gate
const base = { tier: 2, nowHour: 100 };
assert.equal(
  decideGate({ ...base, hostility: "none", snapshot: null }).action,
  "skip",
);
assert.equal(
  decideGate({ ...base, hostility: "low", snapshot: null, inCombat: true })
    .reason,
  "in_combat",
);
assert.equal(
  decideGate({ ...base, hostility: "low", snapshot: null }).action,
  "roll",
);
assert.equal(
  decideGate({
    ...base,
    hostility: "low",
    snapshot: { status: "Rolled", composition: [{ key: "a", count: 1 }] },
  }).action,
  "reuse",
);
const cl = { status: "Cleared", lastCleared: 90 };
assert.equal(
  decideGate({ ...base, hostility: "high", snapshot: cl }).action,
  "reuse",
);
const due = decideGate({
  ...base,
  nowHour: 90 + 4 * 24,
  hostility: "high",
  snapshot: cl,
});
assert.equal(due.action, "roll");
assert.equal(due.snapshot.resetCount, 1);
ok("Gate: skip / reuse / roll و Reset");

// ۶) Reset بر اساس Tier
for (const t of [1, 2, 3, 4]) {
  const s = { status: "Cleared", lastCleared: 0 };
  assert.equal(isResetDue(s, t, RESET_DAYS[t] * 24 - 0.1), false);
  assert.equal(isResetDue(s, t, RESET_DAYS[t] * 24), true);
}
assert.equal(isResetDue({ status: "Rolled", lastCleared: 0 }, 1, 9999), false);
assert.equal(applyReset(applyReset(cl)).resetCount, 2);
ok("Reset: ۲/۴/۷/۱۰ روز");

// ۷) مکان قدیمی / نامعتبر = Unrolled
assert.equal(readSnapshot(null).status, "Unrolled");
assert.equal(readSnapshot({ status: "؟" }).status, "Unrolled");
ok("Snapshot قدیمی = Unrolled");

// ۸) استخر و Fallback
const forest = enemyPool(2, ["forest"], "moderate");
assert.equal(forest.fallback, false);
assert.ok(forest.pool.every((m) => m.environments.includes("forest")));
const snow = enemyPool(2, ["snow"], "moderate"); // فقط گرگ برف دارد (<۳)
assert.equal(snow.fallback, true);
assert.equal(snow.pool.length, 21);
assert.equal(enemyPool(2, null, "high").pool.length, 21);
assert.equal(enemyPool(1, ["desert"], "high").fallback, true);
const low = enemyPool(2, ["urban"], "low");
assert.ok(low.pool.every((m) => m.rank === "minion"));
ok("استخر: فیلتر محیط، Fallback، Rank در Low");

// ۹) منو و شماره
const p = enemyPool(2, ["forest"], "moderate").pool;
assert.equal(poolMenuText(p).split("\n").length, p.length);
assert.equal(poolByIndex(p, 1), p[0]);
assert.equal(poolByIndex(p, 0), null);
assert.equal(poolByIndex(p, p.length + 1), null);
ok("منو و شمارهٔ بسته");

// ۱۰) Snapshot
const wolf = COMBAT_MENU.find((m) => m.key.endsWith("_wolf"));
const roll = rollDifficulty("moderate", 0, fixed(8));
const snap = snapshotAfterRoll({
  roll,
  entry: wolf,
  count: 3,
  tier: 2,
  resetCount: 0,
  nowHour: 50,
});
assert.equal(snap.status, "Rolled");
assert.deepEqual(snap.composition, [{ key: wolf.key, count: 3, pp: null }]);
assert.equal(pendingEncounter(snap).length, 1);
const eng = markEngaged(snap);
assert.equal(pendingEncounter(eng), null);
const done = markCleared(eng, 60);
assert.equal(done.status, "Cleared");
assert.equal(done.lastCleared, 60);
assert.equal(done.composition.length, 0);
const empty = snapshotAfterRoll({
  roll: rollDifficulty("low", 0, fixed(2)),
  entry: null,
  count: 0,
  tier: 1,
  resetCount: 0,
  nowHour: 5,
});
assert.equal(empty.status, "Cleared");
assert.equal(empty.empty, true);
assert.equal(pendingEncounter(empty), null);
ok("Snapshot: Rolled ← engaged ← Cleared، و نتیجهٔ خالی");

// ۱۱) Cooldown
const last = { round: 5, worldHour: 100 };
assert.equal(cooldownActive(null, 100, 5), false);
assert.equal(cooldownActive(last, 100.5, 6), true);
assert.equal(cooldownActive(last, 101, 6), false); // ۱ ساعت گذشت
assert.equal(cooldownActive(last, 100.5, 8), false); // ۳ دور گذشت
assert.equal(cooldownActive(last, 100, 7), true);
ok("Cooldown: ۱ ساعت یا ۳ دور، هرکدام زودتر");

console.log(`📊 ${n} تست`);
