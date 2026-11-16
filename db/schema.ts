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
