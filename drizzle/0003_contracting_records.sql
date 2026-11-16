CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`name` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`relationship_owner` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`merged_into_id` text,
	`email_key` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contacts_org_idx` ON `contacts` (`organization_id`);--> statement-breakpoint
CREATE INDEX `contacts_email_key_idx` ON `contacts` (`email_key`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text DEFAULT 'Capability' NOT NULL,
	`version_label` text DEFAULT '' NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`review_status` text DEFAULT 'Unreviewed' NOT NULL,
	`review_date` text,
	`storage_kind` text DEFAULT 'Reference only' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evidence_links` (
	`id` text PRIMARY KEY NOT NULL,
	`evidence_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_links_uq` ON `evidence_links` (`evidence_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `evidence_links_subject_idx` ON `evidence_links` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`org_type` text DEFAULT 'Prospective client' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`relationship_owner` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`merged_into_id` text,
	`name_key` text DEFAULT '' NOT NULL,
	`domain` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organizations_name_key_idx` ON `organizations` (`name_key`);--> statement-breakpoint
CREATE INDEX `organizations_domain_idx` ON `organizations` (`domain`);--> statement-breakpoint
CREATE TABLE `requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`description` text NOT NULL,
	`category` text DEFAULT 'Eligibility' NOT NULL,
	`mandatory` integer DEFAULT 1 NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'Not started' NOT NULL,
	`reviewer_notes` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `requirements_opportunity_idx` ON `requirements` (`opportunity_id`);--> statement-breakpoint
ALTER TABLE `inquiries` ADD `organization_id` text;--> statement-breakpoint
ALTER TABLE `inquiries` ADD `contact_id` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `organization_id` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `contact_id` text;