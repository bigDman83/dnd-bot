ALTER TABLE `game_sessions` ADD `current_round` integer DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `game_sessions` ADD `round_message_id` integer;
--> statement-breakpoint
CREATE TABLE `scene_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`round` integer NOT NULL,
	`tg_id` integer NOT NULL,
	`kind` text NOT NULL,
	`content` text,
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_action_round_user` ON `scene_actions` (`chat_id`,`round`,`tg_id`);