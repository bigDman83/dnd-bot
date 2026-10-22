import { _initRuntime } from "sdk";
import handleMessage from "../handlers/message.js";
import handleCallbackQuery from "../handlers/callback_query.js";
import { markUpdateProcessed } from "../handlers/dedupe.js";
import { runWithBudget } from "../lib/core/budget.js";

export default {
  async fetch(request, env, ctx) {
    _initRuntime(env);

    if (request.method !== "POST") {
      return new Response("DnD Bot is running. 🎲");
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    try {
      // وب‌هوک تکراری (تلگرام وقتی جواب دیر برسه دوباره می‌فرسته) پردازش نمی‌شه
      if (!(await markUpdateProcessed(update.update_id))) {
        console.log(`⏭ update تکراری رد شد: ${update.update_id}`);
        return new Response("OK");
      }
      await runWithBudget(async () => {
        if (update.message) await handleMessage(update.message);
        if (update.edited_message)
          await handleMessage(update.edited_message, { edited: true });
        if (update.callback_query)
          await handleCallbackQuery(update.callback_query);
      });
    } catch (err) {
      console.error("Handler error:", err);
    }

    // تلگرام فقط منتظر ۲۰۰ سریع می‌مونه؛ خودِ پیام‌ها با api.sendMessage جدا ارسال میشن
    return new Response("OK");
  },
};
