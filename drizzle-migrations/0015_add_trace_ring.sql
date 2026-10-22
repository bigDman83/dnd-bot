CREATE TABLE `trace_ring` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`round` integer NOT NULL,
	`outcome` text,
	`attempts` text,
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trace_ring` ON `trace_ring` (`chat_id`,`round`);