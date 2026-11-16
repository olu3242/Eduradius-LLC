-- New, isolated Vercel PostgreSQL database only. Equivalent to D1 migrations 0000-0008.
CREATE FUNCTION json_each(document text) RETURNS TABLE(value text)
LANGUAGE SQL IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(item) = 'string' THEN item #>> '{}' ELSE item::text END
 FROM jsonb_array_elements(document::jsonb) AS item
$$;
CREATE FUNCTION json_extract(document text, path text) RETURNS text
LANGUAGE SQL IMMUTABLE AS $$ SELECT document::jsonb ->> substr(path, 3) $$;
CREATE VIEW sqlite_master AS SELECT tablename::text AS name, 'table'::text AS type FROM pg_tables WHERE schemaname = 'public';
CREATE TABLE "workspaces" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "rate_limits" (
  __rowid BIGSERIAL UNIQUE,
	"key" text PRIMARY KEY NOT NULL,
	"window_start" bigint NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE "activity_events" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" text NOT NULL,
	"actor" text NOT NULL,
	"type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"summary" text NOT NULL,
	"details" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_occurred_idx" ON "activity_events" ("occurred_at");--> statement-breakpoint
CREATE INDEX "activity_subject_idx" ON "activity_events" ("subject_type","subject_id");--> statement-breakpoint
CREATE TABLE "inquiries" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"organization" text NOT NULL,
	"email" text NOT NULL,
	"sector" text NOT NULL,
	"scope" text NOT NULL,
	"status" text DEFAULT 'New' NOT NULL,
	"legacy_status" text,
	"assignee" text DEFAULT '' NOT NULL,
	"next_action" text DEFAULT '' NOT NULL,
	"next_action_due" text,
	"notes" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"opportunity_id" text,
	"source" text DEFAULT 'public' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "inquiries_status_idx" ON "inquiries" ("status");--> statement-breakpoint
CREATE INDEX "inquiries_created_idx" ON "inquiries" ("created_at");--> statement-breakpoint
CREATE TABLE "notifications" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"title" text NOT NULL,
	"created_at" text NOT NULL,
	"read_at" text,
	"email_status" text DEFAULT 'disabled' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" ("dedupe_key");--> statement-breakpoint
CREATE TABLE "opportunities" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"source_inquiry_id" text,
	"title" text NOT NULL,
	"agency" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"deadline" text DEFAULT '' NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"naics" text DEFAULT '' NOT NULL,
	"psc" text DEFAULT '' NOT NULL,
	"stage" text DEFAULT 'Discover' NOT NULL,
	"decision" text DEFAULT 'Undecided' NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"checks" text NOT NULL,
	"status" text DEFAULT 'Tentative' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"sector" text DEFAULT '' NOT NULL,
	"service" text DEFAULT '' NOT NULL,
	"next_action" text DEFAULT '' NOT NULL,
	"next_action_due" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_source_inquiry_uq" ON "opportunities" ("source_inquiry_id");--> statement-breakpoint
CREATE TABLE "workspace_snapshots" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"data" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "contacts" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"relationship_owner" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"merged_into_id" text,
	"email_key" text DEFAULT '' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contacts_org_idx" ON "contacts" ("organization_id");--> statement-breakpoint
CREATE INDEX "contacts_email_key_idx" ON "contacts" ("email_key");--> statement-breakpoint
CREATE TABLE "evidence" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'Capability' NOT NULL,
	"version_label" text DEFAULT '' NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"review_status" text DEFAULT 'Unreviewed' NOT NULL,
	"review_date" text,
	"storage_kind" text DEFAULT 'Reference only' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_links" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"evidence_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_links_uq" ON "evidence_links" ("evidence_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "evidence_links_subject_idx" ON "evidence_links" ("subject_type","subject_id");--> statement-breakpoint
CREATE TABLE "organizations" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"org_type" text DEFAULT 'Prospective client' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"relationship_owner" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"merged_into_id" text,
	"name_key" text DEFAULT '' NOT NULL,
	"domain" text DEFAULT '' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "organizations_name_key_idx" ON "organizations" ("name_key");--> statement-breakpoint
CREATE INDEX "organizations_domain_idx" ON "organizations" ("domain");--> statement-breakpoint
CREATE TABLE "requirements" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'Eligibility' NOT NULL,
	"mandatory" bigint DEFAULT 1 NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"due_date" text,
	"status" text DEFAULT 'Not started' NOT NULL,
	"reviewer_notes" text DEFAULT '' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "requirements_opportunity_idx" ON "requirements" ("opportunity_id");--> statement-breakpoint
ALTER TABLE "inquiries" ADD "organization_id" text;--> statement-breakpoint
ALTER TABLE "inquiries" ADD "contact_id" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD "organization_id" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD "contact_id" text;
CREATE TABLE "proposal_templates" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sections" text DEFAULT '{}' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_versions" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"number" bigint NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"sections" text NOT NULL,
	"status" text NOT NULL,
	"submitted_by" text DEFAULT '' NOT NULL,
	"submitted_at" text DEFAULT '' NOT NULL,
	"review_reason" text DEFAULT '' NOT NULL,
	"reviewed_by" text DEFAULT '' NOT NULL,
	"reviewed_at" text DEFAULT '' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_versions_number_uq" ON "proposal_versions" ("proposal_id","number");--> statement-breakpoint
CREATE TABLE "proposals" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"title" text NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"sections" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"template_id" text,
	"latest_version_id" text,
	"approved_version_id" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "proposals_opportunity_idx" ON "proposals" ("opportunity_id");--> statement-breakpoint
CREATE TABLE "submissions" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"proposal_version_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"submitted_on" text,
	"method" text DEFAULT 'Procurement portal' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"outcome" text DEFAULT 'Pending' NOT NULL,
	"outcome_date" text,
	"outcome_notes" text DEFAULT '' NOT NULL,
	"award_evidence_id" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_version_uq" ON "submissions" ("proposal_version_id");--> statement-breakpoint
CREATE INDEX "submissions_opportunity_idx" ON "submissions" ("opportunity_id");--> statement-breakpoint
CREATE TABLE "teaming_partners" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text,
	"proposed_role" text DEFAULT 'Subcontractor' NOT NULL,
	"work_package" text DEFAULT '' NOT NULL,
	"capability_fit" text DEFAULT '' NOT NULL,
	"relationship_owner" text DEFAULT '' NOT NULL,
	"discussion_status" text DEFAULT 'Identified' NOT NULL,
	"next_action" text DEFAULT '' NOT NULL,
	"next_action_due" text,
	"agreement_reference" text DEFAULT '' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "teaming_partner_uq" ON "teaming_partners" ("opportunity_id","organization_id");
CREATE TABLE "deliverables" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"due_date" text,
	"required" bigint DEFAULT 1 NOT NULL,
	"draft_summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"latest_version_id" text,
	"accepted_version_id" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deliverables_project_idx" ON "deliverables" ("project_id");--> statement-breakpoint
CREATE TABLE "milestones" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"planned_date" text,
	"actual_date" text,
	"status" text DEFAULT 'Not started' NOT NULL,
	"completion_criteria" text DEFAULT '' NOT NULL,
	"depends_on" text DEFAULT '[]' NOT NULL,
	"change_note" text DEFAULT '' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "milestones_project_idx" ON "milestones" ("project_id");--> statement-breakpoint
CREATE TABLE "project_baselines" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"number" bigint NOT NULL,
	"scope" text NOT NULL,
	"planned_end_date" text,
	"source" text NOT NULL,
	"change_request_id" text,
	"created_by" text DEFAULT '' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_baselines_number_uq" ON "project_baselines" ("project_id","number");--> statement-breakpoint
CREATE TABLE "project_log" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text DEFAULT 'Risk' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"severity" text DEFAULT 'Medium' NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"due_date" text,
	"resolution" text DEFAULT '' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "project_log_project_idx" ON "project_log" ("project_id");--> statement-breakpoint
CREATE TABLE "projects" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"proposal_id" text,
	"proposal_version_id" text,
	"submission_id" text,
	"award_evidence_id" text,
	"client_organization_id" text,
	"title" text NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"start_date" text,
	"scope" text DEFAULT '' NOT NULL,
	"planned_end_date" text,
	"actual_end_date" text,
	"status" text DEFAULT 'Planning' NOT NULL,
	"status_reason" text DEFAULT '' NOT NULL,
	"active_baseline_id" text,
	"next_action" text DEFAULT '' NOT NULL,
	"next_action_due" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_opportunity_uq" ON "projects" ("opportunity_id");
CREATE TABLE "change_requests" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"requested_change" text NOT NULL,
	"reason" text NOT NULL,
	"scope_impact" text DEFAULT '' NOT NULL,
	"new_scope" text DEFAULT '' NOT NULL,
	"schedule_impact" text DEFAULT '' NOT NULL,
	"new_planned_end_date" text,
	"cost_impact" text DEFAULT '' NOT NULL,
	"decision_owner" text DEFAULT '' NOT NULL,
	"agreement_reference" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Proposed' NOT NULL,
	"decision_reason" text DEFAULT '' NOT NULL,
	"decided_by" text DEFAULT '' NOT NULL,
	"decided_at" text DEFAULT '' NOT NULL,
	"resulting_baseline_id" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "change_requests_project_idx" ON "change_requests" ("project_id");--> statement-breakpoint
CREATE TABLE "deliverable_versions" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"deliverable_id" text NOT NULL,
	"number" bigint NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"evidence_ids" text DEFAULT '[]' NOT NULL,
	"status" text NOT NULL,
	"submitted_by" text DEFAULT '' NOT NULL,
	"submitted_at" text DEFAULT '' NOT NULL,
	"review_notes" text DEFAULT '' NOT NULL,
	"reviewed_by" text DEFAULT '' NOT NULL,
	"reviewed_at" text DEFAULT '' NOT NULL,
	"acceptance_kind" text DEFAULT '' NOT NULL,
	"acceptance_authority" text DEFAULT '' NOT NULL,
	"acceptance_evidence_id" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deliverable_versions_number_uq" ON "deliverable_versions" ("deliverable_id","number");--> statement-breakpoint
CREATE TABLE "experience_records" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"client_label" text DEFAULT '' NOT NULL,
	"actual_scope" text DEFAULT '' NOT NULL,
	"start_date" text,
	"end_date" text,
	"outcomes" text DEFAULT '' NOT NULL,
	"lessons_learned" text DEFAULT '' NOT NULL,
	"permission_reference" text DEFAULT '' NOT NULL,
	"permission_evidence_id" text,
	"verified_deliverables" text DEFAULT '[]' NOT NULL,
	"publication_status" text DEFAULT 'Private' NOT NULL,
	"reviewed_by" text DEFAULT '' NOT NULL,
	"reviewed_at" text DEFAULT '' NOT NULL,
	"provenance" text DEFAULT '{}' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "experience_records_project_uq" ON "experience_records" ("project_id");--> statement-breakpoint
CREATE TABLE "project_closeouts" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"outcome" text NOT NULL,
	"lessons_learned" text DEFAULT '' NOT NULL,
	"final_acceptance_evidence_id" text,
	"archive_reviewed" bigint DEFAULT 0 NOT NULL,
	"retention_notes" text DEFAULT '' NOT NULL,
	"exception_reason" text DEFAULT '' NOT NULL,
	"checklist" text DEFAULT '[]' NOT NULL,
	"closed_by" text DEFAULT '' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"last_request_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "project_closeouts_project_idx" ON "project_closeouts" ("project_id");
CREATE INDEX "contacts_created_id_idx" ON "contacts" ("created_at","id");--> statement-breakpoint
CREATE INDEX "contacts_name_lower_idx" ON "contacts" (lower("name"),"id");--> statement-breakpoint
CREATE INDEX "evidence_created_id_idx" ON "evidence" ("created_at","id");--> statement-breakpoint
CREATE INDEX "evidence_title_lower_idx" ON "evidence" (lower("title"),"id");--> statement-breakpoint
CREATE INDEX "evidence_review_date_idx" ON "evidence" ("review_date");--> statement-breakpoint
CREATE INDEX "experience_records_created_id_idx" ON "experience_records" ("created_at","id");--> statement-breakpoint
CREATE INDEX "inquiries_created_id_idx" ON "inquiries" ("created_at","id");--> statement-breakpoint
CREATE INDEX "inquiries_org_idx" ON "inquiries" ("organization_id");--> statement-breakpoint
CREATE INDEX "inquiries_due_idx" ON "inquiries" ("next_action_due");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" ("read_at","created_at");--> statement-breakpoint
CREATE INDEX "opportunities_created_id_idx" ON "opportunities" ("created_at","id");--> statement-breakpoint
CREATE INDEX "opportunities_updated_id_idx" ON "opportunities" ("updated_at","id");--> statement-breakpoint
CREATE INDEX "opportunities_org_idx" ON "opportunities" ("organization_id");--> statement-breakpoint
CREATE INDEX "opportunities_due_idx" ON "opportunities" ("next_action_due");--> statement-breakpoint
CREATE INDEX "organizations_created_id_idx" ON "organizations" ("created_at","id");--> statement-breakpoint
CREATE INDEX "organizations_name_lower_idx" ON "organizations" (lower("name"),"id");--> statement-breakpoint
CREATE INDEX "projects_created_id_idx" ON "projects" ("created_at","id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" ("status");
CREATE TABLE "import_conflicts" (
  __rowid BIGSERIAL UNIQUE,
	"id" text PRIMARY KEY NOT NULL,
	"source_snapshot_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"legacy_item" text NOT NULL,
	"baseline" text NOT NULL,
	"fields" text NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"decision_reason" text DEFAULT '' NOT NULL,
	"decided_by" text,
	"decided_at" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "import_conflicts_uq" ON "import_conflicts" ("source_snapshot_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "import_conflicts_status_idx" ON "import_conflicts" ("status");
-- SQLite-compatible aggregate results stay JSON text, matching the existing API.
CREATE FUNCTION eduradius_concat(state text, value text) RETURNS text LANGUAGE SQL IMMUTABLE AS $$ SELECT concat_ws(',', state, value) $$;
CREATE AGGREGATE group_concat(text) (SFUNC = eduradius_concat, STYPE = text);
CREATE FUNCTION "json_object"(k1 text, v1 text, k2 text, v2 text) RETURNS text LANGUAGE SQL IMMUTABLE AS $$ SELECT json_build_object(k1, v1, k2, v2)::text $$;
CREATE FUNCTION eduradius_json_append(state jsonb, value text) RETURNS jsonb LANGUAGE SQL IMMUTABLE AS $$ SELECT state || jsonb_build_array(value::jsonb) $$;
CREATE FUNCTION eduradius_json_text(state jsonb) RETURNS text LANGUAGE SQL IMMUTABLE AS $$ SELECT state::text $$;
CREATE AGGREGATE json_group_array(text) (SFUNC = eduradius_json_append, STYPE = jsonb, INITCOND = '[]', FINALFUNC = eduradius_json_text);
