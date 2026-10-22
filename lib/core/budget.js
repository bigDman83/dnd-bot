import { AsyncLocalStorage } from "node:async_hooks";

// تلگرام بعد از ۶۰ ثانیه اتصال وب‌هوک رو قطع می‌کنه و Cloudflare درخواست رو می‌کشه؛
// پس کل کار یک درخواست باید زودتر تموم بشه (۱۰ ثانیه جا برای ارسال پیام‌ها و دیتابیس)
export const REQUEST_BUDGET_MS = 50000;

const storage = new AsyncLocalStorage();

// همه‌ی کار یک update رو داخل این بودجه اجرا می‌کنه
export function runWithBudget(fn, ms = REQUEST_BUDGET_MS) {
  return storage.run({ deadline: Date.now() + ms }, fn);
}

// چند میلی‌ثانیه از بودجه مونده؟ (بیرون از runWithBudget: بی‌نهایت، یعنی بدون محدودیت)
export function remainingMs() {
  const store = storage.getStore();
  return store ? store.deadline - Date.now() : Infinity;
}
