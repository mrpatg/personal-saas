CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer,
	`client_id` text NOT NULL,
	`project_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text,
	`bill_to` text NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text NOT NULL,
	`work_through` text,
	`notes` text,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`sent_at` integer,
	`paid_date` text,
	`voided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_number_unique` ON `invoice` (`number`);--> statement-breakpoint
CREATE INDEX `invoice_client_id_idx` ON `invoice` (`client_id`);--> statement-breakpoint
CREATE INDEX `invoice_project_id_idx` ON `invoice` (`project_id`);--> statement-breakpoint
CREATE TABLE `invoice_line` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`task_id` text,
	`description` text NOT NULL,
	`details` text,
	`quantity_hundredths` integer DEFAULT 100 NOT NULL,
	`unit_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `invoice_line_invoice_id_idx` ON `invoice_line` (`invoice_id`,`position`);--> statement-breakpoint
ALTER TABLE `work_entry` ADD `invoice_line_id` text;