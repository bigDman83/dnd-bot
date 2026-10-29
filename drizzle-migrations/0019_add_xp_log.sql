CREATE TABLE `xp_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`round` integer NOT NULL,
	`character_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`source` text NOT NULL,
	`reason` text NOT NULL,
	`event_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);