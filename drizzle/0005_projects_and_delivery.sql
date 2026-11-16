CREATE TABLE `deliverables` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`milestone_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`due_date` text,
	`required` integer DEFAULT 1 NOT NULL,
	`draft_summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`latest_version_id` text,
	`accepted_version_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deliverables_project_idx` ON `deliverables` (`project_id`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`planned_date` text,
	`actual_date` text,
	`status` text DEFAULT 'Not started' NOT NULL,
	`completion_criteria` text DEFAULT '' NOT NULL,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`change_note` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `milestones_project_idx` ON `milestones` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`scope` text NOT NULL,
	`planned_end_date` text,
	`source` text NOT NULL,
	`change_request_id` text,
	`created_by` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_baselines_number_uq` ON `project_baselines` (`project_id`,`number`);--> statement-breakpoint
CREATE TABLE `project_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text DEFAULT 'Risk' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`severity` text DEFAULT 'Medium' NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`due_date` text,
	`resolution` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_log_project_idx` ON `project_log` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`proposal_id` text,
	`proposal_version_id` text,
	`submission_id` text,
	`award_evidence_id` text,
	`client_organization_id` text,
	`title` text NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`start_date` text,
	`scope` text DEFAULT '' NOT NULL,
	`planned_end_date` text,
	`actual_end_date` text,
	`status` text DEFAULT 'Planning' NOT NULL,
	`status_reason` text DEFAULT '' NOT NULL,
	`active_baseline_id` text,
	`next_action` text DEFAULT '' NOT NULL,
	`next_action_due` text,
	`version` integer DEFAULT 1 NOT NULL,
	`last_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_opportunity_uq` ON `projects` (`opportunity_id`);