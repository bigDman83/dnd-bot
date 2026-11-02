import assert from "node:assert/strict";
import {
  SCENE_TYPES,
  effectiveSceneType,
  sceneTypeNote,
} from "lib/game/blocks";
import {
  validateDecision,
  buildSceneTypeMenuText,
  SCENE_MENU,
} from "lib/game/resolver";
import { DEFAULT_PROMPTS } from "lib/ai/defaultPrompts";
let n = 0;
const ok = (m) => console.log("✅", ++n, m);

// ۱) منو: فقط چهار نوع قابل‌انتخاب برای AI؛ سفر و استراحت با کد
assert.deepEqual(SCENE_MENU, ["explore", "social", "crisis", "mystery"]);
const menu = buildSceneTypeMenuText();
assert.ok(
  menu.includes("1) اکتشاف") &&
    menu.includes("2) گفتگو") &&
    menu.includes("3) بحران") &&
    menu.includes("4) معما"),
);
assert.ok(!menu.includes("سفر") && !menu.includes("استراحت"));
ok("منوی نوع صحنه ۴ مورد دارد و سفر/استراحت در آن نیست");

// ۲) validateDecision: شماره ← نوع؛ نامعتبر یا ننوشتن ← اکتشاف
const pick = (extra) =>
  validateDecision({ type: "narrative", ...extra }, [], { tier: 1 }).sceneType;
assert.equal(pick({ sceneType: 2 }), "social");
assert.equal(pick({ sceneType: "3" }), "crisis");
assert.equal(pick({ sceneType: 4 }), "mystery");
assert.equal(pick({ sceneType: 1 }), "explore");
for (const bad of [0, 5, 99, "x", null, -1])
  assert.equal(pick({ sceneType: bad }), "explore", String(bad));
assert.equal(pick({}), "explore");
assert.equal(validateDecision(null, [], { tier: 1 }).sceneType, "explore");
ok("شماره‌ی معتبر ← نوع صحنه؛ نامعتبر/ننوشتن/null ← اکتشاف");

// ۳) نوع نهایی: سفر و استراحت را کد تعیین می‌کند
assert.equal(
  effectiveSceneType({ traveled: true, picked: "social" }),
  "travel",
);
assert.equal(effectiveSceneType({ rested: true, picked: "crisis" }), "rest");
assert.equal(
  effectiveSceneType({ traveled: true, rested: true, picked: "social" }),
  "travel",
);
assert.equal(effectiveSceneType({ picked: "social" }), "social");
assert.equal(effectiveSceneType({ picked: "travel" }), "explore"); // AI نمی‌تواند سفر بدهد
assert.equal(effectiveSceneType({ picked: "rest" }), "explore");
assert.equal(effectiveSceneType({}), "explore");
assert.equal(effectiveSceneType(), "explore");
ok("effectiveSceneType: سفر/استراحت با کد، انتخاب نامعتبر AI ← اکتشاف");

// ۴) یادداشت راوی: سقف و الزام هر نوع
assert.ok(
  sceneTypeNote("social").includes("سقف 80 کلمه") &&
    sceneTypeNote("social").includes("دیالوگ مستقیم"),
);
assert.ok(
  sceneTypeNote("crisis").includes("سقف 190 کلمه") &&
    sceneTypeNote("crisis").includes("خلاصه نکن"),
);
assert.ok(sceneTypeNote("mystery").includes("یک سرنخ تازه"));
assert.ok(
  sceneTypeNote("travel").includes("سقف 60 کلمه") &&
    sceneTypeNote("rest").includes("بدون عدد"),
);
assert.ok(sceneTypeNote("explore").includes("سقف 120 کلمه"));
assert.equal(sceneTypeNote("unknown"), sceneTypeNote("explore"));
for (const k of Object.keys(SCENE_TYPES))
  assert.ok(!/تاس|DC|چک/.test(sceneTypeNote(k)), k);
ok("sceneTypeNote: سقف و الزام هر نوع، بدون اصطلاح فنی");

// ۵) پرامپت‌ها
const r = DEFAULT_PROMPTS.round_resolver;
assert.ok(
  r.includes('"time": N, "sceneType": N}') && r.includes("نوع صحنه: در هر دور"),
);
assert.ok(DEFAULT_PROMPTS.round_narrator.includes("بخش «نوع صحنه»"));
ok("پرامپت Resolver فیلد sceneType و پرامپت راوی ارجاع به سقف نوع صحنه دارد");

// ۶) اصلاح‌های پرامپت بعد از تست زنده (قدم ۴ب)
assert.ok(r.includes("خوندن نقش‌ها") && r.includes("ردپا"));
assert.ok(
  r.includes("هرگز با شماره‌ی ردیف خود اقدام") && r.includes("عبور مخفیانه"),
);
ok("پرامپت Resolver: مثال معما و هشدار اشتباه‌گرفتن شماره‌ی ردیف با نوع اقدام");
