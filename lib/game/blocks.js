// بلوک‌های خروجی (V08، قدم ۱)
// همهٔ توابع این فایل خالص‌اند: نه دیتابیس، نه تلگرام، نه AI.
// کار: اسکریپت راوی ← بلوک‌های روایت/دیالوگ ← متن HTML تلگرام (با escape)

// تلگرام در حالت HTML فقط این سه نویسه را escape می‌خواهد
export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// «نام: «متن»» ← دیالوگ. نام حداکثر ۳ کلمه و ۲۴ نویسه است
const DIALOGUE_RE = /^\s*([^:：«»\n]{1,24}?)\s*[:：]\s*«([^»]+)»\s*$/;

// اگه «نام» شبیه جملهٔ روایی باشد («دانی گفت») دیالوگ حساب نمی‌شود
const SPEECH_VERBS = /(گفت|پرسید|غرید|فریاد|جواب|زمزمه|نجوا|داد زد)/;

function asDialogue(line) {
  const m = DIALOGUE_RE.exec(line);
  if (!m) return null;
  const speaker = m[1].trim();
  if (!speaker || speaker.split(/\s+/).length > 3) return null;
  if (SPEECH_VERBS.test(speaker)) return null;
  return { speaker, text: m[2].trim() };
}

// تبدیل اسکریپت راوی به دنباله‌ی بلوک‌ها
// خروجی: [{ type: "narration", lines: [string] }, { type: "dialogue", lines: [{speaker, text}] }]
// خط‌های هم‌نوع پشت‌سرهم یک بلوک می‌شوند؛ خط خالی داخل روایت جدا‌کنندهٔ پاراگراف است
// نشانهٔ جای نتیجه‌ی تاس داخل اسکریپت: ⟦check:a1⟧ (خط تنها)
const CHECK_MARKER_RE = /^⟦check:([A-Za-z0-9_-]{1,12})⟧$/;

export function parseScript(text) {
  const blocks = [];
  const lines = String(text ?? "")
    .replace(/\r/g, "")
    .split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    const last = blocks[blocks.length - 1];
    if (!line) {
      if (
        last &&
        last.type === "narration" &&
        last.lines[last.lines.length - 1] !== ""
      ) {
        last.lines.push("");
      }
      continue;
    }
    const mk = CHECK_MARKER_RE.exec(line);
    if (mk) {
      blocks.push({ type: "check", id: mk[1], lines: [] });
      continue;
    }
    const d = asDialogue(line);
    if (d) {
      if (last && last.type === "dialogue") last.lines.push(d);
      else blocks.push({ type: "dialogue", lines: [d] });
    } else if (last && last.type === "narration") {
      last.lines.push(line);
    } else {
      blocks.push({ type: "narration", lines: [line] });
    }
  }
  for (const b of blocks) {
    if (b.type !== "narration") continue;
    while (b.lines.length && b.lines[b.lines.length - 1] === "") b.lines.pop();
  }
  return blocks;
}

// یک بلوک ← متن HTML
export function renderBlock(block) {
  if (block.type === "check") return ""; // جای تاس را Composer پر می‌کند
  if (block.type === "dialogue") {
    const body = block.lines
      .map((l) => `<b>${escapeHtml(l.speaker)}</b>: «${escapeHtml(l.text)}»`)
      .join("\n");
    return `<blockquote>${body}</blockquote>`;
  }
  return escapeHtml(block.lines.join("\n"));
}

// بلوک سیستم: خط‌های ساده + جزئیات قابل‌جمع‌شدن
// ورودی: { lines: [string]، details: [string] }
// جزئیات (مثل «تاس 12 + توانایی 3 ...») داخل blockquote expandable می‌رود
export function renderSystemBlock({ lines = [], details = [] } = {}) {
  const plain = lines.filter(Boolean).map(escapeHtml).join("\n");
  const det = details.filter(Boolean).map(escapeHtml).join("\n");
  const parts = [];
  if (plain) parts.push(plain);
  if (det) parts.push(`<blockquote expandable>${det}</blockquote>`);
  return parts.join("\n");
}

// همهٔ بلوک‌های روایت/دیالوگ یک اسکریپت ← یک رشتهٔ HTML
// بین بلوک‌ها یک خط خالی؛ بلوک دیالوگ خودش با blockquote جدا دیده می‌شود
export function renderScript(text) {
  return parseScript(text).map(renderBlock).filter(Boolean).join("\n\n");
}

// شمارش کلمهٔ روایت (برای سقف‌های بعدی)؛ دیالوگ‌ها جدا شمرده می‌شوند
export function countWords(text) {
  const t = String(text ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

export function wordStats(blocks) {
  let narration = 0;
  let dialogue = 0;
  let dialogueLines = 0;
  for (const b of blocks) {
    if (b.type === "check") continue;
    if (b.type === "dialogue") {
      dialogueLines += b.lines.length;
      for (const l of b.lines) dialogue += countWords(l.text);
    } else {
      narration += countWords(b.lines.join(" "));
    }
  }
  return { narration, dialogue, dialogueLines };
}

// ---------- Composer (V08، قدم ۲) ----------
// صحنهٔ ساخته‌شده در event_plans.scene_text ذخیره می‌شود. صحنه‌های HTML با این نشانه شروع می‌شوند
// تا صحنه‌های قدیمی (متن ساده) هنوز درست ارسال و بازپخش شوند.
export const SCENE_HTML_MARK = "<!--html-->";
export const SCENE_PART_SEP = "\n<!--part-->\n";
export const SCENE_SAFE_LEN = 3800; // سقف تلگرام ۴۰۹۶ نویسه است؛ حاشیه برای تگ‌ها
export const MAX_SCENE_PARTS = 3;

export function packScene(parts) {
  return SCENE_HTML_MARK + parts.join(SCENE_PART_SEP);
}

// { html: false, parts: [متن ساده] } برای صحنهٔ قدیمی، { html: true, parts: [...] } برای جدید
export function unpackScene(text) {
  const t = String(text ?? "");
  if (!t.startsWith(SCENE_HTML_MARK)) return { html: false, parts: [t] };
  return {
    html: true,
    parts: t.slice(SCENE_HTML_MARK.length).split(SCENE_PART_SEP),
  };
}

// نمای یک‌تکه از صحنه (برای بازپخش و مقایسه)؛ نشانه‌ها برداشته می‌شوند
export function scenePlainView(text) {
  return unpackScene(text).parts.join("\n");
}

// اگه تلگرام HTML را نپذیرفت: تگ‌ها برداشته و escape برمی‌گردد
export function htmlToPlain(html) {
  return String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// یک تکهٔ بزرگ را در مرز خط می‌شکند؛ blockquote هر تکه دوباره بسته و باز می‌شود
function splitSegment(seg, limit) {
  if (seg.length <= limit) return [seg];
  const q = /^(<blockquote(?: expandable)?>)([\s\S]*)(<\/blockquote>)$/.exec(
    seg,
  );
  const open = q ? q[1] : "";
  const close = q ? q[3] : "";
  const room = Math.max(200, limit - open.length - close.length);
  const lines = (q ? q[2] : seg).split("\n");
  const out = [];
  let cur = "";
  const flush = () => {
    if (cur) out.push(open + cur + close);
    cur = "";
  };
  for (let line of lines) {
    while (line.length > room) {
      flush();
      out.push(open + line.slice(0, room) + close);
      line = line.slice(room);
    }
    if (cur && (cur + "\n" + line).length > room) flush();
    cur = cur ? cur + "\n" + line : line;
  }
  flush();
  return out;
}

// تکه‌ها را پشت‌سرهم (با یک خط خالی بین‌شان) در پیام‌هایی تا سقف می‌چیند
export function packSegments(segments, limit = SCENE_SAFE_LEN) {
  const pieces = segments
    .filter(Boolean)
    .flatMap((s) => splitSegment(s, limit));
  const parts = [];
  let cur = "";
  for (const p of pieces) {
    if (!cur) cur = p;
    else if ((cur + "\n\n" + p).length <= limit) cur += "\n\n" + p;
    else {
      parts.push(cur);
      cur = p;
    }
  }
  if (cur) parts.push(cur);
  if (parts.length > MAX_SCENE_PARTS) {
    console.warn(`⚠️ صحنه ${parts.length} پیام شد (سقف ${MAX_SCENE_PARTS})`);
  }
  return parts.length ? parts : [""];
}

// ---------- Layout Planner (V08، قدم ۷) ----------
// هر چیدمان فهرست جایگاه‌ها و ترتیبشان است؛ جایگاه خالی نمایش داده نمیشه.
// (چیدمان‌های نبرد، شروع بازی و Recap جدا و خارج از این مسیرند.)
export const LAYOUTS = {
  standard: ["time", "script", "system", "progress", "notice"], // اکتشاف، معما، گفتگو، بحران
  travel: ["time", "travel", "script", "system", "progress", "notice"],
  rest: ["time", "script", "notice", "progress"],
};

// نوع صحنه (و نتیجهٔ دور) ← نام چیدمان؛ ناشناخته = استاندارد
export function planLayout(sceneType) {
  const name =
    sceneType === "travel" || sceneType === "rest" ? sceneType : "standard";
  return { name, slots: LAYOUTS[name] };
}

function linesToSegment(v) {
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .flatMap((x) => String(x ?? "").split("\n"))
    .filter(Boolean)
    .map(escapeHtml)
    .join("\n");
}

// ساخت متن صحنه از جایگاه‌ها
// time/travel: یک خط؛ narration: اسکریپت راوی؛ diceLines/diceDetails: بلوک سیستم
// progress: خط‌های XP؛ notices: ردشده‌ها، استراحت و...؛ groups: نام قدیمی notices (سازگاری)
// خروجی: رشتهٔ آمادهٔ ذخیره در scene_text (با نشانهٔ HTML)
export function composeScene({
  sceneType = "explore",
  timeLine = "",
  travelLine = "",
  narration = "",
  checks = [], // [{ id, line, detail }]: هر چک کنار بخش همان اقدام می‌نشیند
  diceLines = [],
  diceDetails = [],
  progress = [],
  notices = [],
  groups = [],
  limit = SCENE_SAFE_LEN,
} = {}) {
  const layout = planLayout(sceneType);
  const placed = new Set();
  const slotSegments = {
    time: () => [escapeHtml(timeLine)],
    travel: () => [escapeHtml(travelLine)],
    // روایت تلاش ← نتیجه‌ی تاس همان اقدام ← روایت پیامد (جای تاس با نشانه‌ی ⟦check:id⟧)
    script: () =>
      parseScript(narration).map((b) => {
        if (b.type !== "check") return renderBlock(b);
        const c = checks.find((x) => x.id === b.id && !placed.has(x.id));
        if (!c) return "";
        placed.add(c.id);
        return renderSystemBlock({ lines: [c.line], details: [c.detail] });
      }),
    // چک‌هایی که راوی برایشان نشانه نگذاشته (و چک گروهی) مثل قبل بعد از روایت می‌آیند
    system: () => {
      const rest = checks.filter((c) => !placed.has(c.id));
      return [
        renderSystemBlock({
          lines: [...rest.map((c) => c.line), ...diceLines],
        }),
        renderSystemBlock({
          details: [...rest.map((c) => c.detail), ...diceDetails],
        }),
      ];
    },
    progress: () =>
      (Array.isArray(progress) ? progress : [progress]).map(linesToSegment),
    notice: () =>
      [...(Array.isArray(notices) ? notices : [notices]), ...groups].map(
        linesToSegment,
      ),
  };
  const segs = layout.slots.flatMap((slot) => slotSegments[slot]());
  return packScene(packSegments(segs, limit));
}

// ---------- خروجی راوی (V08، قدم ۳) ----------
// JSON راوی: { narration: اسکریپت، suggestions: [...]، newNames: [{name, role}] }
// newNames فعلاً فقط خوانده و لاگ می‌شود؛ ثبت NPC (Registration Gate) کار V12 است.
const MAX_NEW_NAMES = 3;
const MAX_SUGGESTIONS = 3;

function cleanLabel(v, max) {
  return String(v ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function readNewNames(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    // هم {name, role} و هم یک رشتهٔ ساده قبول است؛ بقیه نادیده گرفته می‌شود
    const name = cleanLabel(typeof item === "string" ? item : item?.name, 30);
    if (name.length < 2 || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      role: cleanLabel(typeof item === "object" ? item?.role : "", 30),
    });
    if (out.length >= MAX_NEW_NAMES) break;
  }
  return out;
}

export function readNarratorOutput(data) {
  // اول script ساختاریافته؛ اگه نبود narration رشته‌ای قدیمی
  const fromScript = scriptToText(data?.script);
  const narration =
    fromScript ||
    (typeof data?.narration === "string" ? data.narration.trim() : "");
  if (!narration) throw new Error("AI روایتی برنگردوند");
  const suggestions = Array.isArray(data.suggestions)
    ? data.suggestions
        .filter((s) => typeof s === "string" && s.trim())
        .map((s) => s.trim())
        .slice(0, MAX_SUGGESTIONS)
    : [];
  // نسخه‌ی چیدمان: همان اسکریپت با نشانه‌ی جای تاس (فقط برای Composer)
  const layoutScript = fromScript
    ? scriptToText(data.script, { markers: true })
    : narration;
  return {
    narration,
    layoutScript,
    suggestions,
    newNames: readNewNames(data.newNames),
  };
}

// ---------- خروجی ساختاریافتهٔ راوی (V08، قدم ۴) ----------
// مدل‌ها قرارداد «خط جدا در یک رشتهٔ متن» را قابل‌اعتماد رعایت نمی‌کنند؛ آیتم‌های JSON را رعایت می‌کنند.
// script: [{type:"narration", text}, {type:"dialogue", speaker, text}] ← همان رشتهٔ اسکریپتی که بقیهٔ سیستم می‌شناسد
function oneLine(v) {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function scriptToText(items, { markers = false } = {}) {
  if (!Array.isArray(items)) return "";
  const lines = []; // { kind, text }
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    if (it.type === "check") {
      // فقط در نسخه‌ی چیدمان؛ متن تمیز (برای تاریخچه و حافظه) نشانه ندارد
      const id = String(it.action ?? "").trim();
      if (markers && /^[A-Za-z0-9_-]{1,12}$/.test(id)) {
        lines.push({ kind: "c", text: `⟦check:${id}⟧` });
      }
      continue;
    }
    if (it.type === "dialogue") {
      const speaker = oneLine(String(it.speaker ?? "").replace(/[:：«»]/g, " "))
        .split(" ")
        .filter(Boolean)
        .slice(0, 3)
        .join(" ");
      const text = oneLine(String(it.text ?? "").replace(/[«»]/g, ""));
      if (speaker && text)
        lines.push({ kind: "d", text: `${speaker}: «${text}»` });
    } else {
      const text = oneLine(it.text);
      if (text) lines.push({ kind: "n", text });
    }
  }
  let out = "";
  lines.forEach((l, i) => {
    if (i === 0) out = l.text;
    else
      out +=
        (l.kind === "n" && lines[i - 1].kind === "n" ? "\n\n" : "\n") + l.text;
  });
  return out;
}

// ---------- نوع صحنه (V08، قدم ۴) ----------
// سقف‌ها از parameters.md («پیام و خروجی»)؛ تا بعد از تست مدل قابل‌تنظیم‌اند.
// سقف روی کل script (روایت و دیالوگ با هم) است.
export const SCENE_TYPES = {
  explore: { label: "اکتشاف", words: 120, tone: "توصیفی", rule: "" },
  social: {
    label: "گفتگو",
    words: 80,
    tone: "گفتگومحور",
    rule: "دست‌کم یک خط دیالوگ مستقیم از یک شخصیت غیربازیکن الزامی است.",
  },
  crisis: {
    label: "بحران",
    words: 190,
    tone: "ضربتی، جمله‌های کوتاه",
    rule: "حس فیزیکی و فوریت را نشان بده و ماجرا را خلاصه نکن.",
  },
  mystery: {
    label: "معما",
    words: 120,
    tone: "کنجکاوی و جزئیات",
    rule: "فقط یک سرنخ تازه نشان بده و معما را حل نکن.",
  },
  travel: {
    label: "سفر",
    words: 60,
    tone: "گذر و حس مسیر",
    rule: "نتیجه‌ی سفر و رسیدن به مکان جدید را بگو.",
  },
  rest: {
    label: "استراحت",
    words: 60,
    tone: "آرام",
    rule: "نتیجه‌ی استراحت را بگو، بدون عدد.",
  },
};
export const DEFAULT_SCENE_TYPE = "explore";

// سفر و استراحت را کد تعیین می‌کند؛ بقیه همان انتخاب Resolver است (نامعتبر = اکتشاف)
export function effectiveSceneType({
  traveled = false,
  rested = false,
  picked,
} = {}) {
  if (traveled) return "travel";
  if (rested) return "rest";
  return SCENE_TYPES[picked] && picked !== "travel" && picked !== "rest"
    ? picked
    : DEFAULT_SCENE_TYPE;
}

// یادداشت راوی (فقط به راوی می‌رسد)
export function sceneTypeNote(type) {
  const s = SCENE_TYPES[type] || SCENE_TYPES[DEFAULT_SCENE_TYPE];
  return (
    `\nنوع صحنه: ${s.label} — سقف ${s.words} کلمه برای کل script (روایت و دیالوگ با هم)؛ لحن: ${s.tone}.` +
    (s.rule ? ` ${s.rule}` : "")
  );
}
