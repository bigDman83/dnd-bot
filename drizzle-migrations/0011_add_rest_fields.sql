ALTER TABLE `characters` ADD `hit_dice_spent` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `world_clock` ADD `elapsed_hours` integer;
--> statement-breakpoint
ALTER TABLE `world_clock` ADD `last_long_rest_hours` integer;