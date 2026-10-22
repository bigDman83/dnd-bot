CREATE TABLE `event_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`round` integer NOT NULL,
	`plan` text,
	`actions_fingerprint` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`narration` text,
	`suggestions` text,
	`scene_text` text,
	`scene_sent` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_plan_round` ON `event_plans` (`chat_id`,`round`);
--> statement-breakpoint
CREATE TABLE `applied_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`round` integer NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);