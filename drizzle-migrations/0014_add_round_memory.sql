CREATE TABLE `round_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`round` integer NOT NULL,
	`world_hours` integer,
	`location` text,
	`actions` text,
	`outcomes` text,
	`changes` text,
	`knowledge_delivered` text,
	`new_entities` text,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_round_memory` ON `round_memory` (`chat_id`,`round`);