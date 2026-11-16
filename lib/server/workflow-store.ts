// D1 persistence for the connected workflow. Server-only.
// Authoritative sources: `inquiries`, `opportunities`, `activity_events`, `notifications`.
// The workspace JSON document no longer stores copies of these records.
import { env } from 'cloudflare:workers';
import {
  applyInquiryPatch, emptyOpportunity, mapLegacyInquiryStatus, opportunityEvents, validateOpportunity, defaultChecks,
  OPPORTUNITY_DECISIONS, OPPORTUNITY_STAGES, OPPORTUNITY_STATUSES, CHECK_KEYS, CHECK_VALUES, isIsoDate,
  type ActivityDraft, type ActivityRecord, type InquiryRecord, type NotificationRecord, type OpportunityInput, type OpportunityRecord, type InquiryStatus,
} from '../workflow';
import { readWorkspace, WORKSPACE_ID } from './workspace-store';

export const MAX_STORED_INQUIRIES = 5000;
/** Email delivery is not configured: every notification records that no email was sent. */
export const EMAIL_STATUS = 'disabled';
export const LEGACY_KEYS = ['inquiries', 'opportunities', 'activity'] as const;

type Row = Record<string, unknown>;
type Statement = ReturnType<D1Database['prepare']>;
export type StoreResult<T> = { status: number; body: T | { error: string; current?: unknown } };

function db(): D1Database {
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  return env.DB;
}
const nowIso = () => new Date().toISOString();
const s = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

// ── Row mapping ─────────────────────────────────────────────────────────────

const INQUIRY_COLUMNS = 'id, kind, name, organization, email, sector, scope, status, legacy_status, assignee, next_action, next_action_due, notes, reason, opportunity_id, source, version, created_at, updated_at';
const OPPORTUNITY_COLUMNS = 'id, source_inquiry_id, title, agency, url, deadline, value, naics, psc, stage, decision, owner, notes, checks, status, contact_name, contact_email, sector, service, next_action, next_action_due, version, created_at, updated_at';
// Read-only link columns (migration 0003); changed only by the inquiry.link / opportunity.link actions.
export const INQUIRY_SELECT = INQUIRY_COLUMNS + ', organization_id, contact_id';
export const OPPORTUNITY_SELECT = OPPORTUNITY_COLUMNS + ', organization_id, contact_id';

export const toInquiry = (r: Row): InquiryRecord => ({
  id: s(r.id), kind: s(r.kind), name: s(r.name), organization: s(r.organization), email: s(r.email), sector: s(r.sector), scope: s(r.scope),
  status: s(r.status) as InquiryStatus, legacyStatus: (r.legacy_status as string | null) ?? null, assignee: s(r.assignee), nextAction: s(r.next_action),
  nextActionDue: (r.next_action_due as string | null) ?? null, notes: s(r.notes), reason: s(r.reason), opportunityId: (r.opportunity_id as string | null) ?? null,
  source: s(r.source), organizationId: (r.organization_id as string | null) ?? null, contactId: (r.contact_id as string | null) ?? null,
  version: Number(r.version), createdAt: s(r.created_at), updatedAt: s(r.updated_at),
});
function parseChecks(value: unknown) { try { return { ...defaultChecks(), ...JSON.parse(s(value)) }; } catch { return defaultChecks(); } }
export const toOpportunity = (r: Row): OpportunityRecord => ({
  id: s(r.id), sourceInquiryId: (r.source_inquiry_id as string | null) ?? null, title: s(r.title), agency: s(r.agency), url: s(r.url), deadline: s(r.deadline),
  value: s(r.value), naics: s(r.naics), psc: s(r.psc), stage: s(r.stage), decision: s(r.decision), owner: s(r.owner), notes: s(r.notes), checks: parseChecks(r.checks),
  status: s(r.status), contactName: s(r.contact_name), contactEmail: s(r.contact_email), sector: s(r.sector), service: s(r.service), nextAction: s(r.next_action),
  nextActionDue: (r.next_action_due as string | null) ?? null, organizationId: (r.organization_id as string | null) ?? null, contactId: (r.contact_id as string | null) ?? null,
  version: Number(r.version), createdAt: s(r.created_at), updatedAt: s(r.updated_at),
});
const toActivity = (r: Row): ActivityRecord => {
  let details: Record<string, unknown> = {};
  try { details = JSON.parse(s(r.details)); } catch { /* keep empty */ }
  return { id: s(r.id), occurredAt: s(r.occurred_at), actor: s(r.actor), type: s(r.type), subjectType: s(r.subject_type), subjectId: (r.subject_id as string | null) ?? null, summary: s(r.summary), details };
};
const toNotification = (r: Row): NotificationRecord => ({ id: s(r.id), kind: s(r.kind), subjectType: s(r.subject_type), subjectId: (r.subject_id as string | null) ?? null, title: s(r.title), createdAt: s(r.created_at), readAt: (r.read_at as string | null) ?? null, emailStatus: s(r.email_status) });
const opportunityInput = (o: OpportunityRecord): OpportunityInput => {
  const { id: _id, sourceInquiryId: _src, version: _v, createdAt: _c, updatedAt: _u, organizationId: _o, contactId: _ct, ...input } = o;
  void _id; void _src; void _v; void _c; void _u; void _o; void _ct;
  return input;
};

// ── Activity (append-only; actor and time always come from the server) ─────

/** Inserts an activity event only when `guardSql` (an EXISTS subquery) matches. */
export function activityStatement(actor: string, at: string, subjectType: string, subjectId: string | null, event: ActivityDraft, guardSql: string, guardArgs: unknown[]): Statement {
  return db().prepare(`INSERT INTO activity_events (id, occurred_at, actor, type, subject_type, subject_id, summary, details) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${guardSql})`)
    .bind(crypto.randomUUID(), at, actor, event.type, subjectType, subjectId, event.summary.slice(0, 300), JSON.stringify(event.details ?? {}), ...guardArgs);
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getInquiry(id: string) {
  const row = await db().prepare(`SELECT ${INQUIRY_SELECT} FROM inquiries WHERE id = ?`).bind(id).first<Row>();
  return row ? toInquiry(row) : null;
}
export async function getOpportunity(id: string) {
  const row = await db().prepare(`SELECT ${OPPORTUNITY_SELECT} FROM opportunities WHERE id = ?`).bind(id).first<Row>();
  return row ? toOpportunity(row) : null;
}
async function getOpportunityForInquiry(inquiryId: string) {
  const row = await db().prepare(`SELECT ${OPPORTUNITY_SELECT} FROM opportunities WHERE source_inquiry_id = ?`).bind(inquiryId).first<Row>();
  return row ? toOpportunity(row) : null;
}

/** Recent activity by default; `allActivity` (exports) returns up to 50,000 entries. */
export async function listWorkflow({ allActivity = false } = {}) {
  const [inquiries, opportunities, activity, notifications] = await Promise.all([
    db().prepare(`SELECT ${INQUIRY_SELECT} FROM inquiries ORDER BY created_at DESC LIMIT 2000`).all<Row>(),
    db().prepare(`SELECT ${OPPORTUNITY_SELECT} FROM opportunities ORDER BY updated_at DESC LIMIT 2000`).all<Row>(),
    db().prepare('SELECT id, occurred_at, actor, type, subject_type, subject_id, summary, details FROM activity_events ORDER BY occurred_at DESC, rowid DESC LIMIT ?').bind(allActivity ? 50000 : 200).all<Row>(),
    db().prepare('SELECT id, kind, subject_type, subject_id, title, created_at, read_at, email_status FROM notifications ORDER BY (read_at IS NULL) DESC, created_at DESC LIMIT 50').all<Row>(),
  ]);
  return {
    inquiries: inquiries.results.map(toInquiry), opportunities: opportunities.results.map(toOpportunity),
    activity: activity.results.map(toActivity), notifications: notifications.results.map(toNotification),
  };
}

// ── Public intake ───────────────────────────────────────────────────────────

export type PublicInquiry = { kind: string; name: string; organization: string; email: string; sector: string; scope: string };
/** Appends a public inquiry, its in-app notification and its activity in one transaction. */
export async function createPublicInquiry(fields: PublicInquiry): Promise<{ id: string } | null> {
  const id = crypto.randomUUID(), at = nowIso();
  const exists = 'SELECT 1 FROM inquiries WHERE id = ?';
  const results = await db().batch([
    db().prepare(`INSERT INTO inquiries (id, kind, name, organization, email, sector, scope, status, source, version, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'New', 'public', 1, ?, ? WHERE (SELECT COUNT(*) FROM inquiries) < ?`)
      .bind(id, fields.kind, fields.name, fields.organization, fields.email, fields.sector, fields.scope, at, at, MAX_STORED_INQUIRIES),
    db().prepare(`INSERT OR IGNORE INTO notifications (id, dedupe_key, kind, subject_type, subject_id, title, created_at, email_status)
      SELECT ?, ?, 'inquiry.created', 'inquiry', ?, ?, ?, ? WHERE EXISTS (${exists})`)
      .bind(crypto.randomUUID(), `inquiry.created:${id}`, id, `New ${fields.kind.toLowerCase()} from ${fields.organization}`.slice(0, 200), at, EMAIL_STATUS, id),
    activityStatement('public', at, 'inquiry', id, { type: 'inquiry.received', summary: `Inquiry received (${fields.kind})`, details: { kind: fields.kind } }, exists, [id]),
  ]);
  return results[0].meta.changes ? { id } : null;
}

// ── Owner edits ─────────────────────────────────────────────────────────────

const conflict = (current: unknown) => ({ status: 409, body: { error: 'This record changed since you opened it. Review the latest version and try again.', current } });

export async function updateInquiry(id: string, version: unknown, patch: unknown, actor: string): Promise<StoreResult<{ inquiry: InquiryRecord }>> {
  const current = await getInquiry(id);
  if (!current) return { status: 404, body: { error: 'Inquiry not found.' } };
  if (!Number.isInteger(version)) return { status: 400, body: { error: 'A record version is required.' } };
  if (current.version !== version) return conflict(current);
  const result = applyInquiryPatch(current, patch);
  if (!result.ok) return { status: 400, body: { error: result.error } };
  if (!result.events.length) return { status: 200, body: { inquiry: current } };
  const n = result.next, at = nowIso(), requestId = crypto.randomUUID();
  const guard = 'SELECT 1 FROM inquiries WHERE id = ? AND last_request_id = ?';
  const results = await db().batch([
    db().prepare('UPDATE inquiries SET status = ?, assignee = ?, next_action = ?, next_action_due = ?, notes = ?, reason = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ?')
      .bind(n.status, n.assignee, n.nextAction, n.nextActionDue, n.notes, n.reason, at, requestId, id, current.version),
    ...result.events.map(e => activityStatement(actor, at, 'inquiry', id, e, guard, [id, requestId])),
    // Once reviewed, the request's "new request" notification is no longer actionable.
    db().prepare(`UPDATE notifications SET read_at = ? WHERE subject_type = 'inquiry' AND subject_id = ? AND read_at IS NULL AND EXISTS (${guard}) AND (SELECT status FROM inquiries WHERE id = ?) <> 'New'`).bind(at, id, id, requestId, id),
  ]);
  if (!results[0].meta.changes) return conflict(await getInquiry(id));
  return { status: 200, body: { inquiry: (await getInquiry(id))! } };
}

type Conversion = { inquiry: InquiryRecord; opportunity: OpportunityRecord; alreadyConverted: boolean };
/**
 * Converts a qualified inquiry exactly once. The opportunity insert, inquiry update and
 * activity run in one transaction guarded by status + version; the unique index on
 * opportunities.source_inquiry_id is the final backstop against duplicates.
 */
export async function convertInquiry(id: string, version: unknown, draft: unknown, actor: string): Promise<StoreResult<Conversion>> {
  const current = await getInquiry(id);
  if (!current) return { status: 404, body: { error: 'Inquiry not found.' } };
  const already = async (): Promise<StoreResult<Conversion> | null> => {
    const [inquiry, opportunity] = await Promise.all([getInquiry(id), getOpportunityForInquiry(id)]);
    return inquiry && opportunity ? { status: 200, body: { inquiry, opportunity, alreadyConverted: true } } : null;
  };
  if (current.status === 'Converted' || current.opportunityId) return (await already()) ?? { status: 409, body: { error: 'This inquiry is marked converted but its opportunity is missing. Restore from backup before retrying.' } };
  if (current.status !== 'Qualified') return { status: 409, body: { error: 'Only qualified inquiries can be converted.', current } };
  if (!Number.isInteger(version)) return { status: 400, body: { error: 'A record version is required.' } };
  if (current.version !== version) return conflict(current);
  const valid = validateOpportunity(draft, emptyOpportunity());
  if (!valid.ok) return { status: 400, body: { error: valid.error } };
  const o = valid.value, opportunityId = crypto.randomUUID(), requestId = crypto.randomUUID(), at = nowIso();
  const eligible = "SELECT 1 FROM inquiries WHERE id = ? AND status = 'Qualified' AND version = ? AND opportunity_id IS NULL";
  const converted = 'SELECT 1 FROM inquiries WHERE id = ? AND last_request_id = ?';
  try {
    const results = await db().batch([
      db().prepare(`INSERT INTO opportunities (${OPPORTUNITY_COLUMNS}, last_request_id) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ? WHERE EXISTS (${eligible})`)
        .bind(opportunityId, id, o.title, o.agency, o.url, o.deadline, o.value, o.naics, o.psc, o.stage, o.decision, o.owner, o.notes, JSON.stringify(o.checks), o.status,
          o.contactName, o.contactEmail, o.sector, o.service, o.nextAction, o.nextActionDue, at, at, requestId, id, current.version),
      db().prepare("UPDATE inquiries SET status = 'Converted', opportunity_id = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND status = 'Qualified' AND version = ? AND opportunity_id IS NULL")
        .bind(opportunityId, at, requestId, id, current.version),
      db().prepare('UPDATE opportunities SET organization_id = (SELECT organization_id FROM inquiries WHERE id = ?), contact_id = (SELECT contact_id FROM inquiries WHERE id = ?) WHERE id = ? AND last_request_id = ?').bind(id, id, opportunityId, requestId),
      activityStatement(actor, at, 'inquiry', id, { type: 'inquiry.converted', summary: `Converted to opportunity “${o.title}”`, details: { opportunityId } }, converted, [id, requestId]),
      activityStatement(actor, at, 'opportunity', opportunityId, { type: 'opportunity.created', summary: 'Opportunity created from inquiry', details: { sourceInquiryId: id } }, converted, [id, requestId]),
    ]);
    if (!results[1].meta.changes) return (await already()) ?? conflict(await getInquiry(id));
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error))) { const existing = await already(); if (existing) return existing; }
    throw error;
  }
  const [inquiry, opportunity] = await Promise.all([getInquiry(id), getOpportunity(opportunityId)]);
  return { status: 201, body: { inquiry: inquiry!, opportunity: opportunity!, alreadyConverted: false } };
}

export async function createOpportunity(input: unknown, actor: string): Promise<StoreResult<{ opportunity: OpportunityRecord }>> {
  const valid = validateOpportunity(input, emptyOpportunity());
  if (!valid.ok) return { status: 400, body: { error: valid.error } };
  const o = valid.value, id = crypto.randomUUID(), at = nowIso(), requestId = crypto.randomUUID();
  const events: ActivityDraft[] = [{ type: 'opportunity.created', summary: `Opportunity created: ${o.title}` }];
  if (o.nextAction) events.push({ type: 'followup.created', summary: `Follow-up scheduled${o.nextActionDue ? ` for ${o.nextActionDue}` : ''}`, details: { due: o.nextActionDue } });
  await db().batch([
    db().prepare(`INSERT INTO opportunities (${OPPORTUNITY_COLUMNS}, last_request_id) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .bind(id, o.title, o.agency, o.url, o.deadline, o.value, o.naics, o.psc, o.stage, o.decision, o.owner, o.notes, JSON.stringify(o.checks), o.status,
        o.contactName, o.contactEmail, o.sector, o.service, o.nextAction, o.nextActionDue, at, at, requestId),
    ...events.map(e => activityStatement(actor, at, 'opportunity', id, e, 'SELECT 1 FROM opportunities WHERE id = ? AND last_request_id = ?', [id, requestId])),
  ]);
  return { status: 201, body: { opportunity: (await getOpportunity(id))! } };
}

export async function updateOpportunity(id: string, version: unknown, patch: unknown, actor: string): Promise<StoreResult<{ opportunity: OpportunityRecord }>> {
  const current = await getOpportunity(id);
  if (!current) return { status: 404, body: { error: 'Opportunity not found.' } };
  if (!Number.isInteger(version)) return { status: 400, body: { error: 'A record version is required.' } };
  if (current.version !== version) return conflict(current);
  const before = opportunityInput(current);
  const valid = validateOpportunity(patch, before);
  if (!valid.ok) return { status: 400, body: { error: valid.error } };
  const o = valid.value, events = opportunityEvents(before, o);
  if (!events.length) return { status: 200, body: { opportunity: current } };
  const at = nowIso(), requestId = crypto.randomUUID();
  const results = await db().batch([
    db().prepare(`UPDATE opportunities SET title = ?, agency = ?, url = ?, deadline = ?, value = ?, naics = ?, psc = ?, stage = ?, decision = ?, owner = ?, notes = ?, checks = ?, status = ?,
      contact_name = ?, contact_email = ?, sector = ?, service = ?, next_action = ?, next_action_due = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ?`)
      .bind(o.title, o.agency, o.url, o.deadline, o.value, o.naics, o.psc, o.stage, o.decision, o.owner, o.notes, JSON.stringify(o.checks), o.status,
        o.contactName, o.contactEmail, o.sector, o.service, o.nextAction, o.nextActionDue, at, requestId, id, current.version),
    ...events.map(e => activityStatement(actor, at, 'opportunity', id, e, 'SELECT 1 FROM opportunities WHERE id = ? AND last_request_id = ?', [id, requestId])),
  ]);
  if (!results[0].meta.changes) return conflict(await getOpportunity(id));
  return { status: 200, body: { opportunity: (await getOpportunity(id))! } };
}

export async function markNotificationsRead(ids: string[] | 'all') {
  const at = nowIso();
  const result = ids === 'all'
    ? await db().prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').bind(at).run()
    : await db().prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(at, JSON.stringify(ids)).run();
  return result.meta.changes;
}

// ── Legacy import (idempotent, non-destructive) ─────────────────────────────

/** Deterministic id for legacy records that never had one (FNV-1a, two seeds). */
function stableId(prefix: string, value: string) {
  const fnv = (seed: number) => { let h = seed >>> 0; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0'); };
  return `${prefix}-${fnv(2166136261)}${fnv(0x9747b28c)}`;
}
const objects = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((x): x is Row => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
const isoOr = (v: unknown, fallback: string) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback);
const oneOf = <T extends readonly string[]>(v: unknown, allowed: T, fallback: T[number]) => ((allowed as readonly unknown[]).includes(v) ? (v as T[number]) : fallback);

/**
 * Moves inquiries, opportunities and activity out of the legacy workspace document.
 * One transaction: snapshot the original document, INSERT OR IGNORE every record by id,
 * then strip the arrays only if the document revision is unchanged. Safe to rerun.
 */
export async function importLegacyWorkflow(): Promise<{ imported: boolean; inquiries?: number; opportunities?: number; activity?: number }> {
  const stored = await readWorkspace();
  if (!stored.data || !LEGACY_KEYS.some(k => k in stored.data!)) return { imported: false };
  const data = stored.data, at = nowIso();
  const inquiries = objects(data.inquiries).map(item => {
    const mapped = mapLegacyInquiryStatus(item.status);
    return {
      id: s(item.id) || stableId('legacy-inquiry', JSON.stringify(item)), kind: s(item.kind) || 'Project briefing', name: s(item.name), organization: s(item.organization),
      email: s(item.email), sector: s(item.sector), scope: s(item.scope), status: mapped.status, legacy_status: typeof item.status === 'string' ? item.status : null,
      notes: s(item.notes), reason: mapped.reason, created_at: isoOr(item.createdAt, at), updated_at: at,
    };
  });
  const opportunities = objects(data.opportunities).map(item => {
    const checks = defaultChecks() as Record<string, string>;
    const raw = item.checks && typeof item.checks === 'object' ? item.checks as Row : {};
    for (const k of CHECK_KEYS) if ((CHECK_VALUES as readonly unknown[]).includes(raw[k])) checks[k] = raw[k] as string;
    return {
      id: s(item.id) || stableId('legacy-opportunity', JSON.stringify(item)), title: s(item.title) || 'Untitled opportunity', agency: s(item.agency), url: s(item.url),
      deadline: isIsoDate(item.deadline) ? item.deadline : '', value: s(item.value), naics: s(item.naics), psc: s(item.psc),
      stage: oneOf(item.stage, OPPORTUNITY_STAGES, 'Discover'), decision: oneOf(item.decision, OPPORTUNITY_DECISIONS, 'Undecided'), owner: s(item.owner), notes: s(item.notes),
      checks: JSON.stringify(checks), status: oneOf(item.status, OPPORTUNITY_STATUSES, 'Tentative'), created_at: at, updated_at: at,
    };
  });
  const activity = objects(data.activity).map(item => ({
    id: stableId('legacy-activity', s(item.text) + '|' + s(item.date)), occurred_at: isoOr(item.date, at), summary: s(item.text).slice(0, 300) || 'Legacy activity entry',
  }));
  const stripped = { ...data };
  for (const k of LEGACY_KEYS) delete stripped[k];
  const counts = { inquiries: inquiries.length, opportunities: opportunities.length, activity: activity.length };
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const j = (path: string) => `json_extract(value, '$.${path}')`;
  const results = await db().batch([
    db().prepare('INSERT OR IGNORE INTO workspace_snapshots (id, workspace_id, revision, data, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(`pre-workflow-r${stored.revision}`, WORKSPACE_ID, stored.revision, JSON.stringify(data), 'Before moving inquiries, opportunities and activity into workflow tables', at),
    db().prepare(`INSERT OR IGNORE INTO inquiries (id, kind, name, organization, email, sector, scope, status, legacy_status, notes, reason, source, version, created_at, updated_at)
      SELECT ${['id', 'kind', 'name', 'organization', 'email', 'sector', 'scope', 'status', 'legacy_status', 'notes', 'reason'].map(j).join(', ')}, 'legacy-import', 1, ${j('created_at')}, ${j('updated_at')} FROM json_each(?)`)
      .bind(JSON.stringify(inquiries)),
    db().prepare(`INSERT OR IGNORE INTO opportunities (id, title, agency, url, deadline, value, naics, psc, stage, decision, owner, notes, checks, status, version, created_at, updated_at)
      SELECT ${['id', 'title', 'agency', 'url', 'deadline', 'value', 'naics', 'psc', 'stage', 'decision', 'owner', 'notes', 'checks', 'status'].map(j).join(', ')}, 1, ${j('created_at')}, ${j('updated_at')} FROM json_each(?)`)
      .bind(JSON.stringify(opportunities)),
    // An entry already imported (same text and time) is skipped even if its id differs, so a
    // document rebuilt for a rollback (lib/legacy-rollback.ts) never duplicates activity.
    db().prepare(`INSERT OR IGNORE INTO activity_events (id, occurred_at, actor, type, subject_type, subject_id, summary, details)
      SELECT ${j('id')}, ${j('occurred_at')}, 'system:legacy-import', 'legacy.entry', 'workspace', NULL, ${j('summary')}, '{}' FROM json_each(?)
      WHERE NOT EXISTS (SELECT 1 FROM activity_events a WHERE a.type = 'legacy.entry' AND a.summary = ${j('summary')} AND a.occurred_at = ${j('occurred_at')})`)
      .bind(JSON.stringify(activity)),
    db().prepare('UPDATE workspaces SET data = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
      .bind(JSON.stringify(stripped), at, WORKSPACE_ID, stored.revision),
    db().prepare(`INSERT OR IGNORE INTO activity_events (id, occurred_at, actor, type, subject_type, subject_id, summary, details)
      SELECT ?, ?, 'system:legacy-import', 'workflow.imported', 'workspace', NULL, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND revision = ? AND updated_at = ?)`)
      .bind(`workflow-import-r${stored.revision}`, at, `Moved ${plural(counts.inquiries, 'inquiry', 'inquiries')}, ${plural(counts.opportunities, 'opportunity', 'opportunities')} and ${plural(counts.activity, 'activity entry', 'activity entries')} into workflow records`, JSON.stringify(counts), WORKSPACE_ID, stored.revision + 1, at),
  ]);
  return { imported: Boolean(results[4].meta.changes), ...counts };
}
