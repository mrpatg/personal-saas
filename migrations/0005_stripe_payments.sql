ALTER TABLE `invoice` ADD `paid_via` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `stripe_checkout_session_id` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `stripe_payment_intent_id` text;