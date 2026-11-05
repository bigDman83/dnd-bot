import assert from "node:assert/strict";
import {
  ENVIRONMENTS,
  POPULATION_STEPS,
  POPULATION_CAP,
  HOSTILITY_LEVELS,
  validateLocationDraft,
  buildPopulation,
  finalizeProfile,
  crowdLeft,
  populationText,
  addResidue,
  locationProfile,
  locationContextText,
  buildProfileMenuText,
} from "lib/world/locations";
let n = 0;
const ok = (m) => console.log("✅", ++n, m);
const base = {
  name: "میخانه",
  theme: "میخانه‌ای کوچک و دودگرفته کنار جاده",
  rules: [],
};
const v = (extra, opts = { askProfile: true }) =>
  validateLocationDraft({ ...base, ...extra }, opts);

// ۱) فهرست‌ها
assert.equal(ENVIRONMENTS.length, 10);
assert.equal(POPULATION_STEPS.length, 7);
assert.deepEqual(HOSTILITY_LEVELS, ["none", "low", "moderate", "high"]);
const menu = buildProfileMenuText();
assert.ok(
  menu.includes("1) جنگل") &&
    menu.includes("7) شلوغ") &&
    menu.includes("4) زیاد"),
);
ok("فهرست‌ها: ۱۰ محیط، ۷ پله، ۴ خصومت، منو ساخته می‌شود");

// ۲) اعتبارسنجی: شماره ← مقدار
let r = v({ environments: [1, 6], hostility: 3, pop: 4, roles: [2, 3] });
assert.deepEqual(r.problems, []);
assert.deepEqual(r.draft.environments, ["forest", "ruins"]);
assert.equal(r.draft.hostility, "moderate");
assert.equal(r.draft.popStep, 3);
assert.deepEqual(r.draft.roles, ["commoner", "merchant"]);
ok("شماره‌های معتبر به مقدار تبدیل می‌شوند");

// ۳) حداکثر ۴ محیط، تکراری حذف
r = v({ environments: [1, 1, 2, 3, 4, 5], hostility: 1, pop: 1 });
assert.equal(r.draft.environments.length, 4);
assert.ok(r.problems.some((p) => p.includes("حداکثر")));
r = v({ environments: [2, 2], hostility: 1, pop: 1 });
assert.deepEqual(r.draft.environments, ["snow"]);
ok("environments حداکثر ۴ و بدون تکرار");

// ۴) نامعتبرها: پیش‌فرض امن و مشکل ثبت می‌شود، fatal نه
r = v({ environments: [11, "x"], hostility: 9, pop: 0, roles: [7] });
assert.equal(r.fatal, false);
assert.equal(r.draft.hostility, "none");
assert.equal(r.draft.popStep, null);
assert.deepEqual(r.draft.environments, []);
assert.deepEqual(r.draft.roles, []);
assert.ok(r.problems.length >= 5);
r = v({});
assert.equal(r.draft.hostility, "none");
assert.equal(r.draft.popStep, null);
ok("نامعتبر/ننوشتن ← hostility=none، بدون جمعیت، مشکل ثبت می‌شود");

// ۵) بدون askProfile (پرامپت قدیمی) هیچ مشکلی اضافه نمی‌شود
r = validateLocationDraft({ ...base, hostility: 99 }, {});
assert.deepEqual(r.problems, []);
assert.equal(r.draft.hostility, "none");
assert.equal(r.draft.popStep, null);
ok("askProfile=false: رفتار قبلی، بدون مشکل تازه");

// ۶) buildPopulation: عدد داخل پله، سقف، ترکیب
for (let i = 0; i < POPULATION_STEPS.length; i++) {
  for (const rv of [0, 0.5, 0.999999]) {
    const p = buildPopulation(i, ["guard", "commoner", "merchant"], {
      rng: () => rv,
    });
    const s = POPULATION_STEPS[i];
    assert.ok(
      p.count >= s.min && p.count <= Math.min(s.max, POPULATION_CAP),
      `${i} ${rv} ${p.count}`,
    );
    assert.equal(
      p.composition.reduce((a, c) => a + c.count, 0),
      p.count,
    );
  }
}
assert.equal(buildPopulation(0, ["guard"]).count, 0);
assert.deepEqual(buildPopulation(0, ["guard"]).composition, []);
assert.equal(buildPopulation(6, [], { rng: () => 0.999999 }).count, 150);
assert.equal(buildPopulation(99, []), null);
for (let k = 0; k < 2000; k++) {
  const p = buildPopulation(k % 7, ["guard", "cleric"]);
  assert.equal(
    p.composition.reduce((a, c) => a + c.count, 0),
    p.count,
  );
}
ok("جمعیت: عدد داخل پله، سقف ۱۵۰، مجموع ترکیب = کل (۲۰۰۰ نمونه)");

// ۷) ترکیب: سهم ۶۰/۳۰/۱۰؛ بدون نقش ← مردم عادی؛ تکراری و ناشناس حذف
let p = buildPopulation(5, ["guard", "commoner", "merchant"], { rng: () => 0 });
assert.equal(p.count, 51);
assert.deepEqual(
  p.composition.map((c) => c.role),
  ["guard", "commoner", "merchant"],
);
assert.ok(
  p.composition[0].count > p.composition[1].count &&
    p.composition[1].count > p.composition[2].count,
);
p = buildPopulation(3, [], { rng: () => 0 });
assert.deepEqual(p.composition, [{ role: "commoner", count: 10 }]);
p = buildPopulation(3, ["guard", "guard", "alien"], { rng: () => 0 });
assert.deepEqual(p.composition, [{ role: "guard", count: 10 }]);
ok("ترکیب نقش‌ها: سهم رتبه‌ای، پیش‌فرض مردم عادی، تکراری/ناشناس حذف");

// ۸) finalizeProfile: مکان شروع حداکثر low
const hi = {
  hostility: "high",
  environments: ["ruins"],
  popStep: 2,
  roles: ["guard"],
};
assert.equal(finalizeProfile(hi, { isStart: true }).hostility, "low");
assert.equal(finalizeProfile(hi, { isStart: false }).hostility, "high");
assert.equal(
  finalizeProfile({ hostility: "none" }, { isStart: true }).hostility,
  "none",
);
const f = finalizeProfile(hi, { hours: 22.5, rng: () => 0 });
assert.equal(f.population.hours, 22.5);
assert.equal(f.population.count, 4);
assert.equal(finalizeProfile({ hostility: "low" }).population, null);
ok("finalizeProfile: خصومت شروع ≤ low، ساعت تخمین ثبت، بدون pop ← null");

// ۹) Registered + Crowd ≤ Population
assert.equal(crowdLeft({ count: 30 }, 3), 27);
assert.equal(crowdLeft({ count: 2 }, 5), 0);
assert.equal(crowdLeft(null, 1), 0);
ok("crowdLeft: هرگز منفی نمی‌شود و از جمعیت بیشتر نمی‌شود");

// ۱۰) Residue: سقف ۳ خط
let res = null;
res = addResidue(res, "الف");
res = addResidue(res, "ب");
res = addResidue(res, "ج");
res = addResidue(res, "د");
assert.deepEqual(res, ["ب", "ج", "د"]);
assert.deepEqual(addResidue(res, "ج"), ["ب", "د", "ج"]);
assert.deepEqual(addResidue(res, "  "), ["ب", "ج", "د"]);
assert.deepEqual(addResidue(["۱", "۲", "۳", "۴", "۵"], null), ["۳", "۴", "۵"]);
assert.equal(addResidue([], "x".repeat(300))[0].length, 120);
ok("Residue: حداکثر ۳ خط، جدیدترین آخر، تکراری جابه‌جا، خط طولانی کوتاه");

// ۱۱) Location Profile و سازگاری مکان قدیمی
const old = {
  id: 1,
  name: "دهکده",
  tier: 1,
  theme: "دهکده‌ای آرام کنار رود",
  rules: ["friendlyFolk"],
};
const prof = locationProfile(old);
assert.deepEqual(prof, {
  tier: 1,
  hostility: "none",
  environments: [],
  rules: ["friendlyFolk"],
  storyTags: [],
});
const oldText = locationContextText(old);
assert.equal(
  oldText,
  "مکان فعلی: دهکده — دهکده‌ای آرام کنار رود\nویژگی‌های محیط: مردم اینجا مهربان و خوش‌برخوردند",
);
ok("مکان قدیمی: پروفایل با پیش‌فرض و متن Context بدون تغییر");

// ۱۲) متن Context مکان تازه: محیط و جمعیت هست، tier و hostility نیست
const neu = {
  ...old,
  tier: 3,
  hostility: "high",
  environments: ["ruins", "dungeon"],
  population: buildPopulation(3, ["guard"], { rng: () => 0 }),
};
const t = locationContextText(neu);
assert.ok(t.includes("نوع محیط: ویرانه، سیاه‌چال یا غار"));
assert.ok(t.includes("جمعیت حاضر: حدود 10 نفر (نگهبان: 10)"));
assert.ok(!t.includes("high") && !t.includes("خصومت") && !t.includes("سطح"));
assert.ok(populationText(buildPopulation(0, [])).includes("کسی اینجا نیست"));
assert.equal(populationText(null), "");
ok("Context راوی: محیط و جمعیت دارد؛ tier/hostility درز نمی‌کند");

// ۱۳) پرامپت location_builder: فیلدهای تازه و ممنوعیت اصطلاح فنی
import { DEFAULT_PROMPTS } from "lib/ai/defaultPrompts";
const lp = DEFAULT_PROMPTS.location_builder;
for (const key of [
  '"environments": [N, N]',
  '"hostility": N',
  '"pop": N',
  '"roles": [N, N]',
  '"tier": N',
]) {
  assert.ok(lp.includes(key), key);
}
assert.ok(lp.includes("مجلس رقص") && lp.includes("میخانه"));
assert.ok(lp.includes("خصومت») یا «جمعیت»") || lp.includes("«خصومت»، «جمعیت»"));
ok("پرامپت location_builder فیلدهای تازه و لنگرهای جمعیت را دارد");
