CREATE TABLE `task_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_comment_task_id_idx` ON `task_comment` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `work_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`kind` text DEFAULT 'time' NOT NULL,
	`work_date` text NOT NULL,
	`description` text,
	`minutes` integer,
	`rate_cents` integer,
	`amount_cents` integer NOT NULL,
	`billable` integer DEFAULT true NOT NULL,
	`invoice_id` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `work_entry_task_id_idx` ON `work_entry` (`task_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `work_entry_invoice_id_idx` ON `work_entry` (`invoice_id`);--> statement-breakpoint
ALTER TABLE `project` ADD `hourly_rate_cents` integer;