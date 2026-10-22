ALTER TABLE `game_sessions` ADD `expected_players` integer;
--> statement-breakpoint
ALTER TABLE `game_sessions` ADD `pending_suggestions` text;
--> statement-breakpoint
ALTER TABLE `char_creation_sessions` ADD `origin_chat_id` integer;
