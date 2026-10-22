import { db } from "sdk";
import { sql } from "sdk/db";
import { processedUpdates } from "schema";

// چند update آخر نگه داشته بشه (جدول حلقویه)
const KEEP = 1000;
// هر چند update یک بار پاک‌سازی انجام بشه (تا نوشتن اضافه روی D1 کم بمونه)
const CLEAN_EVERY = 50;

// true = update جدیده، پردازشش کن. false = قبلاً پردازش شده (تکراری).
// اگه خود دیتابیس خطا بده، بازی نباید از کار بیفته؛ پس true برمی‌گردونیم.
export async function markUpdateProcessed(updateId) {
  if (typeof updateId !== "number") return true;
  try {
    const inserted = await db
      .insert(processedUpdates)
      .values({ updateId })
      .onConflictDoNothing()
      .returning()
      .all();
    if (inserted.length === 0) return false;

    if (updateId % CLEAN_EVERY === 0) {
      await db
        .delete(processedUpdates)
        .where(
          sql`${processedUpdates.updateId} NOT IN (SELECT update_id FROM processed_updates ORDER BY update_id DESC LIMIT ${KEEP})`,
        )
        .run();
    }
    return true;
  } catch (err) {
    console.error("⚠️ dedupe خطا داد، پردازش ادامه پیدا می‌کنه:", err);
    return true;
  }
}
