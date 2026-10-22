CREATE TABLE `creatures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`location_id` integer,
	`role` text,
	`tier` integer DEFAULT 1,
	`abilities` text,
	`proficiency_bonus` integer DEFAULT 2,
	`created_at` integer DEFAULT (unixepoch())
);