import { TOOL_LABELS_FA } from "lib/core/dndData";

// اقدام‌های ردشده (impossible / missing) و بدون‌ریسک (auto) از خروجی Resolver.
// توابع خالص؛ هیچ AI و دیتابیسی صدا زده نمیشه.

const WHY_FA = {
  dead: "این شخصیت مرده",
  unconscious: "این شخصیت بیهوشه",
  world_rule: "این کار خارج از قوانین این دنیاست",
};
const WHY_DEFAULT_FA = "این کار الان ممکن نیست";
const WHY_CONDITION_FA = "این شخصیت الان نمی‌تونه کاری بکنه";

// نسخهٔ ذخیره‌شدنی (داخل event_plans.plan)؛ فقط داده‌ی ساده
// text = شرح کوتاه AI از تلاش؛ why = دلیل کد برای impossible (dead، unconscious، world_rule، یا نام Condition)
export function serializeBlocked(blocked) {
  return (blocked || []).map((b) => ({
    tgId: b.player?.tgId ?? null,
    name: b.player?.name ?? "",
    actionKey: b.actionKey,
    actionFa: b.actionFa,
    text: b.text || "",
    outcome: b.outcome,
    kind: b.kind ?? null,
    why: b.outcome === "impossible" ? (b.reason ?? null) : null,
    missingTool: b.missingTool ?? null,
    spell: b.spell ?? null,
    alternatives: b.alternatives || [],
    code: b.code ?? null,
  }));
}

export function serializeAutos(autos) {
  return (autos || []).map((a) => ({
    tgId: a.player?.tgId ?? null,
    name: a.player?.name ?? "",
    actionKey: a.actionKey,
    text: a.reason || "",
  }));
}

function whatOf(b) {
  if (b.text) return b.text;
  // «سایر اقدام‌ها» نباید در پیام بیاید
  return b.actionKey && b.actionKey !== "other" ? b.actionFa : "این اقدام";
}

function whyOf(b) {
  if (WHY_FA[b.why]) return WHY_FA[b.why];
  if (b.code === "FEAS_CONDITION_BLOCK") return WHY_CONDITION_FA;
  return WHY_DEFAULT_FA;
}

// بلوک یادداشت راوی (قطعی؛ بدون اصطلاح فنی)
export function blockedNarratorText(blocked) {
  if (!blocked?.length) return "";
  const lines = blocked.map((b) => {
    const what = whatOf(b);
    if (b.kind === "tool") {
      const tool = TOOL_LABELS_FA[b.missingTool] || "ابزار لازم";
      const alts = b.alternatives?.length
        ? ` راه‌های دیگه‌ای که توی داستان می‌شه بهشون اشاره کرد: ${b.alternatives.join("؛ ")}.`
        : "";
      return `- ${b.name} — «${what}»: ابزار لازمش (${tool}) رو نداره، پس این کار انجام نشد.${alts}`;
    }
    if (b.kind === "spell") {
      const sp = b.spell ? ` «${b.spell}»` : "";
      return `- ${b.name} — «${what}»: اسپل${sp} رو بلد نیست، پس اتفاقی نیفتاد.`;
    }
    return `- ${b.name} — «${what}»: ${whyOf(b)}، پس انجام نشد.`;
  });
  return (
    "\n\nاقدام‌هایی که اصلاً انجام نشدن (قطعی و غیرقابل‌تغییر؛ موفق یا نیمه‌موفق نشونشون نده، " +
    "فقط به شکل طبیعی و بدون هیچ اصطلاح فنی روایت کن که انجام نشد و چرا):\n" +
    lines.join("\n")
  );
}

// خط‌های تضمین‌شده و مستقل از AI زیر روایت (مثل خط‌های تاس)
export function blockedToDiceText(blocked) {
  return (blocked || [])
    .map((b) => {
      const what = whatOf(b);
      if (b.kind === "tool") {
        const tool = TOOL_LABELS_FA[b.missingTool] || "ابزار لازم";
        const alts = b.alternatives?.length
          ? ` — راه‌های دیگه: ${b.alternatives.join(" / ")}`
          : "";
        return `🚫 ${b.name} — ${what}: ${tool} نداره${alts}`;
      }
      if (b.kind === "spell") {
        return `🚫 ${b.name} — ${what}: این اسپل رو بلد نیست`;
      }
      return `🚫 ${b.name} — ${what}: ${whyOf(b)}`;
    })
    .join("\n");
}

// خلاصهٔ فشرده برای decision و trace (فقط ID و کد)
export function summarizeBlocked(blocked) {
  return (blocked || []).map((b) => ({
    tgId: b.player?.tgId ?? b.tgId ?? null,
    action: b.actionKey,
    outcome: b.outcome,
    kind: b.kind ?? null,
    code: b.code ?? null,
  }));
}

// ---------- مرحله‌های انجام‌نشده‌ی زنجیره (مرحله‌ی قبل موفق نشد، یا سقف زنجیره پر شد) ----------

export function serializeSkipped(skipped) {
  return (skipped || []).map((k) => ({
    tgId: k.player?.tgId ?? k.tgId ?? null,
    name: k.player?.name ?? k.name ?? "",
    actionKey: k.actionKey ?? null,
    actionId: k.actionId ?? null,
    text: k.text || "",
    parentText: k.parentText || "",
    why: k.why,
    step: k.step ?? null,
    total: k.total ?? null,
    chainId: k.chainId ?? null,
  }));
}

function skippedWhat(k) {
  return k.text || "این کار";
}
function skippedParent(k) {
  return k.parentText ? `«${k.parentText}»` : "مرحله‌ی قبل";
}

export function skippedNarratorText(skipped) {
  if (!skipped?.length) return "";
  const lines = skipped.map((k) =>
    k.why === "deferred"
      ? `- ${k.name} — «${skippedWhat(k)}»: در این دور وقت نشد؛ می‌تونه توی دور بعد ادامه بده.`
      : `- ${k.name} — «${skippedWhat(k)}»: ${skippedParent(k)} موفق نشد، پس این مرحله اصلاً انجام نشد.`,
  );
  return (
    "\n\nمرحله‌هایی که انجام نشدن (قطعی؛ انجام‌شده یا نیمه‌انجام‌شده نشونشون نده، " +
    "فقط طبیعی و بدون اصطلاح فنی بگو کار به اینجا نرسید):\n" +
    lines.join("\n")
  );
}

export function skippedToDiceText(skipped) {
  return (skipped || [])
    .map((k) =>
      k.why === "deferred"
        ? `⏭ ${k.name} — ${skippedWhat(k)}: به دور بعد می‌رود`
        : `⛔ ${k.name} — ${skippedWhat(k)}: انجام نشد، چون ${skippedParent(k)} موفق نشد`,
    )
    .join("\n");
}

export function summarizeSkipped(skipped) {
  return (skipped || []).map((k) => ({
    tgId: k.player?.tgId ?? k.tgId ?? null,
    action: k.actionId ?? null,
    why: k.why,
    step: k.step ?? null,
  }));
}
