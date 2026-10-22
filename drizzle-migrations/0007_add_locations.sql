ALTER TABLE `game_sessions` ADD `current_location_id` integer;
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`name` text NOT NULL,
	`tier` integer DEFAULT 1 NOT NULL,
	`theme` text,
	`rules` text,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `location_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`location_a_id` integer NOT NULL,
	`location_b_id` integer NOT NULL,
	`distance_hours` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_location_pair` ON `location_links` (`chat_id`,`location_a_id`,`location_b_id`);