import assert from "node:assert/strict";
import { buildWhyLines } from "handlers/traceCommands";
import {
  gateWhyLines, noticeWhyLines, replayEncounterItems, snapshotAfterRoll, rollDifficulty,
} from "lib/combat/encounter";
import { COMBAT_MENU } from "lib/combat/monsters";

let n = 0;
const ok = (m) => console.log("✅", ++n, m);
const by = (s) => COMBAT_MENU.find((m) => m.key.endsWith(s));
const wolf = by("_wolf");

// Plan سفر با Gate (d20=13 ← سخت، کلاس high)
const roll = rollDifficulty("moderate", 0, () => 13);
const snap = snapshotAfterRoll({ roll, entry: wolf, count: 3, pp: 13, tier: 2, resetCount: 0, nowHour: 40 });
const info = {
  action: "roll", reason: "unrolled", d20: 13, difficulty: roll.difficulty, band: roll.budgetClass,
  empty: false, capped: false, monsterKey: wolf.key, count: 3, size: 10, envFallback: false, aiFallback: false,
};
const mkPlan = (over = {}) => ({
  travel: {
    traveled: true, hours: 4, distanceLabel: "چند ساعت",
    location: { name: "جنگل", tier: 2, hostility: "moderate", environments: ["forest"], hostileSnapshot: snap },
  },
  encounter: info,
  decision: { moved: true, distanceIndex: 1 },
  ...over,
});

// ۱) /why سفر: خط Roll Gate
const L = gateWhyLines(info);
assert.equal(L.length, 1);
assert.ok(L[0].includes("d20=13") && L[0].includes("سخت") && L[0].includes(wolf.fa) && L[0].includes("×3"));
assert.deepEqual(gateWhyLines({ action: "skip", reason: "no_hostility" }), ["Roll Gate: رد شد (خصومت مکان none است)"]);
assert.deepEqual(gateWhyLines(null), []);
const why = buildWhyLines({ eventId: "c:9:travel:0", type: "travel", index: 0, round: 9, applied: true, plan: mkPlan(), attempts: [] });
assert.ok(why.some((l) => l.includes("Roll Gate [GATE_ROLL]")));
ok("/why سفر: خط Roll Gate (و رد شدن Gate)");

// ۲) /why صحنه: تاس توجه
const notice = { noticed: true, mode: "attack", sense: "scent", enemyScore: 18, groupStealth: 10, source: "passive", monsterKey: wolf.key };
const nl = noticeWhyLines(notice);
assert.ok(nl[0].includes("10") && nl[0].includes("18") && nl[0].includes("بو") && nl[0].includes("مطلع شد (حمله)"));
assert.ok(noticeWhyLines({ ...notice, noticed: false, mode: null })[0].includes("ناشناخته ماند"));
assert.deepEqual(noticeWhyLines(null), []);
const whyScene = buildWhyLines({ eventId: "c:10:scene:0", type: "scene", index: 0, round: 10, applied: true, plan: { notice, decision: { type: "narrative" } }, attempts: [] });
assert.ok(whyScene.some((l) => l.includes("تاس توجه")));
ok("/why صحنه: تاس توجه");

// ۳) /replay: سالم ← همه ✅
const items = replayEncounterItems({ ...mkPlan(), notice });
assert.ok(items.every((i) => i.s === "ok"), JSON.stringify(items));
assert.equal(items.length, 2);
ok("/replay: Gate و تاس توجه سالم");

// ۴) جهش‌ها ← ⚠️
const diffs = (plan) => replayEncounterItems(plan).filter((i) => i.s === "diff");
assert.equal(diffs({ ...mkPlan(), encounter: { ...info, d20: 3 } }).length >= 1, true); // d20 با بازه نمی‌خواند
assert.equal(diffs({ ...mkPlan(), encounter: { ...info, band: "low" } }).length >= 1, true);
assert.equal(diffs({ ...mkPlan(), encounter: { ...info, count: 5 } }).length >= 1, true); // Snapshot فرق دارد
assert.equal(diffs({ ...mkPlan(), encounter: { ...info, monsterKey: by("bandit").key } }).length >= 1, true);
assert.equal(diffs({ notice: { ...notice, noticed: false } }).length >= 1, true); // ۱۰ < ۱۸ ولی ناشناخته؟
assert.equal(diffs({ notice: { ...notice, mode: "sighting" } }).length >= 1, true); // گرگ انسان‌نما نیست
ok("جهش‌ها ← ⚠️ (بازه، کلاس، ترکیب، حیوان، مطلع‌شدن، حالت)");

// ۵) Plan قدیمی یا سفر بدون Gate ← ➖ و بدون خطا
assert.equal(replayEncounterItems({ travel: { traveled: true, location: {} } })[0].s, "skip");
assert.deepEqual(replayEncounterItems({}), []);
assert.deepEqual(replayEncounterItems(null), []);
assert.equal(replayEncounterItems({ ...mkPlan(), encounter: { action: "skip", reason: "no_hostility" } })[0].s, "ok");
ok("Plan قدیمی ← ➖؛ Gate رد‌شده ← ✅");

// ۶) خالی
const emptyRoll = rollDifficulty("low", 0, () => 2);
const emptySnap = snapshotAfterRoll({ roll: emptyRoll, entry: null, count: 0, tier: 1, resetCount: 0, nowHour: 5 });
const emptyInfo = { action: "roll", reason: "unrolled", d20: 2, difficulty: emptyRoll.difficulty, band: emptyRoll.budgetClass, empty: true, capped: false, monsterKey: null, count: 0, size: 0, envFallback: false, aiFallback: false };
const ep = { travel: { traveled: true, location: { hostility: "low", tier: 1, hostileSnapshot: emptySnap } }, encounter: emptyInfo };
assert.ok(replayEncounterItems(ep).every((i) => i.s === "ok"));
assert.ok(gateWhyLines(emptyInfo)[0].includes("خالی"));
ok("Gate خالی: /why و /replay");

console.log(`📊 ${n} تست`);
