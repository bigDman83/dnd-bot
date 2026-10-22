import assert from "node:assert/strict";
import { tables } from "sdk";
import * as T from "lib/core/trace";
import { clearEventsForChat } from "lib/game/events";
await T.runWithTrace(-1, 1, async () => T.span("lock")); await T.runWithTrace(-1, 2, async () => T.span("lock")); await T.runWithTrace(-2, 1, async () => T.span("lock"));
tables.event_plans.push({ chatId: -1, round: 1 }, { chatId: -2, round: 1 }); tables.applied_events.push({ chatId: -1, eventId: "a" }); tables.round_memory.push({ chatId: -1, round: 1 });
await clearEventsForChat(-1);
assert.deepEqual(tables.trace_ring.map((r) => r.chatId), [-2]); assert.equal(tables.event_plans.length, 1); assert.equal(tables.applied_events.length, 0); assert.equal(tables.round_memory.length, 0);
// بازی جدید: دور ۱ تازه، تلاش‌ها قاطی بازی قبلی نمی‌شوند
await T.runWithTrace(-1, 1, async () => T.span("lock", null, { game: 2 }));
const row = tables.trace_ring.find((r) => r.chatId === -1 && r.round === 1); assert.equal(row.attempts.length, 1); assert.equal(row.attempts[0].spans[0].data.game, 2);
console.log("✅ /startgame: trace_ring همان گروه پاک میشه، گروه دیگر نه؛ دور ۱ بازی جدید یک attempt تازه دارد");
