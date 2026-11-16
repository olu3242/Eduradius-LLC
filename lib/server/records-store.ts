// Generic persistence for spec-defined records (lib/records.ts). Server-only.
// One table per type is the authoritative source; every write is version-checked and
// recorded in activity with a server-derived actor and timestamp.
import { env } from 'cloudflare:workers';
import { SPECS, defaults, validateRecord, validateSections, findCycle, organizationKey, websiteDomain, emailKey, evidenceState, type TypeSpec, type Values, type EvidenceLink } from '../records';
import { businessDate, type ActivityDraft } from '../workflow';
import { activityStatement, type StoreResult } from './workflow-store';

type Row = Record<string, unknown>;
export function db(): D1Database {
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  return env.DB;
}
export const nowIso = () => new Date().toISOString();
const EXTERNAL_TABLES: Record<string, string> = { opportunity: 'opportunities', inquiry: 'inquiries' };
export const tableFor = (type: string): string | undefined => SPECS[type]?.table ?? EXTERNAL_TABLES[type];
const parse = (v: unknown, fallback: unknown) => { try { return v === null || v === undefined || v === '' ? fallback : JSON.parse(String(v)); } catch { return fallback; } };

export function toRecord(spec: TypeSpec, row: Row): Values {
  const out: Values = { id: row.id, version: Number(row.version), createdAt: row.created_at, updatedAt: row.updated_at };
  for (const field of spec.fields) {
    const v = row[field.column];
    out[field.key] = field.kind === 'bool' ? Boolean(v) : field.kind === 'refs' ? parse(v, []) : field.kind === 'json' ? parse(v, {}) : v ?? (['date', 'ref'].includes(field.kind) ? null : '');
  }
  return out;
}
export const toColumn = (kind: string, value: unknown) => (kind === 'bool' ? (value ? 1 : 0) : kind === 'refs' || kind === 'json' ? JSON.stringify(value ?? (kind === 'refs' ? [] : {})) : value ?? null);

export async function getRecord(type: string, id: string): Promise<Values | null> {
  const spec = SPECS[type]; if (!spec) return null;
  const row = await db().prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).bind(id).first<Row>();
  return row ? toRecord(spec, row) : null;
}
export async function listRecords(type: string): Promise<Values[]> {
  const spec = SPECS[type];
  return (await db().prepare(`SELECT * FROM ${spec.table} ORDER BY created_at, rowid`).all<Row>()).results.map(r => toRecord(spec, r));
}
export async function recordExists(type: string, id: string) {
  const table = tableFor(type); if (!table) return false;
  return Boolean(await db().prepare(`SELECT 1 AS found FROM ${table} WHERE id = ?`).bind(id).first());
}
export async function listEvidenceLinks(): Promise<EvidenceLink[]> {
  return (await db().prepare('SELECT id, evidence_id, subject_type, subject_id, created_at FROM evidence_links ORDER BY created_at, rowid').all<Row>()).results
    .map(r => ({ id: String(r.id), evidenceId: String(r.evidence_id), subjectType: String(r.subject_type), subjectId: String(r.subject_id), createdAt: String(r.created_at) }));
}
export async function listAllRecords() {
  const entries = await Promise.all(Object.keys(SPECS).map(async type => [type, await listRecords(type)] as const));
  return { records: Object.fromEntries(entries) as Record<string, Values[]>, evidenceLinks: await listEvidenceLinks() };
}

// ── Hooks: derived fields, cross-record rules, duplicate detection ──────────

type Hook = {
  derive?: (v: Values) => Values;
  validate?: (v: Values, current: Values | null) => Promise<string | null>;
  /** Server-side consequences of an edit (may set read-only fields and add activity). */
  adjust?: (v: Values, current: Values, changed: string[]) => { value: Values; events?: ActivityDraft[] };
};
async function linkedEvidence(subjectType: string, subjectId: string): Promise<Values[]> {
  const rows = (await db().prepare('SELECT e.* FROM evidence e JOIN evidence_links l ON l.evidence_id = e.id WHERE l.subject_type = ? AND l.subject_id = ?').bind(subjectType, subjectId).all<Row>()).results;
  return rows.map(r => toRecord(SPECS.evidence, r));
}
export const HOOKS: Record<string, Hook> = {
  organization: { derive: v => ({ ...v, nameKey: organizationKey(String(v.name)), domain: websiteDomain(String(v.website)) }) },
  contact: { derive: v => ({ ...v, emailKey: emailKey(String(v.email)) }) },
  requirement: {
    validate: async (v, current) => {
      const notes = String(v.reviewerNotes ?? '').trim();
      if ((v.status === 'Not met' || v.status === 'Not applicable') && !notes) return `Record reviewer notes explaining why this requirement is ${v.status}.`;
      if (v.status === 'Met' && !notes) {
        const today = businessDate();
        const current_ = current ? (await linkedEvidence('requirement', String(current.id))).filter(e => evidenceState(e, today) === 'current') : [];
        if (!current_.length) return 'Mark Met only with linked evidence that is verified and not expired, or record reviewer notes explaining how it is met.';
      }
      return null;
    },
  },
  evidence: {
    validate: async v => (v.storageKind === 'External link' && !v.url ? 'Provide the approved https link, or choose Reference only.' : v.storageKind === 'Reference only' && v.url ? 'Clear the link or choose External link.' : null),
  },
  proposal: {
    validate: async (v, current) => {
      if (current?.status === 'Internal review') return 'This proposal is locked while it is in owner review. Request changes to edit it.';
      if (current?.status === 'Submitted') return 'A submitted proposal is kept exactly as submitted and cannot be edited.';
      return validateSections(v.sections);
    },
    // Editing approved content creates a new draft that needs owner review again.
    adjust: (v, current, changed) => current.status === 'Approved' && changed.some(k => k === 'sections' || k === 'title')
      ? { value: { ...v, status: 'Draft' }, events: [{ type: 'proposal.reopened', summary: 'Approved proposal edited — a new draft now needs owner review (approved version preserved)' }] }
      : { value: v },
  },
  project: {
    validate: async (v, current) => (current && ['Closed', 'Cancelled'].includes(String(current.status)) ? `This project is ${String(current.status).toLowerCase()}; reopen it to make changes.`
      : v.nextActionDue && !String(v.nextAction).trim() ? 'Describe the next action before setting a due date.' : null),
  },
  milestone: {
    validate: async (v, current) => {
      const locked = await projectLocked(v.projectId); if (locked) return locked;
      if (current?.status === 'Complete') {
        if (v.status === 'Complete' && !sameValues(v, current, ['title', 'plannedDate', 'actualDate', 'completionCriteria', 'dependsOn'])) return 'This milestone is complete. Reopen it with a reason before changing completed work.';
        if (v.status !== 'Complete' && (!String(v.changeNote).trim() || v.changeNote === current.changeNote)) return 'Record the reason for reopening this completed milestone.';
      }
      const siblings = (await listRecords('milestone')).filter(m => m.projectId === v.projectId);
      if (v.status === 'Complete') {
        if (!v.actualDate) return 'Record the actual completion date.';
        const open = (v.dependsOn as string[]).filter(id => siblings.find(m => m.id === id)?.status !== 'Complete');
        if (open.length) return 'Complete the milestones this one depends on first.';
      }
      const graph = siblings.filter(m => m.id !== v.id).map(m => ({ id: String(m.id), dependsOn: m.dependsOn as string[] }));
      graph.push({ id: String(v.id), dependsOn: v.dependsOn as string[] });
      return findCycle(graph) ? 'These dependencies would create a cycle.' : null;
    },
  },
  deliverable: {
    validate: async (v, current) => {
      const locked = await projectLocked(v.projectId); if (locked) return locked;
      if (current?.status === 'Ready for review' && !sameValues(v, current, ['title', 'description', 'draftSummary'])) return 'This deliverable is in review. Request changes before editing the draft.';
      return null;
    },
    // Revising accepted content starts a new draft that needs review; the accepted version is kept.
    adjust: (v, current, changed) => current.status === 'Accepted' && changed.some(k => ['title', 'description', 'draftSummary'].includes(k))
      ? { value: { ...v, status: 'Draft' }, events: [{ type: 'deliverable.revised', summary: 'Accepted deliverable revised — a new version will need review (accepted version preserved)' }] }
      : { value: v },
  },
  projectLog: {
    validate: async v => (await projectLocked(v.projectId)) ?? (['Resolved', 'Closed'].includes(String(v.status)) && !String(v.resolution).trim() ? 'Record the resolution or decision rationale before closing this entry.' : null),
  },
  changeRequest: {
    validate: async (v, current) => (current && current.status !== 'Proposed' ? 'A decided change request is kept exactly as recorded.' : await projectLocked(v.projectId)),
  },
  experience: {
    // Any edit after approval withdraws the approval until the owner reviews it again.
    adjust: (v, current, changed) => current.publicationStatus === 'Approved for capability statement' && changed.length
      ? { value: { ...v, publicationStatus: 'Private' }, events: [{ type: 'experience.approval_withdrawn', summary: 'Edited after approval — returned to private until reviewed again' }] }
      : { value: v },
  },
  teamingPartner: {
    validate: async v => (v.discussionStatus === 'Agreement signed' && !String(v.agreementReference).trim() ? 'Record the agreement reference before marking an agreement signed.'
      : v.nextActionDue && !String(v.nextAction).trim() ? 'Describe the next action before setting a due date.' : null),
  },
};
async function projectLocked(projectId: unknown): Promise<string | null> {
  const project = await getRecord('project', String(projectId));
  return project && ['Closed', 'Cancelled'].includes(String(project.status)) ? `This project is ${String(project.status).toLowerCase()}; reopen it before changing its plan.` : null;
}
const sameValues = (a: Values, b: Values, keys: string[]) => keys.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
const uniqueViolation = (error: unknown) => /UNIQUE constraint failed/i.test(String(error));

export async function findDuplicates(type: string, v: Values, excludeId = '') {
  if (type === 'organization') {
    if (!v.nameKey && !v.domain) return [];
    return (await db().prepare("SELECT id, name, org_type, website FROM organizations WHERE status = 'Active' AND id <> ? AND ((name_key <> '' AND name_key = ?) OR (domain <> '' AND domain = ?))")
      .bind(excludeId, v.nameKey, v.domain).all<Row>()).results.map(r => ({ id: r.id, name: r.name, orgType: r.org_type, website: r.website }));
  }
  if (type === 'contact' && v.emailKey) {
    return (await db().prepare("SELECT id, name, email, organization_id FROM contacts WHERE status = 'Active' AND id <> ? AND email_key = ?")
      .bind(excludeId, v.emailKey).all<Row>()).results.map(r => ({ id: r.id, name: r.name, email: r.email, organizationId: r.organization_id }));
  }
  return [];
}

/** References must exist, be active (not merged) and share the declared parent. */
async function checkRefs(spec: TypeSpec, v: Values, changed: string[] | 'all'): Promise<string | null> {
  for (const field of spec.fields) {
    if (field.derived || field.readOnly || !field.ref || (changed !== 'all' && !changed.includes(field.key))) continue;
    const ids = field.kind === 'refs' ? (v[field.key] as string[]) : v[field.key] ? [v[field.key] as string] : [];
    for (const id of ids) {
      const table = tableFor(field.ref);
      if (!table) return `${field.label} cannot be linked.`;
      const target = SPECS[field.ref] ? await getRecord(field.ref, id) : (await recordExists(field.ref, id)) ? { id } : null;
      if (!target) return `${field.label} refers to a record that does not exist.`;
      if (target.status === 'Merged') return `${field.label} refers to a merged record; link the record it was merged into.`;
      if (field.sameParent && target[field.sameParent] !== v[field.sameParent]) return `${field.label} must belong to the same ${field.sameParent.replace(/Id$/, '')}.`;
      if (field.ref === spec.type && id === v.id) return `${field.label} cannot refer to itself.`;
    }
  }
  return null;
}

// ── Generic create / update ─────────────────────────────────────────────────

const columnsOf = (spec: TypeSpec) => spec.fields.map(field => field.column);
/** Insert; with `guard` (an EXISTS subquery) the row is written only if the guard matches. */
export function insertStatement(spec: TypeSpec, id: string, v: Values, at: string, requestId: string, guard?: { sql: string; args: unknown[] }) {
  const cols = columnsOf(spec);
  const values = [id, ...spec.fields.map(field => toColumn(field.kind, v[field.key])), at, at, requestId];
  const head = `INSERT INTO ${spec.table} (id, ${cols.join(', ')}, version, created_at, updated_at, last_request_id)`;
  return guard
    ? db().prepare(`${head} SELECT ?, ${cols.map(() => '?').join(', ')}, 1, ?, ?, ? WHERE EXISTS (${guard.sql})`).bind(...values, ...guard.args)
    : db().prepare(`${head} VALUES (?, ${cols.map(() => '?').join(', ')}, 1, ?, ?, ?)`).bind(...values);
}
/** Version-guarded update of the given keys (all spec fields when omitted). */
export function updateStatement(spec: TypeSpec, id: string, version: number, v: Values, at: string, requestId: string, keys?: string[]) {
  const fields = spec.fields.filter(field => !keys || keys.includes(field.key));
  return db().prepare(`UPDATE ${spec.table} SET ${fields.map(field => `${field.column} = ?`).join(', ')}${fields.length ? ', ' : ''}version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ?`)
    .bind(...fields.map(field => toColumn(field.kind, v[field.key])), at, requestId, id, version);
}
export const guardFor = (table: string) => `SELECT 1 FROM ${table} WHERE id = ? AND last_request_id = ?`;
export const activity = (actor: string, at: string, subjectType: string, subjectId: string, event: ActivityDraft, table: string, requestId: string) =>
  activityStatement(actor, at, subjectType, subjectId, event, guardFor(table), [subjectId, requestId]);
const titleOf = (spec: TypeSpec, v: Values) => (spec.privateTitle ? '' : `: ${String(v[spec.titleKey] ?? '').slice(0, 120)}`);
export const conflict = (current: unknown) => ({ status: 409, body: { error: 'This record changed since you opened it. Review the latest version and try again.', current } });

export async function createRecord(type: string, input: unknown, actor: string, opts: { confirmDistinct?: boolean; extra?: Values } = {}): Promise<StoreResult<{ record: Values }>> {
  const spec = SPECS[type];
  if (!spec) return { status: 404, body: { error: 'Unknown record type.' } };
  if (spec.createViaAction || spec.actionOnly) return { status: 400, body: { error: `${spec.plural} are created through their workflow action.` } };
  const parsed = validateRecord(spec, input, { ...defaults(spec), ...(opts.extra ?? {}) }, 'create');
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const id = crypto.randomUUID();
  const value = { ...(HOOKS[type]?.derive?.(parsed.value) ?? parsed.value), id };
  const refError = await checkRefs(spec, value, 'all');
  if (refError) return { status: 400, body: { error: refError } };
  const ruleError = await HOOKS[type]?.validate?.(value, null);
  if (ruleError) return { status: 400, body: { error: ruleError } };
  if (!opts.confirmDistinct) {
    const duplicates = await findDuplicates(type, value);
    if (duplicates.length) return { status: 409, body: { error: `A matching ${spec.label.toLowerCase()} already exists. Link the existing record or confirm this one is distinct.`, duplicates } as never };
  }
  const at = nowIso(), requestId = crypto.randomUUID();
  try {
    await db().batch([
      insertStatement(spec, id, value, at, requestId),
      activity(actor, at, type, id, { type: `${type}.created`, summary: `${spec.label} created${titleOf(spec, value)}` }, spec.table, requestId),
    ]);
  } catch (error) {
    if (uniqueViolation(error)) return { status: 409, body: { error: `This ${spec.label.toLowerCase()} already exists.` } };
    throw error;
  }
  return { status: 201, body: { record: (await getRecord(type, id))! } };
}

export async function updateRecord(type: string, id: string, version: unknown, changes: unknown, actor: string, opts: { confirmDistinct?: boolean } = {}): Promise<StoreResult<{ record: Values }>> {
  const spec = SPECS[type];
  if (!spec) return { status: 404, body: { error: 'Unknown record type.' } };
  if (spec.actionOnly) return { status: 400, body: { error: `${spec.plural} change only through their workflow actions.` } };
  const current = await getRecord(type, id);
  if (!current) return { status: 404, body: { error: `${spec.label} not found.` } };
  if (!Number.isInteger(version)) return { status: 400, body: { error: 'A record version is required.' } };
  if (current.version !== version) return conflict(current);
  if (current.status === 'Merged') return { status: 409, body: { error: `This ${spec.label.toLowerCase()} was merged and is kept read-only for reference.` } };
  const parsed = validateRecord(spec, changes, current, 'update');
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  if (!parsed.changed.length) return { status: 200, body: { record: current } };
  const derived = HOOKS[type]?.derive?.(parsed.value) ?? parsed.value;
  const adjusted = HOOKS[type]?.adjust?.(derived, current, parsed.changed) ?? { value: derived };
  const value = adjusted.value;
  const refError = await checkRefs(spec, value, parsed.changed);
  if (refError) return { status: 400, body: { error: refError } };
  const ruleError = await HOOKS[type]?.validate?.(value, current);
  if (ruleError) return { status: 400, body: { error: ruleError } };
  if (!opts.confirmDistinct && (value.nameKey !== current.nameKey || value.domain !== current.domain || value.emailKey !== current.emailKey)) {
    const duplicates = await findDuplicates(type, value, id);
    if (duplicates.length) return { status: 409, body: { error: `This change matches an existing ${spec.label.toLowerCase()}. Confirm it is distinct or merge the records.`, duplicates } as never };
  }
  const at = nowIso(), requestId = crypto.randomUUID();
  let results;
  try {
    results = await db().batch([
      updateStatement(spec, id, current.version as number, value, at, requestId),
      activity(actor, at, type, id, { type: `${type}.updated`, summary: `${spec.label} updated: ${parsed.changed.join(', ')}`, details: { fields: parsed.changed } }, spec.table, requestId),
      ...(adjusted.events ?? []).map(e => activity(actor, at, type, id, e, spec.table, requestId)),
    ]);
  } catch (error) {
    if (uniqueViolation(error)) return { status: 409, body: { error: `A matching ${spec.label.toLowerCase()} already exists.` } };
    throw error;
  }
  if (!results[0].meta.changes) return conflict(await getRecord(type, id));
  return { status: 200, body: { record: (await getRecord(type, id))! } };
}
