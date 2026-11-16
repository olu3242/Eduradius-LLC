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
