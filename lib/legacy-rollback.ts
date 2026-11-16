// Rollback support for returning to the pre-workflow application (Site v5, before migration
// 0002). That code keeps requests, opportunities and activity inside the workspace JSON and
// rejects saves without an `opportunities` array, so after the JSON → table import a code-only
// rollback would hide every request and make the workspace unsavable.
//
// legacyDocument() rebuilds the legacy arrays from the CURRENT workflow tables (ids preserved,
// statuses mapped back), so v5 can read and save again. The workflow and contracting tables are
// not modified and stay authoritative: when this release is deployed again the import is
// idempotent (existing ids and legacy activity are skipped), so nothing is duplicated.
import type { ActivityRecord, InquiryRecord, InquiryStatus, OpportunityRecord } from './workflow';

/** Site v5's PUT /api/workspace limit (characters of the JSON body). */
export const LEGACY_MAX_BYTES = 700_000;
const LEGACY_STATUS: Record<InquiryStatus, string> = {
  New: 'Awaiting review', Reviewing: 'Tentative', 'Awaiting information': 'Missing', Qualified: 'Tentative', Converted: 'Complete', Closed: 'Complete',
};
const FORWARD: Record<string, InquiryStatus> = { Tentative: 'Reviewing', Missing: 'Awaiting information', Complete: 'Closed', 'Awaiting review': 'New' };

export type LegacyInput = { inquiries: InquiryRecord[]; opportunities: OpportunityRecord[]; activity: ActivityRecord[] };
export const LEGACY_INQUIRY_FIELDS = ['name', 'organization', 'email', 'sector', 'scope', 'kind', 'status', 'notes'] as const;
export const LEGACY_OPPORTUNITY_FIELDS = ['title', 'agency', 'url', 'deadline', 'value', 'naics', 'psc', 'stage', 'decision', 'owner', 'notes', 'checks', 'status'] as const;

/** The legacy (v5) form of a request. An unchanged imported request keeps its original legacy status. */
export const legacyInquiry = (i: InquiryRecord) => ({
  id: i.id, name: i.name, organization: i.organization, email: i.email, sector: i.sector, scope: i.scope, kind: i.kind, createdAt: i.createdAt,
  status: i.legacyStatus && FORWARD[i.legacyStatus] === i.status ? i.legacyStatus : LEGACY_STATUS[i.status] ?? 'Awaiting review',
  notes: [i.notes, i.assignee ? `Assigned: ${i.assignee}` : '', i.nextAction ? `Next action: ${i.nextAction}${i.nextActionDue ? ` (due ${i.nextActionDue})` : ''}` : ''].filter(Boolean).join('\n'),
});
export const legacyOpportunity = (o: OpportunityRecord) => ({
  id: o.id, title: o.title, agency: o.agency, url: o.url, deadline: o.deadline, value: o.value, naics: o.naics, psc: o.psc, stage: o.stage, decision: o.decision,
  owner: o.owner, notes: o.notes, checks: o.checks, status: o.status,
});
const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const sortKeys = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, sortKeys((v as Record<string, unknown>)[k])])) : v);
/** The comparable fields of a legacy item, as strings (checks as canonical JSON). */
export function comparable(kind: 'inquiry' | 'opportunity', item: Record<string, unknown>) {
  const fields = kind === 'inquiry' ? LEGACY_INQUIRY_FIELDS : LEGACY_OPPORTUNITY_FIELDS;
  return Object.fromEntries(fields.map(f => [f, f === 'checks' ? JSON.stringify(sortKeys(item[f] ?? {})) : str(item[f]).trim()])) as Record<string, string>;
}
/** Fingerprint of a legacy item's comparable fields (SHA-256, hex). */
export async function fingerprint(kind: 'inquiry' | 'opportunity', item: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(comparable(kind, item)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const differingFields = (kind: 'inquiry' | 'opportunity', a: Record<string, unknown>, b: Record<string, unknown>) => {
  const x = comparable(kind, a), y = comparable(kind, b);
  return Object.keys(x).filter(k => x[k] !== y[k]);
};
/** Top-level document key read back by the forward import to detect rollback-window edits. */
export const ROLLBACK_MARKER = '_rollback';

export function legacyDocument(current: Record<string, unknown> | null, workflow: LegacyInput, base: Record<string, unknown>) {
  const document: Record<string, unknown> = { ...base, ...(current ?? {}) };
  delete document[ROLLBACK_MARKER];
  // Requests and opportunities oldest first, as v5 stored them.
  const inquiries = [...workflow.inquiries].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(legacyInquiry);
  const opportunities = [...workflow.opportunities].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(legacyOpportunity);
  // Only entries that came from the legacy document are returned to it (oldest first); workflow
  // activity stays in activity_events, where it is kept and not shown by v5.
  const legacyActivity = workflow.activity.filter(a => a.type === 'legacy.entry');
  const activity = [...legacyActivity].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map(a => ({ text: a.summary, date: a.occurredAt }));
  Object.assign(document, { inquiries, opportunities, activity });
  const bytes = JSON.stringify(document).length;
  return { document, bytes, fitsLegacyLimit: bytes <= LEGACY_MAX_BYTES, counts: { inquiries: inquiries.length, opportunities: opportunities.length, activity: activity.length, activityKeptInTablesOnly: workflow.activity.length - legacyActivity.length } };
}

/** The checks Site v5's PUT /api/workspace applies before accepting a document. */
export function acceptedByLegacySave(document: Record<string, unknown>) {
  return Boolean(document.profile) && Array.isArray(document.codes) && Array.isArray(document.opportunities) && Array.isArray(document.documents) && JSON.stringify({ data: document, revision: 1 }).length <= LEGACY_MAX_BYTES;
}

/** Adds fingerprints of every item handed to v5, so the forward import can tell which were edited. */
export async function withRollbackMarker(document: Record<string, unknown>, createdAt: string) {
  const fingerprints: Record<string, string> = {};
  for (const i of document.inquiries as Record<string, unknown>[]) fingerprints[`inquiry:${i.id}`] = await fingerprint('inquiry', i);
  for (const o of document.opportunities as Record<string, unknown>[]) fingerprints[`opportunity:${o.id}`] = await fingerprint('opportunity', o);
  return { ...document, [ROLLBACK_MARKER]: { createdAt, fingerprints } };
}
