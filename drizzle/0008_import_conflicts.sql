CREATE TABLE `import_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_snapshot_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`legacy_item` text NOT NULL,
	`baseline` text NOT NULL,
	`fields` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`decision_reason` text DEFAULT '' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_conflicts_uq` ON `import_conflicts` (`source_snapshot_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `import_conflicts_status_idx` ON `import_conflicts` (`status`);