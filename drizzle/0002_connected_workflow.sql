CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`actor` text NOT NULL,
	`type` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text,
	`summary` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_occurred_idx` ON `activity_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `activity_subject_idx` ON `activity_events` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `inquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`organization` text NOT NULL,
	`email` text NOT NULL,
	`sector` text NOT NULL,
	`scope` text NOT NULL,
	`status` text DEFAULT 'New' NOT NULL,
	`legacy_status` text,
	`assignee` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`next_action_due` text,
	`notes` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`opportunity_id` text,
	`source` text DEFAULT 'public' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inquiries_status_idx` ON `inquiries` (`status`);--> statement-breakpoint
CREATE INDEX `inquiries_created_idx` ON `inquiries` (`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`kind` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	`email_status` text DEFAULT 'disabled' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_uq` ON `notifications` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`source_inquiry_id` text,
	`title` text NOT NULL,
	`agency` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`deadline` text DEFAULT '' NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`naics` text DEFAULT '' NOT NULL,
	`psc` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT 'Discover' NOT NULL,
	`decision` text DEFAULT 'Undecided' NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`checks` text NOT NULL,
	`status` text DEFAULT 'Tentative' NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`sector` text DEFAULT '' NOT NULL,
	`service` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`next_action_due` text,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunities_source_inquiry_uq` ON `opportunities` (`source_inquiry_id`);--> statement-breakpoint
CREATE TABLE `workspace_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
