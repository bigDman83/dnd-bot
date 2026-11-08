import assert from "node:assert/strict";
import { tables } from "./fake_sdk.mjs";
import {
  planEncounter,
  pickEnemy,
  encounterNarratorNote,
  enemyPool,
  readSnapshot,
} from "lib/combat/encounter";
import { COMBAT_MENU } from "lib/combat/monsters";

let n = 0;
const ok = (m) => console.log("✅", ++n, m);

let replies = [];
const seen = [];
globalThis.__fakeFetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  seen.push({ prompt: body.messages.at(-1).content });
  const content = replies.length > 1 ? replies.shift() : replies[0];
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }], usage: {} }),
  };
};
const provider = { name: "fake", model: "m", url: "http://fake", apiKey: "k" };
const fixed = (v) => () => v;
const mkTravel = (over = {}) => ({
  traveled: true,
  arrivalHour: 40,
  location: {
    name: "غار تاریک",
    theme: "غاری نمناک در دل کوه",
    tier: 2,
    hostility: "moderate",
    environments: ["dungeon", "mountain"],
    ...over,
  },
});

// ۱) سفر نبوده ← null
assert.equal(
  await planEncounter({ travel: null, forceProvider: provider }),
  null,
);
assert.equal(
  await planEncounter({ travel: { traveled: false }, forceProvider: provider }),
  null,
);
ok("بدون سفر ← بدون Gate");

// ۲) hostility=none ← Skip و Snapshot ندارد
const sk = await planEncounter({
  travel: mkTravel({ hostility: "none" }),
  forceProvider: provider,
});
assert.equal(sk.snapshot, null);
assert.equal(sk.info.action, "skip");
assert.equal(sk.info.reason, "no_hostility");
assert.equal(seen.length, 0, "AI صدا زده نشد");
ok("hostility=none ← Skip بدون تماس AI");

// ۳) ROLL با AI: شماره‌ی معتبر؛ پرامپت فقط مکان و منو دارد
const travel = mkTravel();
const { pool } = enemyPool(2, travel.location.environments, "moderate");
replies = [JSON.stringify({ monster: 1, count: 9 })];
const origRandom = Math.random;
Math.random = () => 0.4; // d20 = 9 ← متوسط
const r = await planEncounter({
  travel,
  partyLevels: [1, 1],
  forceProvider: provider,
});
Math.random = origRandom;
assert.equal(r.info.action, "roll");
assert.equal(r.info.difficulty, "medium");
assert.equal(r.info.band, "moderate");
assert.equal(r.snapshot.status, "Rolled");
assert.equal(r.snapshot.composition[0].key, pool[0].key);
assert.ok(
  r.snapshot.composition[0].count <= 6 && r.snapshot.composition[0].count >= 1,
);
assert.equal(r.snapshot.engaged, false);
const prompt = seen.at(-1).prompt;
assert.ok(prompt.includes("غار تاریک") && prompt.includes("1) "));
assert.ok(
  !prompt.includes("moderate") && !prompt.includes("hostility"),
  "خصومت و کلاس بودجه به AI نمی‌رسد",
);
ok("ROLL: Snapshot با ترکیب معتبر و پرامپت بدون اطلاعات DM-Only");

// ۴) بودجه واقعاً تعداد را محدود می‌کند (گابلین کوچک ۲۵ XP، دو نفر سطح ۱، Low = ۱۰۰ ← حداکثر ۴)
const lowTravel = mkTravel({ hostility: "moderate", environments: ["forest"] });
const { pool: lp } = enemyPool(2, ["forest"], "low");
const gi = lp.findIndex((m) => m.key.endsWith("goblin-minion")) + 1;
assert.ok(gi > 0);
replies = [JSON.stringify({ monster: gi, count: 6 })];
Math.random = () => 0.1; // d20 = 3 ← ساده ← Low
const r4 = await planEncounter({
  travel: lowTravel,
  partyLevels: [1, 1],
  forceProvider: provider,
});
Math.random = origRandom;
assert.equal(r4.info.band, "low");
assert.equal(r4.snapshot.composition[0].count, 2);
ok("بودجه تعداد را محدود می‌کند (۶ ← ۲ برای دو نفر)");

// ۵) hostility=low و تاس ۱–۵ ← خالی ← Cleared بدون تماس AI
seen.length = 0;
Math.random = () => 0.05;
const r5 = await planEncounter({
  travel: mkTravel({ hostility: "low" }),
  forceProvider: provider,
});
Math.random = origRandom;
assert.equal(r5.info.empty, true);
assert.equal(r5.snapshot.status, "Cleared");
assert.equal(r5.snapshot.composition.length, 0);
assert.equal(seen.length, 0);
ok("low + تاس کم ← خالی، بدون AI");

// ۶) شماره‌ی نامعتبر ← یک بار دوباره ← بعد انتخاب کد
seen.length = 0;
replies = [
  JSON.stringify({ monster: 99, count: 2 }),
  JSON.stringify({ monster: 2, count: 1 }),
];
const p6 = await pickEnemy({
  location: travel.location,
  pool,
  forceProvider: provider,
});
assert.equal(seen.length, 2);
assert.ok(seen[1].prompt.includes("در فهرست نبود"));
assert.equal(p6.entry, pool[1]);
assert.equal(p6.aiFallback, false);
seen.length = 0;
replies = ["نه json"];
const p7 = await pickEnemy({
  location: travel.location,
  pool,
  forceProvider: provider,
  rng: fixed(3),
});
assert.equal(p7.aiFallback, true);
assert.equal(p7.entry, pool[2]);
ok("AI نامعتبر: دوباره‌پرسی و بعد انتخاب کد");

// ۷) یادداشت راوی: فقط نشانه، بدون عدد و خصومت
const note = encounterNarratorNote({
  status: "Rolled",
  composition: [{ key: pool[0].key, count: 5 }],
  engaged: false,
});
assert.ok(note.includes(pool[0].fa) && note.includes("نشانه"));
assert.ok(!/\d/.test(note), "عددی در یادداشت نیست");
assert.equal(encounterNarratorNote(null), "");
assert.equal(encounterNarratorNote({ status: "Cleared", composition: [] }), "");
assert.equal(
  encounterNarratorNote({
    status: "Rolled",
    composition: [{ key: "x", count: 2 }],
    engaged: true,
  }),
  "",
);
ok("یادداشت راوی: فقط نشانه، بدون عدد؛ Cleared و engaged بی‌صدا");

// ۸) Snapshot قابل‌خواندن بعد از ذخیره در JSON
const back = readSnapshot(JSON.parse(JSON.stringify(r.snapshot)));
assert.equal(back.status, "Rolled");
assert.equal(back.composition.length, 1);
ok("Snapshot بعد از JSON درست خوانده می‌شود");

console.log(`📊 ${n} تست`);
