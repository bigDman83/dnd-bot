// Validator خروجی راوی (V08، قدم ۵). همهٔ توابع خالص‌اند: نه دیتابیس، نه AI.
// خطای «سخت» یک بار بازنویسی می‌خواهد؛ «هشدار» فقط در trace می‌ماند.
import { SCENE_TYPES, parseScript, wordStats } from "lib/game/blocks";
import { ACTION_TYPES } from "lib/core/actions";

// سقف کلمه: مدل دقیق نمی‌شمارد، پس ۲۵٪ تلرانس
export const LENGTH_TOLERANCE = 1.25;

// ---------- متن فارسی ----------
export function normalizeFa(s) {
  return String(s ?? "")
    .replace(/[\u064B-\u065F\u0670]/g, "") // اعراب
    .replace(/\u200c/g, " ") // نیم‌فاصله
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u060C\u061B\u061F\u066A-\u066D\u06D4]/g, " ") // ، ؛ ؟ ٪ ۔
    .replace(/[^\u0600-\u06FFa-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  const n = normalizeFa(s);
  return n ? n.split(" ") : [];
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

// ---------- جداکردن راز کوئست (DM-Only) ----------
// بخش عمومی = تا اولین «اما/ولی/بلکه...»؛ بقیه راز است و به راوی داده نمیشه
const SECRET_MARKER = /(?:^|[\s،؛.؟!])(اما|امّا|ولی|لیکن)\s/;

export function splitPlot(fullPlot) {
  const text = String(fullPlot ?? "").trim();
  const m = SECRET_MARKER.exec(text);
  // مارکر باید بعد از چند کلمه بیاید (نه اول متن)
  if (!m || m.index < 15) return { publicText: text, secretText: "" };
  return {
    publicText: text.slice(0, m.index).replace(/[\s،؛.]+$/, ""),
    secretText: text.slice(m.index).trim(),
  };
}

// کلمه‌های رایج که هیچ‌وقت کلیدواژه‌ی راز نیستند (تا هشدار اشتباه کم باشد)
const STOP = new Set(
  (
    "که این آن را از به با در برای تا یا اما ولی بلکه هم نیز هر همه چون اگر تر ترین بود باشد است نیست هست " +
    "شد شود شوند می باید نباید کرد کنند کنید کرده کند خواهد دارد دارند دهد دهند متوجه واقعی اصلی یک دو سه " +
    "شیء چیز چیزی جادویی جادو مخفی پنهان راز رازها سرنوشت تغییر عاقبت بزرگ کوچک قدیمی کهن باستانی تاریک " +
    "روشن پیدا نشان داستان گروه بازیکن همان همین بعد قبل بین روی زیر پیش پس دیگر هیچ بسیار خود آنها ایشان " +
    "حقیقت حقیقی اسرار پشت درون اندازه نیست‌ نبود نخواهد شدن شده شدند کردن کنیم گفت دانست دانند"
  ).split(" "),
);

// کلمه‌های بخش راز که در بخش عمومی یا عنوان نیستند
export function dmOnlyKeywords(secretText, publicText = "", title = "") {
  const known = new Set([...tokens(publicText), ...tokens(title)]);
  const out = [];
  for (const t of tokens(secretText)) {
    if (t.length < 3 || STOP.has(t) || known.has(t) || out.includes(t))
      continue;
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

function hasKeyword(tokenList, kw) {
  // «عهد» با «عهدی» و «عهدها» هم تطبیق می‌کند (پسوند تا ۲ حرف)
  return tokenList.some(
    (t) => t === kw || (t.startsWith(kw) && t.length - kw.length <= 2),
  );
}

// ---------- Validator ----------
const TECH_TOKENS = new Set(["تاس", "dc", "d20"]);

function countWordsInText(s) {
  const t = String(s ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

function countWords(blocks) {
  const st = wordStats(blocks);
  return st.narration + st.dialogue;
}

// ورودی: { narration (اسکریپت)، suggestions، sceneType، playerNames، dmOnlyWords، bannedWords }
// خروجی: { errors: [{code, text}], warnings: [{code, text}] }
export function validateNarration({
  narration,
  sceneType = "explore",
  playerNames = [],
  dmOnlyWords = [],
  bannedWords = [],
  lenient = false, // تلاش دوم: نبودنِ نام (نه غلط‌بودنش) فقط هشدار است تا دور بسته نشود
}) {
  const errors = [];
  const warnings = [];
  const blocks = parseScript(narration);
  const allText = normalizeFa(narration);
  const allTokens = allText ? allText.split(" ") : [];

  // طول
  const scene = SCENE_TYPES[sceneType] || SCENE_TYPES.explore;
  const words = countWords(blocks);
  const hard = Math.ceil(scene.words * LENGTH_TOLERANCE);
  if (words > hard) {
    errors.push({
      code: "LENGTH",
      text: `روایت ${words} کلمه است؛ حداکثر ${scene.words} کلمه مجاز است`,
    });
  }

  // دیالوگ NPC در صحنه‌ی گفتگو
  if (sceneType === "social" && !blocks.some((b) => b.type === "dialogue")) {
    errors.push({
      code: "DIALOGUE_REQUIRED",
      text: "در صحنه‌ی گفتگو دست‌کم یک آیتم dialogue از یک شخصیت غیربازیکن لازم است",
    });
  }

  // نام بازیکن‌ها (و اشتباه املایی نزدیک)
  // نام چندکلمه‌ای («هوشنگ امیر ابتهاج») با آمدن نام کامل یا یکی از کلمه‌هایش (مثل «هوشنگ») قبول است
  const forms = playerNames.map((name) => {
    const full = normalizeFa(name);
    return { name, full, toks: full.split(" ").filter((t) => t.length >= 3) };
  });
  for (const f of forms) {
    if (!f.full) continue;
    const present =
      allText.includes(f.full) || f.toks.some((t) => hasKeyword(allTokens, t));
    if (present) continue;
    const typo = allTokens.find(
      (t) =>
        t.length >= 3 &&
        !f.toks.includes(t) &&
        f.toks.some((ft) => editDistanceAtMostOne(t, ft)),
    );
    if (typo) {
      errors.push({
        code: "PLAYER_NAME_TYPO",
        text: `نام «${f.name}» اشتباه نوشته شده («${typo}»)؛ دقیقاً «${f.name}» بنویس`,
      });
    } else {
      const item = {
        code: "PLAYER_NAME_MISSING",
        text: `نام «${f.name}» در روایت نیامده (دست‌کم اسم کوچکش را بنویس)`,
      };
      (lenient ? warnings : errors).push(item);
    }
  }

  // دیالوگ برای شخصیت بازیکن ممنوع است
  for (const b of blocks) {
    if (b.type !== "dialogue") continue;
    for (const l of b.lines) {
      const sp = normalizeFa(l.speaker);
      if (
        forms.some(
          (f) =>
            f.full &&
            (sp === f.full ||
              f.toks.includes(sp) ||
              sp.startsWith(f.full + " ")),
        )
      ) {
        errors.push({
          code: "NPC_ONLY",
          text: `برای شخصیت بازیکن «${l.speaker}» دیالوگ ننویس؛ dialogue فقط برای شخصیت‌های غیربازیکن است`,
        });
        break;
      }
    }
  }

  // اصطلاح فنی یا پرانتز/براکت
  const rawNarration = String(narration ?? "");
  if (
    /[()\[\]]/.test(rawNarration) ||
    allTokens.some((t) => TECH_TOKENS.has(t.toLowerCase())) ||
    /skill\s*check|چک مهارت/i.test(rawNarration)
  ) {
    errors.push({
      code: "TECH_TERM",
      text: "در متن روایت هرگز پرانتز، براکت یا اصطلاح فنی (تاس، DC، چک مهارت) ننویس",
    });
  }

  // نشت اطلاعات DM-Only در روایت یا پیشنهادها
  const leaked = dmOnlyWords.filter((kw) => hasKeyword(allTokens, kw));
  if (leaked.length) {
    errors.push({
      code: "DM_ONLY",
      text: `کلمه‌ی «${leaked.join("، ")}» اطلاعات پنهان داستان است و نباید در روایت بیاید`,
    });
  }

  // هشدارها (بازنویسی نمی‌خواهند)
  const banned = bannedWords.filter((w) => allText.includes(normalizeFa(w)));
  if (banned.length) {
    warnings.push({
      code: "BANNED_WORD",
      text: `کلمه‌ی ضدتکرار آمده: ${banned.join("، ")}`,
    });
  }
  // سقف دیالوگ: حداکثر ۴ خط پشت‌سرهم و حدود ۲۵ کلمه برای هر خط (با تلرانس)؛ فقط هشدار
  const dialogueWords = (l) => countWordsInText(l.text);
  if (
    blocks.some(
      (b) =>
        b.type === "dialogue" &&
        (b.lines.length > 4 || b.lines.some((l) => dialogueWords(l) > 31)),
    )
  ) {
    warnings.push({
      code: "DIALOGUE_LONG",
      text: "دیالوگ از سقف (۴ خط، حدود ۲۵ کلمه برای هر خط) بلندتر است",
    });
  }
  if (
    blocks.some(
      (b) => b.type === "narration" && /«[^»]+»/.test(b.lines.join(" ")),
    )
  ) {
    warnings.push({
      code: "INLINE_QUOTE",
      text: "داخل روایت گیومه‌ی «» آمده (احتمال گفته‌ی NPC وسط پاراگراف)",
    });
  }
  return { errors, warnings };
}

// متن یادآوری برای بازنویسی
export function rewriteReminder(errors) {
  const list = errors.map((e) => `- ${e.text}`).join("\n");
  return `\n\nنسخه‌ی قبلی رد شد چون:\n${list}\nهمان رویدادها را با همان قالب JSON (آرایه‌ی script) دوباره و بدون این ایرادها بنویس.`;
}

// ---------- اعتبارسنجی پیشنهادها (V08، قدم ۶) ----------
// AI پیشنهاد می‌دهد، کد اعتبارسنجی می‌کند؛ پیشنهاد غیرشدنی فقط «حذف» می‌شود (بازنویسی نمی‌شود)
const TOOL_FA = {
  thieves_tools: "ابزار دزدی",
  forgery_kit: "ابزار جعل",
};

// اقدام‌هایی که ابزار «الزامی» دارند، از روی متن پیشنهاد (فقط همین سه نوع می‌توانند غیرشدنی باشند)
const REQUIRED_TOOL_PATTERNS = [
  [
    "lockpick",
    (s) => s.includes("قفل") && /(باز کن|باز کرد|باز می|گشا|دستکاری)/.test(s),
  ],
  [
    "disarm_trap",
    (s) =>
      s.includes("تله") &&
      /(خنثی|غیرفعال|از کار بیندازید|از کار بینداز|باز کن)/.test(s),
  ],
  ["forge_document", (s) => /(^| )جعل/.test(s)],
];

export function requiredActionFor(text) {
  const s = normalizeFa(text);
  const hit = REQUIRED_TOOL_PATTERNS.find(([, test]) => test(s));
  return hit ? ACTION_TYPES.find((a) => a.key === hit[0]) : null;
}

// groupToolTags: اتحاد ابزار شخصیت‌های زنده‌ی گروه (پیشنهاد برای «گروه» است)
export function validateSuggestions({
  suggestions = [],
  dmOnlyWords = [],
  groupToolTags = [],
}) {
  const valid = [];
  const removed = [];
  for (const raw of suggestions) {
    const text = String(raw ?? "").trim();
    if (!text) continue;
    const toks = tokens(text);
    const leaked = dmOnlyWords.find((kw) => hasKeyword(toks, kw));
    if (leaked) {
      removed.push({
        code: "DM_ONLY",
        text: `پیشنهاد «${text}» کلمه‌ی پنهان «${leaked}» را دارد`,
      });
      continue;
    }
    const need = requiredActionFor(text);
    if (need && !groupToolTags.includes(need.toolTag)) {
      removed.push({
        code: "FEAS_MISSING_TOOL",
        text: `پیشنهاد «${text}» ${TOOL_FA[need.toolTag] || "ابزاری"} می‌خواهد که گروه ندارد`,
      });
      continue;
    }
    valid.push(text);
  }
  return { valid, removed };
}

// قاعده‌ی کمبود: کمتر از ۲ پیشنهاد شدنی = هیچ (فقط «✍️» و «⏭» نشان داده می‌شود)
export const MIN_SUGGESTIONS = 2;
export function finalizeSuggestions(valid) {
  return valid.length >= MIN_SUGGESTIONS ? valid.slice(0, 3) : [];
}
