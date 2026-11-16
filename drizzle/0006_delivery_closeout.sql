CREATE TABLE `change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`requested_change` text NOT NULL,
	`reason` text NOT NULL,
	`scope_impact` text DEFAULT '' NOT NULL,
	`new_scope` text DEFAULT '' NOT NULL,
	`schedule_impact` text DEFAULT '' NOT NULL,
	`new_planned_end_date` text,
	`cost_impact` text DEFAULT '' NOT NULL,
	`decision_owner` text DEFAULT '' NOT NULL,
	`agreement_reference` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Proposed' NOT NULL,
	`decision_reason` text DEFAULT '' NOT NULL,
	`decided_by` text DEFAULT '' NOT NULL,
	`decided_at` text DEFAULT '' NOT NULL,
	`resulting_baseline_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_requests_project_idx` ON `change_requests` (`project_id`);--> statement-breakpoint
CREATE TABLE `deliverable_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`deliverable_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`evidence_ids` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`submitted_by` text DEFAULT '' NOT NULL,
	`submitted_at` text DEFAULT '' NOT NULL,
	`review_notes` text DEFAULT '' NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` text DEFAULT '' NOT NULL,
	`acceptance_kind` text DEFAULT '' NOT NULL,
	`acceptance_authority` text DEFAULT '' NOT NULL,
	`acceptance_evidence_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliverable_versions_number_uq` ON `deliverable_versions` (`deliverable_id`,`number`);--> statement-breakpoint
CREATE TABLE `experience_records` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`client_label` text DEFAULT '' NOT NULL,
	`actual_scope` text DEFAULT '' NOT NULL,
	`start_date` text,
	`end_date` text,
	`outcomes` text DEFAULT '' NOT NULL,
	`lessons_learned` text DEFAULT '' NOT NULL,
	`permission_reference` text DEFAULT '' NOT NULL,
	`permission_evidence_id` text,
	`verified_deliverables` text DEFAULT '[]' NOT NULL,
	`publication_status` text DEFAULT 'Private' NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` text DEFAULT '' NOT NULL,
	`provenance` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experience_records_project_uq` ON `experience_records` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_closeouts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`outcome` text NOT NULL,
	`lessons_learned` text DEFAULT '' NOT NULL,
	`final_acceptance_evidence_id` text,
	`archive_reviewed` integer DEFAULT 0 NOT NULL,
	`retention_notes` text DEFAULT '' NOT NULL,
	`exception_reason` text DEFAULT '' NOT NULL,
	`checklist` text DEFAULT '[]' NOT NULL,
	`closed_by` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_closeouts_project_idx` ON `project_closeouts` (`project_id`);