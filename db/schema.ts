import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', { id: text('id').primaryKey(), data: text('data').notNull(), revision: integer('revision').notNull().default(1), updatedAt: text('updated_at').notNull() });
// Fixed-window counters for public intake and sign-in (key = bucket:sha256(client)).
export const rateLimits = sqliteTable('rate_limits', { key: text('key').primaryKey(), windowStart: integer('window_start').notNull(), count: integer('count').notNull().default(0) });

// ── Connected workflow (migration 0002). These tables are the authoritative source for
// inquiries, opportunities and activity; the workspace JSON no longer stores copies.

export const inquiries = sqliteTable('inquiries', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  organization: text('organization').notNull(),
  email: text('email').notNull(),
  sector: text('sector').notNull(),
  scope: text('scope').notNull(),
  status: text('status').notNull().default('New'),
  legacyStatus: text('legacy_status'),
  assignee: text('assignee').notNull().default(''),
  nextAction: text('next_action').notNull().default(''),
  nextActionDue: text('next_action_due'),
  notes: text('notes').notNull().default(''),
  reason: text('reason').notNull().default(''),
  opportunityId: text('opportunity_id'),
  source: text('source').notNull().default('public'),
  organizationId: text('organization_id'),
  contactId: text('contact_id'),
  version: integer('version').notNull().default(1),
  lastRequestId: text('last_request_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [index('inquiries_status_idx').on(t.status), index('inquiries_created_idx').on(t.createdAt)]);

export const opportunities = sqliteTable('opportunities', {
  id: text('id').primaryKey(),
  sourceInquiryId: text('source_inquiry_id'),
  title: text('title').notNull(),
  agency: text('agency').notNull().default(''),
  url: text('url').notNull().default(''),
  deadline: text('deadline').notNull().default(''),
  value: text('value').notNull().default(''),
  naics: text('naics').notNull().default(''),
  psc: text('psc').notNull().default(''),
  stage: text('stage').notNull().default('Discover'),
  decision: text('decision').notNull().default('Undecided'),
  owner: text('owner').notNull().default(''),
  notes: text('notes').notNull().default(''),
  checks: text('checks').notNull(),
  status: text('status').notNull().default('Tentative'),
  contactName: text('contact_name').notNull().default(''),
  contactEmail: text('contact_email').notNull().default(''),
  sector: text('sector').notNull().default(''),
  service: text('service').notNull().default(''),
  nextAction: text('next_action').notNull().default(''),
  nextActionDue: text('next_action_due'),
  organizationId: text('organization_id'),
  contactId: text('contact_id'),
  version: integer('version').notNull().default(1),
  lastRequestId: text('last_request_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('opportunities_source_inquiry_uq').on(t.sourceInquiryId)]);

// Append-only. Actor and timestamps are always server-generated.
export const activityEvents = sqliteTable('activity_events', {
  id: text('id').primaryKey(),
  occurredAt: text('occurred_at').notNull(),
  actor: text('actor').notNull(),
  type: text('type').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id'),
  summary: text('summary').notNull(),
  details: text('details').notNull().default('{}'),
}, t => [index('activity_occurred_idx').on(t.occurredAt), index('activity_subject_idx').on(t.subjectType, t.subjectId)]);

// In-app notification queue. email_status records that no email is delivered.
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  dedupeKey: text('dedupe_key').notNull(),
  kind: text('kind').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id'),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
  readAt: text('read_at'),
  emailStatus: text('email_status').notNull().default('disabled'),
}, t => [uniqueIndex('notifications_dedupe_uq').on(t.dedupeKey)]);

// Pre-migration copies of the workspace document (non-destructive legacy import).
export const workspaceSnapshots = sqliteTable('workspace_snapshots', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  revision: integer('revision').notNull(),
  data: text('data').notNull(),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull(),
});

// ── Contracting execution (migration 0003). Columns mirror lib/records.ts SPECS. ──
const recordColumns = () => ({
  version: integer('version').notNull().default(1),
  lastRequestId: text('last_request_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  orgType: text('org_type').notNull().default('Prospective client'),
  website: text('website').notNull().default(''),
  relationshipOwner: text('relationship_owner').notNull().default(''),
  source: text('source').notNull().default(''),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('Active'),
  mergedIntoId: text('merged_into_id'),
  nameKey: text('name_key').notNull().default(''),
  domain: text('domain').notNull().default(''),
  ...recordColumns(),
}, t => [index('organizations_name_key_idx').on(t.nameKey), index('organizations_domain_idx').on(t.domain)]);

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  name: text('name').notNull(),
  role: text('role').notNull().default(''),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  relationshipOwner: text('relationship_owner').notNull().default(''),
  source: text('source').notNull().default(''),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('Active'),
  mergedIntoId: text('merged_into_id'),
  emailKey: text('email_key').notNull().default(''),
  ...recordColumns(),
}, t => [index('contacts_org_idx').on(t.organizationId), index('contacts_email_key_idx').on(t.emailKey)]);

export const requirements = sqliteTable('requirements', {
  id: text('id').primaryKey(),
  opportunityId: text('opportunity_id').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull().default('Eligibility'),
  mandatory: integer('mandatory').notNull().default(1),
  owner: text('owner').notNull().default(''),
  dueDate: text('due_date'),
  status: text('status').notNull().default('Not started'),
  reviewerNotes: text('reviewer_notes').notNull().default(''),
  ...recordColumns(),
}, t => [index('requirements_opportunity_idx').on(t.opportunityId)]);

export const evidence = sqliteTable('evidence', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  category: text('category').notNull().default('Capability'),
  versionLabel: text('version_label').notNull().default(''),
  owner: text('owner').notNull().default(''),
  reviewStatus: text('review_status').notNull().default('Unreviewed'),
  reviewDate: text('review_date'),
  storageKind: text('storage_kind').notNull().default('Reference only'),
  location: text('location').notNull().default(''),
  url: text('url').notNull().default(''),
  notes: text('notes').notNull().default(''),
  ...recordColumns(),
});

export const evidenceLinks = sqliteTable('evidence_links', {
  id: text('id').primaryKey(),
  evidenceId: text('evidence_id').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('evidence_links_uq').on(t.evidenceId, t.subjectType, t.subjectId), index('evidence_links_subject_idx').on(t.subjectType, t.subjectId)]);

// ── Proposals, owner review, submissions, teaming (migration 0004) ──
export const proposalTemplates = sqliteTable('proposal_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sections: text('sections').notNull().default('{}'),
  ...recordColumns(),
});

export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  opportunityId: text('opportunity_id').notNull(),
  title: text('title').notNull(),
  owner: text('owner').notNull().default(''),
  sections: text('sections').notNull().default('{}'),
  status: text('status').notNull().default('Draft'),
  templateId: text('template_id'),
  latestVersionId: text('latest_version_id'),
  approvedVersionId: text('approved_version_id'),
  ...recordColumns(),
}, t => [index('proposals_opportunity_idx').on(t.opportunityId)]);

// Immutable snapshots: content is never edited after a version is created.
export const proposalVersions = sqliteTable('proposal_versions', {
  id: text('id').primaryKey(),
  proposalId: text('proposal_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull().default(''),
  sections: text('sections').notNull(),
  status: text('status').notNull(),
  submittedBy: text('submitted_by').notNull().default(''),
  submittedAt: text('submitted_at').notNull().default(''),
  reviewReason: text('review_reason').notNull().default(''),
  reviewedBy: text('reviewed_by').notNull().default(''),
  reviewedAt: text('reviewed_at').notNull().default(''),
  ...recordColumns(),
}, t => [uniqueIndex('proposal_versions_number_uq').on(t.proposalId, t.number)]);

export const submissions = sqliteTable('submissions', {
  id: text('id').primaryKey(),
  proposalId: text('proposal_id').notNull(),
  proposalVersionId: text('proposal_version_id').notNull(),
  opportunityId: text('opportunity_id').notNull(),
  submittedOn: text('submitted_on'),
  method: text('method').notNull().default('Procurement portal'),
  reference: text('reference').notNull().default(''),
  notes: text('notes').notNull().default(''),
  outcome: text('outcome').notNull().default('Pending'),
  outcomeDate: text('outcome_date'),
  outcomeNotes: text('outcome_notes').notNull().default(''),
  awardEvidenceId: text('award_evidence_id'),
  ...recordColumns(),
}, t => [uniqueIndex('submissions_version_uq').on(t.proposalVersionId), index('submissions_opportunity_idx').on(t.opportunityId)]);

export const teamingPartners = sqliteTable('teaming_partners', {
  id: text('id').primaryKey(),
  opportunityId: text('opportunity_id').notNull(),
  organizationId: text('organization_id').notNull(),
  contactId: text('contact_id'),
  proposedRole: text('proposed_role').notNull().default('Subcontractor'),
  workPackage: text('work_package').notNull().default(''),
  capabilityFit: text('capability_fit').notNull().default(''),
  relationshipOwner: text('relationship_owner').notNull().default(''),
  discussionStatus: text('discussion_status').notNull().default('Identified'),
  nextAction: text('next_action').notNull().default(''),
  nextActionDue: text('next_action_due'),
  agreementReference: text('agreement_reference').notNull().default(''),
  ...recordColumns(),
}, t => [uniqueIndex('teaming_partner_uq').on(t.opportunityId, t.organizationId)]);

// ── Projects and delivery planning (migration 0005) ──
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  opportunityId: text('opportunity_id').notNull(),
  proposalId: text('proposal_id'),
  proposalVersionId: text('proposal_version_id'),
  submissionId: text('submission_id'),
  awardEvidenceId: text('award_evidence_id'),
  clientOrganizationId: text('client_organization_id'),
  title: text('title').notNull(),
  owner: text('owner').notNull().default(''),
  startDate: text('start_date'),
  scope: text('scope').notNull().default(''),
  plannedEndDate: text('planned_end_date'),
  actualEndDate: text('actual_end_date'),
  status: text('status').notNull().default('Planning'),
  statusReason: text('status_reason').notNull().default(''),
  activeBaselineId: text('active_baseline_id'),
  nextAction: text('next_action').notNull().default(''),
  nextActionDue: text('next_action_due'),
  ...recordColumns(),
}, t => [uniqueIndex('projects_opportunity_uq').on(t.opportunityId)]);

// The first baseline is the award baseline; later ones come only from approved changes.
export const projectBaselines = sqliteTable('project_baselines', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  number: integer('number').notNull(),
  scope: text('scope').notNull(),
  plannedEndDate: text('planned_end_date'),
  source: text('source').notNull(),
  changeRequestId: text('change_request_id'),
  createdBy: text('created_by').notNull().default(''),
  ...recordColumns(),
}, t => [uniqueIndex('project_baselines_number_uq').on(t.projectId, t.number)]);

export const milestones = sqliteTable('milestones', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  owner: text('owner').notNull().default(''),
  plannedDate: text('planned_date'),
  actualDate: text('actual_date'),
  status: text('status').notNull().default('Not started'),
  completionCriteria: text('completion_criteria').notNull().default(''),
  dependsOn: text('depends_on').notNull().default('[]'),
  changeNote: text('change_note').notNull().default(''),
  ...recordColumns(),
}, t => [index('milestones_project_idx').on(t.projectId)]);

export const deliverables = sqliteTable('deliverables', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  milestoneId: text('milestone_id'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  owner: text('owner').notNull().default(''),
  dueDate: text('due_date'),
  required: integer('required').notNull().default(1),
  draftSummary: text('draft_summary').notNull().default(''),
  status: text('status').notNull().default('Draft'),
  latestVersionId: text('latest_version_id'),
  acceptedVersionId: text('accepted_version_id'),
  ...recordColumns(),
}, t => [index('deliverables_project_idx').on(t.projectId)]);

export const projectLog = sqliteTable('project_log', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  kind: text('kind').notNull().default('Risk'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  owner: text('owner').notNull().default(''),
  severity: text('severity').notNull().default('Medium'),
  status: text('status').notNull().default('Open'),
  dueDate: text('due_date'),
  resolution: text('resolution').notNull().default(''),
  ...recordColumns(),
}, t => [index('project_log_project_idx').on(t.projectId)]);
