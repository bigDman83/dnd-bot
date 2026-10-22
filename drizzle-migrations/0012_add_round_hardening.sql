CREATE TABLE `processed_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
ALTER TABLE `scene_actions` ADD `message_id` integer;
--> statement-breakpoint
ALTER TABLE `game_sessions` ADD `resolving_since` integer;