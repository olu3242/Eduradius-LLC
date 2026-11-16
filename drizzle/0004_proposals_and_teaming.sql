CREATE TABLE `proposal_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sections` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposal_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`sections` text NOT NULL,
	`status` text NOT NULL,
	`submitted_by` text DEFAULT '' NOT NULL,
	`submitted_at` text DEFAULT '' NOT NULL,
	`review_reason` text DEFAULT '' NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposal_versions_number_uq` ON `proposal_versions` (`proposal_id`,`number`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`title` text NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`sections` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`template_id` text,
	`latest_version_id` text,
	`approved_version_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proposals_opportunity_idx` ON `proposals` (`opportunity_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`proposal_version_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`submitted_on` text,
	`method` text DEFAULT 'Procurement portal' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT 'Pending' NOT NULL,
	`outcome_date` text,
	`outcome_notes` text DEFAULT '' NOT NULL,
	`award_evidence_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_version_uq` ON `submissions` (`proposal_version_id`);--> statement-breakpoint
CREATE INDEX `submissions_opportunity_idx` ON `submissions` (`opportunity_id`);--> statement-breakpoint
CREATE TABLE `teaming_partners` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`contact_id` text,
	`proposed_role` text DEFAULT 'Subcontractor' NOT NULL,
	`work_package` text DEFAULT '' NOT NULL,
	`capability_fit` text DEFAULT '' NOT NULL,
	`relationship_owner` text DEFAULT '' NOT NULL,
	`discussion_status` text DEFAULT 'Identified' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`next_action_due` text,
	`agreement_reference` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teaming_partner_uq` ON `teaming_partners` (`opportunity_id`,`organization_id`);