import { continueAfterCombat } from "lib/game/narrator";
import {
  getCombatView,
  takePlayerAttack,
  takePlayerDefend,
  takePlayerHelp,
  takePlayerHide,
  presentCombatResult,
} from "lib/combat/combat";
import { toast } from "./common.js";

// دکمه‌های نبرد فقط برای صاحب نوبتِ فعلی کار می‌کنن؛ اگه نوبت اونه، نمای فعلی نبرد رو برمی‌گردونه
async function requireYourTurn(ctx) {
  const before = await getCombatView(ctx.chatId);
  const actor = before?.state.turnOrder[before.state.currentTurnIndex];
  if (
    !before ||
    !actor ||
    actor.type !== "player" ||
    actor.tgId !== ctx.from.id
  ) {
    await toast(ctx, "الان نوبت تو نیست!");
    return null;
  }
  return before;
}

// الگوی مشترک هر چهار دکمه: چک نوبت → اجرای اکشن → خطا یا نمایش نتیجه (و ادامه‌ی داستان بعد از پیروزی)
async function runCombatAction(ctx, { act, success, failText }) {
  const { chatId, from } = ctx;
  const before = await requireYourTurn(ctx);
  if (!before) return;

  const result = await act(chatId, from.id);
  if (!result.ok) {
    await toast(ctx, failText(result));
    return;
  }

  await toast(ctx, success);
  await presentCombatResult(chatId, result, before.state.turnMessageId);
  if (result.outcome === "victory") {
    await continueAfterCombat(chatId, result.finished?.log);
  }
}

const ATTACK_FAIL_TEXT = {
  bad_target: "این هدف دیگه معتبر نیست",
  down: "بیهوشی، نمی‌تونی حمله کنی",
  stale: "یکی زودتر از تو زد!",
  not_your_turn: "الان نوبت تو نیست!",
  no_combat: "این نبرد دیگه در جریان نیست",
};

const RETRY_TEXT = "نشد، دوباره امتحان کن";

// حمله به یه دشمن (cmb_atk_<شناسه‌ی دشمن>)
export function onAttack(ctx) {
  const targetId = ctx.data.replace("cmb_atk_", "");
  return runCombatAction(ctx, {
    act: (chatId, tgId) => takePlayerAttack(chatId, tgId, targetId),
    success: "⚔️ زدی!",
    failText: (result) => ATTACK_FAIL_TEXT[result.reason] || "نشد",
  });
}

export function onDefend(ctx) {
  return runCombatAction(ctx, {
    act: takePlayerDefend,
    success: "🛡 حالت دفاعی گرفتی!",
    failText: () => RETRY_TEXT,
  });
}

// کمک به یه هم‌تیمی (cmb_help_<شناسه‌ی شخصیت>)
export function onHelp(ctx) {
  const targetCharId = ctx.data.replace("cmb_help_", "");
  return runCombatAction(ctx, {
    act: (chatId, tgId) => takePlayerHelp(chatId, tgId, targetCharId),
    success: "🤝 کمک کردی!",
    failText: (result) =>
      result.reason === "bad_target" ? "این هدف معتبر نیست" : RETRY_TEXT,
  });
}

export function onHide(ctx) {
  return runCombatAction(ctx, {
    act: takePlayerHide,
    success: "🫥 تلاش کردی پنهان بشی!",
    failText: () => RETRY_TEXT,
  });
}
