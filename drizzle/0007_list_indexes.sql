CREATE INDEX `contacts_created_id_idx` ON `contacts` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `contacts_name_lower_idx` ON `contacts` (lower("name"),`id`);--> statement-breakpoint
CREATE INDEX `evidence_created_id_idx` ON `evidence` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `evidence_title_lower_idx` ON `evidence` (lower("title"),`id`);--> statement-breakpoint
CREATE INDEX `evidence_review_date_idx` ON `evidence` (`review_date`);--> statement-breakpoint
CREATE INDEX `experience_records_created_id_idx` ON `experience_records` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `inquiries_created_id_idx` ON `inquiries` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `inquiries_org_idx` ON `inquiries` (`organization_id`);--> statement-breakpoint
CREATE INDEX `inquiries_due_idx` ON `inquiries` (`next_action_due`);--> statement-breakpoint
CREATE INDEX `notifications_unread_idx` ON `notifications` (`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `opportunities_created_id_idx` ON `opportunities` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `opportunities_updated_id_idx` ON `opportunities` (`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `opportunities_org_idx` ON `opportunities` (`organization_id`);--> statement-breakpoint
CREATE INDEX `opportunities_due_idx` ON `opportunities` (`next_action_due`);--> statement-breakpoint
CREATE INDEX `organizations_created_id_idx` ON `organizations` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `organizations_name_lower_idx` ON `organizations` (lower("name"),`id`);--> statement-breakpoint
CREATE INDEX `projects_created_id_idx` ON `projects` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`);