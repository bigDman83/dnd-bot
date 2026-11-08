import assert from "node:assert/strict";
import {
  snapshotAfterRoll,
  rollDifficulty,
  noticeRoll,
  markNoticed,
  markEngaged,
  shouldStartCombat,
  snapshotCombat,
  combatDecisionFromSnapshot,
  presenceNote,
  pendingEncounter,
  victorySnapshotUpdate,
  readSnapshot,
} from "lib/combat/encounter";
import { COMBAT_MENU } from "lib/combat/monsters";

let n = 0;
const ok = (m) => console.log("✅", ++n, m);
const by = (s) => COMBAT_MENU.find((m) => m.key.endsWith(s));
const mk = (entry, count, pp) =>
  snapshotAfterRoll({
    roll: rollDifficulty("moderate", 0, () => 8),
    entry,
    count,
    pp,
    tier: 2,
    resetCount: 0,
    nowHour: 10,
  });

// ۱) گرگ‌ها: دور ورود ← نشانه؛ دور بعد بی‌مخفی‌کاری ← مطلع ← نبرد
const wolf = mk(by("_wolf"), 3, 13);
assert.ok(presenceNote(wolf).includes("نشانه"));
const notice = noticeRoll({
  snapshot: wolf,
  checkResults: [],
  dexMods: [1, 0],
});
assert.equal(notice.noticed, true);
const afterNotice = markNoticed(wolf, notice.mode);
assert.equal(shouldStartCombat(afterNotice), true);
const note = presenceNote(wolf, notice);
assert.ok(note.includes("با بو") && note.includes("هنوز درگیری را شروع نکن"));
const d = combatDecisionFromSnapshot(afterNotice);
assert.equal(d.combat.entry.key, by("_wolf").key);
assert.equal(d.combat.count, 3);
assert.ok(d.combat.reason.includes("بو"));
assert.deepEqual(d.checks, []);
const engaged = markEngaged(afterNotice);
assert.equal(shouldStartCombat(engaged), false);
assert.equal(pendingEncounter(engaged), null);
assert.equal(presenceNote(engaged), "");
ok("گرگ: نشانه ← مطلع با بو ← نبرد از Snapshot ← engaged");

// ۲) مخفی‌کاری موفق: ناشناخته می‌ماند، نبرد شروع نمی‌شود، نشانه ادامه دارد
const hid = noticeRoll({
  snapshot: wolf,
  checkResults: [{ skill: "Stealth", total: 20 }],
  dexMods: [0],
});
assert.equal(hid.noticed, false);
assert.equal(shouldStartCombat(wolf), false);
assert.ok(presenceNote(wolf, hid).includes("نشانه"));
ok("مخفی‌کاری موفق ← بدون درگیری، نشانه‌ی حضور می‌ماند");

// ۳) راهزن: مطلع‌شدن ← Sighting؛ نبرد خودکار نه؛ پایدار تا دور بعد
const bandit = mk(by("bandit"), 2, 10);
const bn = noticeRoll({
  snapshot: bandit,
  checkResults: [{ skill: "Stealth", total: 4 }],
  dexMods: [0],
});
assert.equal(bn.mode, "sighting");
const bSnap = markNoticed(bandit, bn.mode);
assert.equal(shouldStartCombat(bSnap), false);
assert.equal(combatDecisionFromSnapshot(bSnap).combat.count, 2); // اگر بازیکن حمله کند همین دشمن‌ها
assert.ok(presenceNote(bSnap).includes("رودررو")); // دور بعد هم راوی می‌داند
assert.equal(
  noticeRoll({ snapshot: bSnap, checkResults: [], dexMods: [0] }),
  null,
);
ok("انسان‌نما: رودررو بدون نبرد خودکار؛ یادداشت پایدار؛ دوباره تاس نمی‌خورد");

// ۴) Resolver در مکان با دشمن در انتظار ← همان دشمن‌ها
const sc = snapshotCombat(wolf);
assert.equal(sc.entry.key, by("_wolf").key);
assert.equal(sc.count, 3);
assert.equal(snapshotCombat(null), null);
assert.equal(snapshotCombat(engaged), null);
ok("snapshotCombat: دشمن‌های Snapshot برای نبرد Resolver");

// ۵) عنکبوت: بدون مخفی‌کاری ← تار ← حمله
const spider = mk(by("giant-wolf-spider"), 2, 11);
const sn = noticeRoll({ snapshot: spider, checkResults: [], dexMods: [0, 0] });
assert.equal(sn.noticed, true);
assert.equal(sn.mode, "attack");
assert.ok(presenceNote(spider, sn).includes("تار"));
assert.ok(
  combatDecisionFromSnapshot(
    markNoticed(spider, "attack"),
  ).combat.reason.includes("تار"),
);
ok("عنکبوت: تار ← حمله");

// ۶) Snapshot قدیمی یا Cleared ← بی‌صدا
assert.equal(presenceNote(null), "");
assert.equal(combatDecisionFromSnapshot(null), null);
assert.equal(shouldStartCombat(null), false);
ok("مکان بدون دشمن در انتظار ← هیچ‌چیز");

// ۷) پایان نبرد: Cleared فقط برای دشمن‌های engaged؛ V11 می‌تواند outcome بدهد
const v = victorySnapshotUpdate(markEngaged(afterNotice), 123.5);
assert.equal(v.status, "Cleared");
assert.equal(v.lastCleared, 123.5);
assert.equal(v.composition.length, 0);
assert.equal(v.outcome, "cleared");
assert.equal(victorySnapshotUpdate(afterNotice, 1), null); // هنوز engaged نشده (مثلاً /combat دستی)
assert.equal(victorySnapshotUpdate(null, 1), null);
assert.equal(victorySnapshotUpdate({ status: "Cleared" }, 1), null);
assert.equal(
  victorySnapshotUpdate(markEngaged(afterNotice), 5, "fled").outcome,
  "fled",
);
assert.equal(readSnapshot(JSON.parse(JSON.stringify(v))).status, "Cleared");
ok("پایان نبرد: Cleared فقط برای engaged؛ outcome برای V11");

console.log(`📊 ${n} تست`);
