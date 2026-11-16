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
export function legacyDocument(current: Record<string, unknown> | null, workflow: LegacyInput, base: Record<string, unknown>) {
  const document: Record<string, unknown> = { ...base, ...(current ?? {}) };
  // Requests oldest first, as v5 stored them. An unchanged imported request keeps its original legacy status.
  const inquiries = [...workflow.inquiries].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(i => ({
    id: i.id, name: i.name, organization: i.organization, email: i.email, sector: i.sector, scope: i.scope, kind: i.kind, createdAt: i.createdAt,
    status: i.legacyStatus && FORWARD[i.legacyStatus] === i.status ? i.legacyStatus : LEGACY_STATUS[i.status] ?? 'Awaiting review',
    notes: [i.notes, i.assignee ? `Assigned: ${i.assignee}` : '', i.nextAction ? `Next action: ${i.nextAction}${i.nextActionDue ? ` (due ${i.nextActionDue})` : ''}` : ''].filter(Boolean).join('\n'),
  }));
  const opportunities = [...workflow.opportunities].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(o => ({
    id: o.id, title: o.title, agency: o.agency, url: o.url, deadline: o.deadline, value: o.value, naics: o.naics, psc: o.psc, stage: o.stage, decision: o.decision,
    owner: o.owner, notes: o.notes, checks: o.checks, status: o.status,
  }));
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
