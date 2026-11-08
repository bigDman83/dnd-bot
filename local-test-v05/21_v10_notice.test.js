import assert from "node:assert/strict";
import {
  noticeRoll, groupStealth, markNoticed, shouldStartCombat, noticeNarratorNote,
  snapshotAfterRoll, rollDifficulty, markEngaged, markCleared, readSnapshot, planEncounter,
} from "lib/combat/encounter";
import { COMBAT_MENU } from "lib/combat/monsters";

let n = 0;
const ok = (m) => console.log("✅", ++n, m);
const by = (suffix) => COMBAT_MENU.find((m) => m.key.endsWith(suffix));
const snapFor = (entry, count = 2, pp = null) =>
  snapshotAfterRoll({
    roll: rollDifficulty("moderate", 0, () => 8), entry, count, pp,
    tier: 2, resetCount: 0, nowHour: 10,
  });

// ۱) کاتالوگ: حس هر هیولا
for (const m of COMBAT_MENU) {
  assert.ok(["scent", "hearing", "sight", "web"].includes(m.senses), m.key);
}
assert.equal(by("_wolf").senses, "scent");
assert.equal(by("giant-wolf-spider").senses, "web");
assert.equal(by("bandit").senses, "sight");
ok("کاتالوگ: ۲۱ هیولا همه حس دارند");

// ۲) مخفی‌کاری گروه
assert.deepEqual(groupStealth([{ skill: "Stealth", total: 17 }, { skill: "Stealth", total: 9 }], [2, 0]), { value: 9, source: "checked" });
assert.deepEqual(groupStealth([{ skill: "Athletics", total: 20 }], [2, 0]), { value: 10, source: "passive" });
assert.deepEqual(groupStealth([], [1, -1]), { value: 9, source: "passive" });
assert.deepEqual(groupStealth([], []), { value: 10, source: "passive" });
ok("مخفی‌کاری گروه: چک Stealth یا ۱۰ + چابکی");

// ۳) گرگ: بو (+۵). pp=13 ← ۱۸. گروه بی‌مخفی‌کاری (۱۰) ← مطلع
const wolf = snapFor(by("_wolf"), 3, 13);
const r1 = noticeRoll({ snapshot: wolf, checkResults: [], dexMods: [0, 0] });
assert.equal(r1.noticed, true);
assert.equal(r1.mode, "attack");
assert.equal(r1.enemyScore, 18);
assert.equal(r1.sense, "scent");
ok("گرگ با بو گروه بی‌مخفی‌کاری را حس می‌کند ← حمله");

// ۴) مخفی‌کاری خوب (≥ ۱۸) ← ناشناخته می‌ماند؛ ۱۷ ← مطلع
const hid = noticeRoll({ snapshot: wolf, checkResults: [{ skill: "Stealth", total: 18 }], dexMods: [0] });
assert.equal(hid.noticed, false);
assert.equal(hid.mode, null);
assert.equal(noticeRoll({ snapshot: wolf, checkResults: [{ skill: "Stealth", total: 17 }], dexMods: [0] }).noticed, true);
ok("مخفی‌کاری ≥ امتیاز دشمن ← ناشناخته؛ یک کمتر ← مطلع");

// ۵) انسان‌نما: راهزن pp=10 (دید، بدون بونوس). گروه ۱۰ ← مخفی (مساوی به نفع گروه)
const bandit = snapFor(by("bandit"), 2, 10);
assert.equal(noticeRoll({ snapshot: bandit, checkResults: [], dexMods: [0] }).noticed, false);
const seen = noticeRoll({ snapshot: bandit, checkResults: [{ skill: "Stealth", total: 6 }], dexMods: [0] });
assert.equal(seen.noticed, true);
assert.equal(seen.mode, "sighting"); // انسان‌نما: رودررو، نه حمله
ok("انسان‌نما: مساوی ← مخفی؛ مطلع‌شدن ← فقط رودررو (Sighting)");

// ۶) تار: DC ثابت ۱۲ مستقل از pp
const spider = snapFor(by("giant-wolf-spider"), 2, 99);
assert.equal(noticeRoll({ snapshot: spider, checkResults: [], dexMods: [0] }).enemyScore, 12);
assert.equal(noticeRoll({ snapshot: spider, checkResults: [], dexMods: [0] }).noticed, true); // ۱۰ < ۱۲
assert.equal(noticeRoll({ snapshot: spider, checkResults: [{ skill: "Stealth", total: 12 }], dexMods: [0] }).noticed, false);
assert.equal(noticeRoll({ snapshot: spider, checkResults: [], dexMods: [2] }).noticed, false); // ۱۲ ≥ ۱۲
ok("عنکبوت: تار با DC ثابت ۱۲");

// ۷) pp ناشناخته ← ۱۰
const nopp = snapFor(by("_wolf"), 1, null);
assert.equal(noticeRoll({ snapshot: nopp, checkResults: [], dexMods: [0] }).enemyScore, 15);
ok("pp نامشخص ← ۱۰ حساب می‌شود");

// ۸) شرط‌های نبودنِ تاس
assert.equal(noticeRoll({ snapshot: null, checkResults: [], dexMods: [0] }), null);
assert.equal(noticeRoll({ snapshot: markEngaged(wolf), checkResults: [], dexMods: [0] }), null);
assert.equal(noticeRoll({ snapshot: markCleared(wolf, 20), checkResults: [], dexMods: [0] }), null);
assert.equal(noticeRoll({ snapshot: markNoticed(wolf, "attack"), checkResults: [], dexMods: [0] }), null);
ok("بدون دشمن در انتظار یا مطلع‌شده ← تاسی نیست");

// ۹) شروع نبرد فقط برای حمله‌ی مطلع‌شده
assert.equal(shouldStartCombat(wolf), false);
assert.equal(shouldStartCombat(markNoticed(wolf, "attack")), true);
assert.equal(shouldStartCombat(markNoticed(bandit, "sighting")), false);
assert.equal(shouldStartCombat(markEngaged(markNoticed(wolf, "attack"))), false);
ok("شروع نبرد: فقط مطلع‌شده و از نوع حمله، و هنوز engaged نشده");

// ۱۰) یادداشت راوی: بدون عدد؛ بو، تار، رودررو
const nb = (notice, snap) => noticeNarratorNote(notice, snap);
const nWolf = nb(r1, wolf);
assert.ok(nWolf.includes("بو") && nWolf.includes(by("_wolf").fa));
assert.ok(!/\d/.test(nWolf));
assert.ok(nb({ noticed: true, mode: "attack", sense: "web" }, spider).includes("تار"));
const nSight = nb(seen, bandit);
assert.ok(nSight.includes("رودررو") && nSight.includes("حمله نکرده"));
assert.equal(nb(hid, wolf), "");
assert.equal(nb(null, wolf), "");
ok("یادداشت راوی: بو، تار، رودررو؛ بدون عدد؛ ناشناخته بی‌صدا");

// ۱۱) Snapshot: awareness و outcome و سازگاری قدیمی
assert.equal(readSnapshot(null).awareness, "unaware");
const noticed = readSnapshot(JSON.parse(JSON.stringify(markNoticed(wolf, "attack"))));
assert.equal(noticed.awareness, "noticed");
assert.equal(noticed.noticeMode, "attack");
assert.equal(markCleared(noticed, 50).awareness, "unaware");
assert.equal(markCleared(noticed, 50).outcome, "cleared");
assert.equal(markCleared(noticed, 50, "captured").outcome, "captured"); // قلاب V11
ok("Snapshot: awareness، outcome و قلاب V11");

// ۱۲) planEncounter: ادراک غیرفعال از fetchPp در Snapshot می‌ماند
const origRandom = Math.random;
Math.random = () => 0.4;
globalThis.__fakeFetch = async () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify({ monster: 1, count: 1 }) } }], usage: {} }),
});
const provider = { name: "fake", model: "m", url: "http://fake", apiKey: "k" };
const travel = {
  traveled: true, arrivalHour: 40,
  location: { name: "جنگل", theme: "t", tier: 2, hostility: "moderate", environments: ["forest"] },
};
const asked = [];
const r = await planEncounter({
  travel, partyLevels: [1, 1], forceProvider: provider,
  fetchPp: async (key) => (asked.push(key), 14),
});
const r2 = await planEncounter({
  travel, partyLevels: [1, 1], forceProvider: provider,
  fetchPp: async () => null,
});
Math.random = origRandom;
assert.equal(r.snapshot.composition[0].pp, 14);
assert.equal(r.snapshot.awareness, "unaware");
assert.equal(asked.length, 1);
assert.equal(r2.snapshot.composition[0].pp, null);
ok("planEncounter: pp از Open5e در Snapshot؛ شکست = null");

console.log(`📊 ${n} تست`);
