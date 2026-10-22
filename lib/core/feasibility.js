// Feasibility (طراحی V07، بخش 6): تابع خالص، بدون AI و بدون دیتابیس.
// ورودی: اقدام تجزیه‌شده + کارنامهٔ شخصیت. خروجی یکی از چهار نتیجه:
//   impossible | missing | auto | check

// منوی بستهٔ «مشکل اقدام» که AI فقط شماره‌اش را می‌دهد
export const ISSUES = ["none", "world_impossible", "spell_unknown"];
export const ISSUE_LABELS_FA = {
  none: "مشکلی نیست",
  world_impossible:
    "اقدام آشکارا خارج از قوانین این دنیاست (مثلاً کار غیرممکن یا اعلام واقعیتی که بازیکن حق تعیینش را ندارد)",
  spell_unknown: "بازیکن اسپلی را به کار برده که در فهرست اسپل‌های خودش نیست",
};

export function buildIssueMenuText() {
  const lines = ISSUES.map((k, i) => `${i + 1}) ${ISSUE_LABELS_FA[k]}`).join(
    "\n",
  );
  return `فهرست مشکل اقدام (اگه مطمئن نیستی شماره‌ی 1):\n${lines}`;
}

export function issueByIndex(i) {
  const n = Number(i);
  if (!Number.isInteger(n) || n < 1 || n > ISSUES.length) return "none";
  return ISSUES[n - 1];
}

// Conditionهایی که اقدام را کلاً ممنوع می‌کنند (فعلاً Conditionی در بازی ساخته نشده؛ قلاب آماده است)
export const BLOCKING_CONDITIONS = [
  "incapacitated",
  "paralyzed",
  "stunned",
  "unconscious",
  "petrified",
];

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

// actionType: یک عضو ACTION_TYPES؛ character: ردیف characters
// issue: خروجی issueByIndex؛ spell: اسم اسپل (اختیاری)؛ riskNone: Risk Gate گفته ریسکی نیست
export function checkFeasibility({
  actionType,
  character,
  issue = "none",
  spell = null,
  riskNone = false,
  conditions = [],
}) {
  const toolTags = asArray(character?.toolTags);
  const spells = asArray(character?.spellsKnown);

  // ۱) وضعیت شخصیت
  if (character?.dead) {
    return {
      outcome: "impossible",
      reason: "dead",
      code: "FEAS_CONDITION_BLOCK",
    };
  }
  if (Number.isFinite(character?.hp) && character.hp <= 0) {
    return {
      outcome: "impossible",
      reason: "unconscious",
      code: "FEAS_CONDITION_BLOCK",
    };
  }
  const blocking = asArray(conditions).find((c) =>
    BLOCKING_CONDITIONS.includes(c),
  );
  if (blocking) {
    return {
      outcome: "impossible",
      reason: blocking,
      code: "FEAS_CONDITION_BLOCK",
    };
  }

  // ۲) خارج از قوانین دنیا
  if (issue === "world_impossible") {
    return { outcome: "impossible", reason: "world_rule", code: null };
  }

  // ۳) اسپل ناشناخته (یا اسپلی که صریحاً داده شده ولی در فهرست نیست)
  if (issue === "spell_unknown" || (spell && !spells.includes(spell))) {
    return {
      outcome: "missing",
      kind: "spell",
      spell: spell || null,
      code: "FEAS_NOT_KNOWN",
    };
  }

  // ۴) ابزار لازم
  const role = actionType?.toolRole || "none";
  const needTool = actionType?.toolTag || null;
  const hasTool = !needTool || toolTags.includes(needTool);
  if (role === "required" && !hasTool) {
    return {
      outcome: "missing",
      kind: "tool",
      missingTool: needTool,
      alternatives: [...(actionType.alternatives || [])],
      code: "FEAS_MISSING_TOOL",
    };
  }

  // ۵) بدون ریسک ← بدون تاس
  if (riskNone) return { outcome: "auto", disadvantage: [] };

  // ۶) نیازمند چک؛ نبود ابزار کمکی = Disadvantage
  const disadvantage =
    role === "helpful" && !hasTool
      ? [{ source: "no_tool", tool: needTool }]
      : [];
  return { outcome: "check", disadvantage };
}
