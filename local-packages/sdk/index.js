import { drizzle } from "drizzle-orm/d1";

// چون D1 binding فقط داخل fetch handler در دسترسه (نه در زمان import)،
// این مقداردهی رو به تعویق می‌ندازیم و src/worker.js اول از همه صداش می‌زنه
let _dbInstance = null;
let _botToken = null;
let _ownerTgId = null;

export function _initRuntime(env) {
  _dbInstance = drizzle(env.DB);
  _botToken = env.TELEGRAM_BOT_TOKEN;
  // شناسه‌ی صاحب بات از secret؛ نبودنش (یا غیرعددی بودنش) = null = دستورهای صاحب بات خاموش
  // رقم‌های فارسی/عربی و فاصله‌ی اضافه هم قبول میشه (با کیبورد فارسی تایپ کردن secret رایجه)
  const raw = String(env.OWNER_TG_ID ?? "")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .trim();
  const owner = Number(raw);
  _ownerTgId = Number.isInteger(owner) && owner > 0 ? owner : null;
}

export function getOwnerTgId() {
  return _ownerTgId;
}

// یه Proxy که db واقعی رو لحظه‌ی استفاده (نه لحظه‌ی import) صدا می‌زنه
export const db = new Proxy(
  {},
  {
    get(_, prop) {
      if (!_dbInstance)
        throw new Error(
          "دیتابیس هنوز مقداردهی نشده — _initRuntime باید اول در worker.js صدا زده بشه",
        );
      const value = _dbInstance[prop];
      return typeof value === "function" ? value.bind(_dbInstance) : value;
    },
  },
);

export const fetch = globalThis.fetch;

async function tgCall(method, payload) {
  const res = await fetch(
    `https://api.telegram.org/bot${_botToken}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const data = await res.json();
  if (!data.ok)
    console.error(`⚠️ Telegram API error (${method}):`, data.description);
  return data.result;
}

export const api = {
  sendMessage: (p) => tgCall("sendMessage", p),
  editMessageText: (p) => tgCall("editMessageText", p),
  answerCallbackQuery: (p) => tgCall("answerCallbackQuery", p),
  getMe: () => tgCall("getMe", {}),
  deleteMessage: (p) => tgCall("deleteMessage", p),
  getChatMember: (p) => tgCall("getChatMember", p),
  editMessageReplyMarkup: (p) => tgCall("editMessageReplyMarkup", p),
};
