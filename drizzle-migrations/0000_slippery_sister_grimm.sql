CREATE TABLE `antagonists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`name` text,
	`motive` text,
	`escalation_plan` text,
	`linked_quest_id` integer
);
--> statement-breakpoint
CREATE TABLE `char_creation_sessions` (
	`tg_id` integer PRIMARY KEY NOT NULL,
	`draft_character_id` integer NOT NULL,
	`step` text DEFAULT 'name',
	`temp_data` text DEFAULT '{}',
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_tg_id` integer NOT NULL,
	`name` text,
	`species` text,
	`class` text,
	`background` text,
	`level` integer DEFAULT 1,
	`abilities` text,
	`hp` integer,
	`max_hp` integer,
	`ac` integer,
	`proficiency_bonus` integer DEFAULT 2,
	`skill_proficiencies` text,
	`spells_known` text,
	`feat` text,
	`equipment` text,
	`gold` integer DEFAULT 0,
	`status` text DEFAULT 'draft',
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `combat_state` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`round` integer DEFAULT 1,
	`turn_order` text,
	`current_turn_index` integer DEFAULT 0,
	`enemies` text
);
--> statement-breakpoint
CREATE TABLE `error_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text,
	`error_message` text,
	`context` text,
	`timestamp` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `game_sessions` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'idle',
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `npc_character_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`npc_id` integer NOT NULL,
	`character_id` integer NOT NULL,
	`known_alias` text,
	`history` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_npc_character` ON `npc_character_memory` (`npc_id`,`character_id`);--> statement-breakpoint
CREATE TABLE `npc_knowledge_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`npc_id` integer NOT NULL,
	`character_id` integer,
	`fact` text,
	`learned_from` text,
	`game_timestamp` text
);
--> statement-breakpoint
CREATE TABLE `npcs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`name` text,
	`level` integer DEFAULT 1,
	`social_status` text,
	`role` text,
	`public_facts` text
);
--> statement-breakpoint
CREATE TABLE `party_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`tg_id` integer NOT NULL,
	`character_id` integer,
	`is_ready` integer DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_party_chat_user` ON `party_members` (`chat_id`,`tg_id`);--> statement-breakpoint
CREATE TABLE `prompts` (
	`key` text PRIMARY KEY NOT NULL,
	`content` text,
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `quests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`type` text,
	`title` text,
	`full_plot` text,
	`status` text DEFAULT 'hidden',
	`finalized_at` integer
);
--> statement-breakpoint
CREATE TABLE `session_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`role` text,
	`speaker_tg_id` integer,
	`content` text,
	`timestamp` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tg_id` integer NOT NULL,
	`name` text,
	`username` text,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_tg_id_unique` ON `users` (`tg_id`);--> statement-breakpoint
CREATE TABLE `world_clock` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`current_day` integer DEFAULT 1,
	`time_of_day` text DEFAULT 'morning'
);
--> statement-breakpoint
CREATE TABLE `world_lore` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`lore_text` text,
	`locked` integer DEFAULT false,
	`updated_at` integer DEFAULT (unixepoch())
);
