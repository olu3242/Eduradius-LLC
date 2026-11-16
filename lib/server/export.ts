// Complete owner export (GET /api/export). Server-only.
// Every table is read in ONE D1 batch, which D1 executes as a single transaction, so the
// export is a consistent snapshot even while owners keep editing. Nothing is truncated:
// if the dataset exceeds the limits below, the request fails with 413 instead.
// Ordering matches the earlier export format: requests newest first, opportunities by last
// update, activity newest first, other records oldest first.
import { SPECS, type EvidenceLink } from '../records';
import { BUSINESS_TIME_ZONE, exportBundle, type ActivityRecord, type InquiryRecord, type OpportunityRecord } from '../workflow';
import { db, toRecord } from './records-store';
import { INQUIRY_SELECT, OPPORTUNITY_SELECT, toInquiry, toOpportunity } from './workflow-store';
import { WORKSPACE_ID } from './workspace-store';

export const EXPORT_MAX_ROWS = 200_000;
export const EXPORT_MAX_BYTES = 60 * 1024 * 1024;
type Row = Record<string, unknown>;
const tables = () => [['inquiries', 'inquiries'], ['opportunities', 'opportunities'], ['activity_events', 'activity'], ['evidence_links', 'evidenceLinks'], ...Object.entries(SPECS).map(([type, spec]) => [spec.table, type])];

export type ExportResult = { ok: true; body: string; counts: Record<string, number> } | { ok: false; status: 413; error: string; counts: Record<string, number> };

export async function buildExport(now = new Date(), limits: { maxRows?: number; maxBytes?: number } = {}): Promise<ExportResult> {
  const maxRows = limits.maxRows ?? EXPORT_MAX_ROWS, maxBytes = limits.maxBytes ?? EXPORT_MAX_BYTES;
  const countSql = `SELECT ${tables().map(([table, key]) => `(SELECT COUNT(*) FROM ${table}) AS "${key}"`).join(', ')}`;
  const estimate = Object.fromEntries(Object.entries((await db().prepare(countSql).first<Row>())!).map(([k, v]) => [k, Number(v)]));
  const totalRows = Object.values(estimate).reduce((a, b) => a + b, 0);
  if (totalRows > maxRows) return { ok: false, status: 413, counts: estimate, error: `The workspace holds ${totalRows} records, more than a single export supports (${maxRows}). Nothing was exported; ask an operator for a database backup instead.` };

  const specTypes = Object.keys(SPECS);
  const results = await db().batch([
    db().prepare('SELECT data, revision FROM workspaces WHERE id = ?').bind(WORKSPACE_ID),
    db().prepare(`SELECT ${INQUIRY_SELECT} FROM inquiries ORDER BY created_at DESC, id DESC`),
    db().prepare(`SELECT ${OPPORTUNITY_SELECT} FROM opportunities ORDER BY updated_at DESC, id DESC`),
    db().prepare('SELECT id, occurred_at, actor, type, subject_type, subject_id, summary, details FROM activity_events ORDER BY occurred_at DESC, rowid DESC'),
    db().prepare('SELECT id, evidence_id, subject_type, subject_id, created_at FROM evidence_links ORDER BY created_at, rowid'),
    ...specTypes.map(type => db().prepare(`SELECT * FROM ${SPECS[type].table} ORDER BY created_at, rowid`)),
  ]);
  const [doc, inquiries, opportunities, activity, links, ...typed] = results.map(r => r.results as Row[]);
  const records = Object.fromEntries(specTypes.map((type, i) => [type, typed[i].map(row => toRecord(SPECS[type], row))]));
  const workflow = {
    businessTimeZone: BUSINESS_TIME_ZONE,
    inquiries: inquiries.map(toInquiry) as InquiryRecord[],
    opportunities: opportunities.map(toOpportunity) as OpportunityRecord[],
    activity: activity.map(r => { let details = {}; try { details = JSON.parse(String(r.details)); } catch { /* keep empty */ } return { id: String(r.id), occurredAt: String(r.occurred_at), actor: String(r.actor), type: String(r.type), subjectType: String(r.subject_type), subjectId: (r.subject_id as string | null) ?? null, summary: String(r.summary), details }; }) as ActivityRecord[],
    evidenceLinks: links.map(r => ({ id: String(r.id), evidenceId: String(r.evidence_id), subjectType: String(r.subject_type), subjectId: String(r.subject_id), createdAt: String(r.created_at) })) as EvidenceLink[],
    records,
  };
  const counts: Record<string, number> = { inquiries: workflow.inquiries.length, opportunities: workflow.opportunities.length, activity: workflow.activity.length, evidenceLinks: workflow.evidenceLinks.length, ...Object.fromEntries(specTypes.map(t => [t, records[t].length])) };
  const document = doc[0] ? JSON.parse(String(doc[0].data)) : null;
  const bundle = { ...exportBundle(document, workflow, now), manifest: { counts, consistency: 'single-transaction snapshot', workspaceRevision: doc[0] ? Number(doc[0].revision) : 0 } };
  const body = JSON.stringify(bundle);
  if (body.length > maxBytes) return { ok: false, status: 413, counts, error: `The export would be ${Math.round(body.length / 1048576)} MB, more than a single download supports. Nothing was exported; ask an operator for a database backup instead.` };
  return { ok: true, body, counts };
}
