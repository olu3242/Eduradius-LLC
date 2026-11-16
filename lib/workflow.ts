// Shared workflow domain: types, validation, status transitions, follow-up dates and
// conversion mapping. Imported by both the workspace UI and the server routes so the
// rules cannot drift. No server-only imports here.
import { PRACTICE_INQUIRIES } from './inquiry';

/** Business timezone for every due-date calculation (EduRadius is based in San Antonio, TX). */
export const BUSINESS_TIME_ZONE = 'America/Chicago';

export const INQUIRY_STATUSES = ['New', 'Reviewing', 'Awaiting information', 'Qualified', 'Converted', 'Closed'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
/** Statuses an owner may set directly. `Converted` is only set by the conversion endpoint. */
export const EDITABLE_INQUIRY_STATUSES = INQUIRY_STATUSES.filter(s => s !== 'Converted');
export const CLOSED_INQUIRY_STATUSES: readonly InquiryStatus[] = ['Converted', 'Closed'];
/** Moving into these statuses requires a recorded reason. */
export const REASON_REQUIRED: readonly InquiryStatus[] = ['Qualified', 'Closed'];
const TRANSITIONS: Record<InquiryStatus, readonly InquiryStatus[]> = {
  New: ['Reviewing', 'Awaiting information', 'Qualified', 'Closed'],
  Reviewing: ['New', 'Awaiting information', 'Qualified', 'Closed'],
  'Awaiting information': ['Reviewing', 'Qualified', 'Closed'],
  Qualified: ['Reviewing', 'Awaiting information', 'Closed'],
  Converted: [],
  Closed: ['Reviewing'],
};
export const allowedTransitions = (from: InquiryStatus) => TRANSITIONS[from] ?? [];

export const OPPORTUNITY_STAGES = ['Discover', 'Qualify', 'Prepare', 'Review', 'Closed'] as const;
export const OPPORTUNITY_DECISIONS = ['Undecided', 'Go', 'No-go', 'Hold'] as const;
export const OPPORTUNITY_STATUSES = ['Complete', 'Missing', 'Tentative', 'Awaiting review'] as const;
export const CHECK_KEYS = ['scope', 'eligibility', 'capacity', 'evidence', 'deadline'] as const;
export const CHECK_VALUES = ['Unknown', 'Yes', 'No'] as const;
export const defaultChecks = (): Record<(typeof CHECK_KEYS)[number], string> => ({ scope: 'Unknown', eligibility: 'Unknown', capacity: 'Unknown', evidence: 'Unknown', deadline: 'Unknown' });

export type InquiryRecord = {
  id: string; kind: string; name: string; organization: string; email: string; sector: string; scope: string;
  status: InquiryStatus; legacyStatus: string | null; assignee: string; nextAction: string; nextActionDue: string | null;
  notes: string; reason: string; opportunityId: string | null; source: string; version: number; createdAt: string; updatedAt: string;
};
export type OpportunityRecord = {
  id: string; sourceInquiryId: string | null; title: string; agency: string; url: string; deadline: string; value: string;
  naics: string; psc: string; stage: string; decision: string; owner: string; notes: string; checks: Record<string, string>;
  status: string; contactName: string; contactEmail: string; sector: string; service: string; nextAction: string;
  nextActionDue: string | null; version: number; createdAt: string; updatedAt: string;
};
export type ActivityRecord = { id: string; occurredAt: string; actor: string; type: string; subjectType: string; subjectId: string | null; summary: string; details: Record<string, unknown> };
export type NotificationRecord = { id: string; kind: string; subjectType: string; subjectId: string | null; title: string; createdAt: string; readAt: string | null; emailStatus: string };
export type WorkflowSnapshot = { inquiries: InquiryRecord[]; opportunities: OpportunityRecord[]; activity: ActivityRecord[]; notifications: NotificationRecord[]; businessTimeZone: string; today: string };
export type ActivityDraft = { type: string; summary: string; details?: Record<string, unknown> };

// ── Field validation ────────────────────────────────────────────────────────

export const INQUIRY_LIMITS = { assignee: 120, nextAction: 300, notes: 8000, reason: 1000 } as const;
export const OPPORTUNITY_LIMITS = { title: 200, agency: 200, url: 500, value: 20, naics: 20, psc: 20, owner: 120, notes: 8000, contactName: 120, contactEmail: 254, sector: 80, service: 80, nextAction: 300 } as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
function text(value: unknown, label: string, max: number): Result<string> {
  if (value === undefined || value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return fail(`${label} must be text.`);
  const trimmed = value.trim();
  return trimmed.length > max ? fail(`${label} must be ${max} characters or fewer.`) : { ok: true, value: trimmed };
}
function dueDate(value: unknown, label: string): Result<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  return isIsoDate(value) ? { ok: true, value } : fail(`${label} must be a valid date.`);
}

// ── Inquiry edits and transitions ───────────────────────────────────────────

export type InquiryPatch = Partial<{ status: string; assignee: string; nextAction: string; nextActionDue: string | null; notes: string; reason: string }>;
const PATCH_KEYS = new Set(['status', 'assignee', 'nextAction', 'nextActionDue', 'notes', 'reason']);

/**
 * Validates an owner edit against the current record and returns the next record plus
 * the activity it implies. Pure: the caller supplies timestamps and identity.
 */
export function applyInquiryPatch(current: InquiryRecord, patch: unknown): { ok: true; next: InquiryRecord; events: ActivityDraft[] } | { ok: false; error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return fail('Invalid changes.');
  const keys = Object.keys(patch);
  const unknown = keys.filter(k => !PATCH_KEYS.has(k));
  if (unknown.length) return fail(`Unsupported field: ${unknown.join(', ')}.`);
  if (!keys.length) return fail('No changes supplied.');
  const p = patch as Record<string, unknown>;
  const next: InquiryRecord = { ...current };
  if (current.status === 'Converted' && keys.some(k => k !== 'notes')) return fail('A converted inquiry is kept for reference; only internal notes can change.');

  for (const field of ['assignee', 'nextAction', 'notes', 'reason'] as const) {
    if (!(field in p)) continue;
    const r = text(p[field], { assignee: 'Assigned owner', nextAction: 'Next action', notes: 'Internal notes', reason: 'Reason' }[field], INQUIRY_LIMITS[field]);
    if (!r.ok) return r;
    next[field] = r.value;
  }
  if ('nextActionDue' in p) { const r = dueDate(p.nextActionDue, 'Next-action due date'); if (!r.ok) return r; next.nextActionDue = r.value; }
  if (next.nextActionDue && !next.nextAction) return fail('Describe the next action before setting a due date.');

  if ('status' in p && p.status !== current.status) {
    const to = p.status as InquiryStatus;
    if (!INQUIRY_STATUSES.includes(to)) return fail('Unknown status.');
    if (to === 'Converted') return fail('Use “Convert to opportunity” to convert an inquiry.');
    if (!allowedTransitions(current.status).includes(to)) return fail(`An inquiry cannot move from ${current.status} to ${to}.`);
    if (REASON_REQUIRED.includes(to) && !(typeof p.reason === 'string' && p.reason.trim())) return fail(`Record a reason when marking an inquiry ${to}.`);
    next.status = to;
  }

  const events: ActivityDraft[] = [];
  if (next.status !== current.status) {
    if (current.status === 'New') events.push({ type: 'inquiry.reviewed', summary: 'Inquiry reviewed' });
    events.push({ type: 'inquiry.status_changed', summary: `Status changed from ${current.status} to ${next.status}`, details: { from: current.status, to: next.status, ...(next.reason && REASON_REQUIRED.includes(next.status) ? { reason: next.reason.slice(0, 200) } : {}) } });
  }
  if (next.assignee !== current.assignee) events.push({ type: 'inquiry.assigned', summary: next.assignee ? `Assigned to ${next.assignee}` : 'Assignment cleared', details: { from: current.assignee, to: next.assignee } });
  const hadFollowUp = Boolean(current.nextAction), hasFollowUp = Boolean(next.nextAction);
  if (!hadFollowUp && hasFollowUp) events.push({ type: 'followup.created', summary: `Follow-up scheduled${next.nextActionDue ? ` for ${next.nextActionDue}` : ''}`, details: { due: next.nextActionDue } });
  else if (hadFollowUp && !hasFollowUp) events.push({ type: 'followup.completed', summary: 'Follow-up completed', details: { due: current.nextActionDue } });
  else if (hasFollowUp && (next.nextAction !== current.nextAction || next.nextActionDue !== current.nextActionDue)) events.push({ type: 'followup.updated', summary: `Follow-up updated${next.nextActionDue ? ` (due ${next.nextActionDue})` : ''}`, details: { due: next.nextActionDue } });
  if (next.notes !== current.notes) events.push({ type: 'inquiry.notes_updated', summary: 'Internal notes updated' });
  if (next.reason !== current.reason && !events.some(e => e.type === 'inquiry.status_changed')) events.push({ type: 'inquiry.reason_updated', summary: 'Recorded reason updated' });
  return { ok: true, next, events };
}

/** Maps pre-workflow inquiry statuses (the generic review statuses) to the workflow. */
export function mapLegacyInquiryStatus(value: unknown): { status: InquiryStatus; reason: string } {
  if (typeof value === 'string' && (INQUIRY_STATUSES as readonly string[]).includes(value) && value !== 'Converted') return { status: value as InquiryStatus, reason: '' };
  switch (value) {
    case 'Tentative': return { status: 'Reviewing', reason: '' };
    case 'Missing': return { status: 'Awaiting information', reason: '' };
    case 'Complete': return { status: 'Closed', reason: 'Marked Complete before the workflow migration.' };
    default: return { status: 'New', reason: '' }; // 'Awaiting review', blank or unknown
  }
}

// ── Opportunities ───────────────────────────────────────────────────────────

export type OpportunityInput = Omit<OpportunityRecord, 'id' | 'sourceInquiryId' | 'version' | 'createdAt' | 'updatedAt'>;
const OPPORTUNITY_KEYS = new Set<string>([...Object.keys(OPPORTUNITY_LIMITS), 'deadline', 'stage', 'decision', 'status', 'checks', 'nextActionDue']);
export const emptyOpportunity = (): OpportunityInput => ({ title: '', agency: '', url: '', deadline: '', value: '', naics: '', psc: '', stage: 'Discover', decision: 'Undecided', owner: '', notes: '', checks: defaultChecks(), status: 'Tentative', contactName: '', contactEmail: '', sector: '', service: '', nextAction: '', nextActionDue: null });

/** Validates a full (create) or partial (update) opportunity payload. */
export function validateOpportunity(input: unknown, base: OpportunityInput = emptyOpportunity()): Result<OpportunityInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Invalid opportunity.');
  const p = input as Record<string, unknown>;
  const unknown = Object.keys(p).filter(k => !OPPORTUNITY_KEYS.has(k));
  if (unknown.length) return fail(`Unsupported field: ${unknown.join(', ')}.`);
  const out: OpportunityInput = { ...base, checks: { ...base.checks } };
  const labels: Record<string, string> = { title: 'Opportunity title', agency: 'Agency / customer', url: 'Solicitation URL / reference', value: 'Estimated value', naics: 'Solicitation NAICS', psc: 'Solicitation PSC', owner: 'Owner', notes: 'Notes', contactName: 'Contact name', contactEmail: 'Contact email', sector: 'Sector', service: 'Service', nextAction: 'Next action' };
  for (const [field, max] of Object.entries(OPPORTUNITY_LIMITS) as [keyof typeof OPPORTUNITY_LIMITS, number][]) {
    if (!(field in p)) continue;
    const r = text(p[field], labels[field], max); if (!r.ok) return r;
    out[field] = r.value;
  }
  if ('deadline' in p) { const r = dueDate(p.deadline, 'Response deadline'); if (!r.ok) return r; out.deadline = r.value ?? ''; }
  if ('nextActionDue' in p) { const r = dueDate(p.nextActionDue, 'Next-action due date'); if (!r.ok) return r; out.nextActionDue = r.value; }
  for (const [field, allowed] of [['stage', OPPORTUNITY_STAGES], ['decision', OPPORTUNITY_DECISIONS], ['status', OPPORTUNITY_STATUSES]] as const) {
    if (field in p && !(allowed as readonly unknown[]).includes(p[field])) return fail(`Unknown ${field}.`);
    if (field in p) out[field] = p[field] as string;
  }
  if ('checks' in p) {
    const c = p.checks;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return fail('Invalid qualification checklist.');
    for (const [k, v] of Object.entries(c)) {
      if (!(CHECK_KEYS as readonly string[]).includes(k) || !(CHECK_VALUES as readonly unknown[]).includes(v)) return fail('Invalid qualification checklist.');
      out.checks[k] = v as string;
    }
  }
  if (!out.title) return fail('Opportunity title is required.');
  if (out.value && !/^\d+(\.\d{1,2})?$/.test(out.value)) return fail('Estimated value must be a number.');
  if (out.contactEmail && !EMAIL.test(out.contactEmail)) return fail('Contact email must be a valid address.');
  if (out.nextActionDue && !out.nextAction) return fail('Describe the next action before setting a due date.');
  return { ok: true, value: out };
}

/** Activity implied by an opportunity edit (field names only; no contact details). */
export function opportunityEvents(before: OpportunityInput, after: OpportunityInput): ActivityDraft[] {
  const changed = (Object.keys(after) as (keyof OpportunityInput)[]).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const events: ActivityDraft[] = [];
  const followUpFields = ['nextAction', 'nextActionDue'];
  const other = changed.filter(k => !followUpFields.includes(k));
  if (other.length) events.push({ type: 'opportunity.updated', summary: `Opportunity updated: ${other.join(', ')}`, details: { fields: other } });
  if (!before.nextAction && after.nextAction) events.push({ type: 'followup.created', summary: `Follow-up scheduled${after.nextActionDue ? ` for ${after.nextActionDue}` : ''}`, details: { due: after.nextActionDue } });
  else if (before.nextAction && !after.nextAction) events.push({ type: 'followup.completed', summary: 'Follow-up completed', details: { due: before.nextActionDue } });
  else if (after.nextAction && (before.nextAction !== after.nextAction || before.nextActionDue !== after.nextActionDue)) events.push({ type: 'followup.updated', summary: `Follow-up updated${after.nextActionDue ? ` (due ${after.nextActionDue})` : ''}`, details: { due: after.nextActionDue } });
  return events;
}

/** Editable review draft for converting a qualified inquiry. */
export function conversionDraft(inquiry: InquiryRecord): OpportunityInput {
  const service = Object.entries(PRACTICE_INQUIRIES).find(([, kind]) => kind === inquiry.kind)?.[0] ?? '';
  const submitted = inquiry.createdAt.slice(0, 10);
  return {
    ...emptyOpportunity(),
    title: `${inquiry.organization} — ${inquiry.kind}`.slice(0, OPPORTUNITY_LIMITS.title),
    agency: inquiry.organization.slice(0, OPPORTUNITY_LIMITS.agency),
    stage: 'Qualify', owner: inquiry.assignee,
    notes: `Scope from inquiry submitted ${submitted}:\n${inquiry.scope}`.slice(0, OPPORTUNITY_LIMITS.notes),
    contactName: inquiry.name, contactEmail: inquiry.email, sector: inquiry.sector.slice(0, OPPORTUNITY_LIMITS.sector), service,
    nextAction: inquiry.nextAction, nextActionDue: inquiry.nextActionDue,
  };
}

// ── Follow-up queue (business timezone) ─────────────────────────────────────

/** Calendar date (YYYY-MM-DD) in the business timezone for the given instant. */
export function businessDate(now: Date = new Date(), timeZone = BUSINESS_TIME_ZONE): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export type DueState = 'none' | 'overdue' | 'today' | 'upcoming';
export function dueState(due: string | null, today: string): DueState {
  if (!due) return 'none';
  return due < today ? 'overdue' : due === today ? 'today' : 'upcoming';
}
export type FollowUpItem = { kind: 'inquiry' | 'opportunity'; id: string; title: string; status: string; assignee: string; nextAction: string; due: string | null; dueState: DueState };
export type FollowUpQueue = { unassigned: FollowUpItem[]; overdue: FollowUpItem[]; dueToday: FollowUpItem[]; awaitingConversion: FollowUpItem[]; opportunitiesNeedingAction: FollowUpItem[] };
export const isOpenInquiry = (i: InquiryRecord) => !CLOSED_INQUIRY_STATUSES.includes(i.status);

export function followUpQueue(inquiries: InquiryRecord[], opportunities: OpportunityRecord[], today: string): FollowUpQueue {
  const inq = (i: InquiryRecord): FollowUpItem => ({ kind: 'inquiry', id: i.id, title: i.organization || i.name, status: i.status, assignee: i.assignee, nextAction: i.nextAction, due: i.nextActionDue, dueState: dueState(i.nextActionDue, today) });
  const opp = (o: OpportunityRecord): FollowUpItem => ({ kind: 'opportunity', id: o.id, title: o.title, status: o.stage, assignee: o.owner, nextAction: o.nextAction, due: o.nextActionDue, dueState: dueState(o.nextActionDue, today) });
  const openInquiries = inquiries.filter(isOpenInquiry).map(inq);
  const openOpportunities = opportunities.filter(o => o.stage !== 'Closed').map(opp);
  const scheduled = [...openInquiries, ...openOpportunities].filter(i => i.nextAction);
  const byDue = (a: FollowUpItem, b: FollowUpItem) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title);
  return {
    unassigned: openInquiries.filter(i => !i.assignee),
    overdue: scheduled.filter(i => i.dueState === 'overdue').sort(byDue),
    dueToday: scheduled.filter(i => i.dueState === 'today').sort(byDue),
    awaitingConversion: inquiries.filter(i => i.status === 'Qualified' && !i.opportunityId).map(inq),
    opportunitiesNeedingAction: openOpportunities.filter(o => !o.nextAction || o.dueState === 'overdue').sort(byDue),
  };
}

/** Readable actor label; raw actor ids stay server-side identifiers. */
export function actorLabel(actor: string) {
  if (actor === 'public') return 'Website visitor';
  if (actor.startsWith('system:')) return 'System migration';
  return 'Workspace owner';
}

/** Owner backup: the planning document plus every workflow record (schema version 2). */
export function exportBundle(document: unknown, workflow: Pick<WorkflowSnapshot, 'inquiries' | 'opportunities' | 'activity' | 'businessTimeZone'>, now: Date = new Date()) {
  return {
    schemaVersion: 2 as const,
    exportedAt: now.toISOString(),
    workspace: document,
    workflow: { businessTimeZone: workflow.businessTimeZone, inquiries: workflow.inquiries, opportunities: workflow.opportunities, activity: workflow.activity },
  };
}
