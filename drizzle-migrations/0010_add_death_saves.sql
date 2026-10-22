ALTER TABLE `characters` ADD `death_save_successes` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `characters` ADD `death_save_failures` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `characters` ADD `stable` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `characters` ADD `dead` integer DEFAULT 0;