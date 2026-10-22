import { handleCallback as handleCreationCallback } from "lib/character/characterCreation";
import {
  onExpectedPlayers,
  onReady,
  onMakeCharacter,
  onPickCharacter,
} from "./callbacks/lobby.js";
import {
  onSuggestion,
  onSuggestionSkip,
  onRoundGo,
  onRoundUnlock,
} from "./callbacks/round.js";
import { onAttack, onDefend, onHelp, onHide } from "./callbacks/combat.js";

// هر دکمه با پیشوند callback_data خودش شناخته می‌شه. ترتیب مهمه: اولین مورد مطابق گرفته می‌شه
// (sug_ و sug_skip هم‌پیشوندن، پس اولی صریحاً sug_skip رو کنار می‌ذاره)
const ROUTES = [
  // لابی
  [(d) => d.startsWith("sp_expected_"), onExpectedPlayers],
  // دور
  [(d) => d.startsWith("sug_") && !d.startsWith("sug_skip"), onSuggestion],
  [(d) => d.startsWith("sug_skip"), onSuggestionSkip],
  [(d) => d.startsWith("round_go_"), onRoundGo],
  // نبرد
  [(d) => d.startsWith("round_unlock_"), onRoundUnlock],
  [(d) => d.startsWith("cmb_atk_"), onAttack],
  [(d) => d === "cmb_def", onDefend],
  [(d) => d.startsWith("cmb_help_"), onHelp],
  [(d) => d === "cmb_hide", onHide],
  // لابی (ادامه)
  [(d) => d === "ready", onReady],
  [(d) => d.startsWith("mkchar_"), onMakeCharacter],
  [(d) => d.startsWith("pick_char_"), onPickCharacter],
];

export default async function (callbackQuery) {
  const ctx = {
    callbackQuery,
    data: callbackQuery.data,
    chatId: callbackQuery.message.chat.id,
    messageId: callbackQuery.message.message_id,
    from: callbackQuery.from,
  };

  // اول چک کن آیا این دکمه مربوط به فرآیند شخصیت‌سازیه (پیشوند cc_)
  if (ctx.data.startsWith("cc_")) {
    const handled = await handleCreationCallback(
      ctx.chatId,
      ctx.from.id,
      ctx.messageId,
      ctx.data,
      callbackQuery.id,
    );
    if (handled !== false) return;
  }

  const route = ROUTES.find(([matches]) => matches(ctx.data));
  if (route) await route[1](ctx);
}
