CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`actor_name` text NOT NULL,
	`actor_role` text,
	`action` text NOT NULL,
	`subject_type` text,
	`subject_id` text,
	`client_id` text,
	`summary` text NOT NULL,
	`ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_log_created_at_idx` ON `activity_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_log_subject_idx` ON `activity_log` (`subject_type`,`subject_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_log_actor_id_idx` ON `activity_log` (`actor_id`,`created_at`);