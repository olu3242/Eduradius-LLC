// Explicit, transactional workflow actions dispatched by POST /api/actions/:name.
// Generic edits (records-store) never change workflow-controlled fields; these do.
import { SPECS, EVIDENCE_SUBJECTS, organizationKey, emailKey, websiteDomain, type Values } from '../records';
import { activityStatement, type StoreResult } from './workflow-store';
import { db, nowIso, getRecord, recordExists, tableFor, activity, conflict, insertStatement } from './records-store';

type Body = Record<string, unknown>;
export type Action = (body: Body, actor: string) => Promise<StoreResult<unknown>>;
const bad = (error: string, status = 400) => ({ status, body: { error } });
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isVersion = (v: unknown): v is number => Number.isInteger(v);
type Row = Record<string, unknown>;

/** Columns that reference organizations/contacts; merges move every reference. Extended per increment. */
export const ORGANIZATION_REFS: [string, string][] = [['contacts', 'organization_id'], ['inquiries', 'organization_id'], ['opportunities', 'organization_id']];
export const CONTACT_REFS: [string, string][] = [['inquiries', 'contact_id'], ['opportunities', 'contact_id']];

// ── Evidence links ──────────────────────────────────────────────────────────

async function linkEvidence(body: Body, actor: string, unlink = false): Promise<StoreResult<unknown>> {
  const evidenceId = str(body.evidenceId), subjectType = str(body.subjectType), subjectId = str(body.subjectId);
  if (!(EVIDENCE_SUBJECTS as readonly string[]).includes(subjectType) || !tableFor(subjectType)) return bad('Evidence cannot be linked to that kind of record.');
  if (!(await recordExists('evidence', evidenceId))) return bad('Evidence record not found.', 404);
  if (!(await recordExists(subjectType, subjectId))) return bad('The record to link was not found.', 404);
  const at = nowIso(), evidence = await getRecord('evidence', evidenceId);
  const event = { type: unlink ? 'evidence.unlinked' : 'evidence.linked', summary: `${unlink ? 'Evidence unlinked' : 'Evidence linked'}: ${String(evidence?.title).slice(0, 120)}`, details: { evidenceId } };
  const statement = unlink
    ? db().prepare('DELETE FROM evidence_links WHERE evidence_id = ? AND subject_type = ? AND subject_id = ?').bind(evidenceId, subjectType, subjectId)
    : db().prepare('INSERT OR IGNORE INTO evidence_links (id, evidence_id, subject_type, subject_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), evidenceId, subjectType, subjectId, at);
  const [result] = await db().batch([statement]);
  if (result.meta.changes) await db().batch([activityStatement(actor, at, subjectType, subjectId, event, 'SELECT 1', [])]);
  return { status: 200, body: { changed: Boolean(result.meta.changes) } };
}

// ── Organization / contact consolidation (explicit, conflict-reporting) ─────

async function merge(type: 'organization' | 'contact', body: Body, actor: string): Promise<StoreResult<unknown>> {
  const spec = SPECS[type];
  const sourceId = str(body.sourceId), targetId = str(body.targetId);
  if (!sourceId || !targetId || sourceId === targetId) return bad('Choose two different records to merge.');
  const [source, target] = await Promise.all([getRecord(type, sourceId), getRecord(type, targetId)]);
  if (!source || !target) return bad(`${spec.label} not found.`, 404);
  if (source.status !== 'Active' || target.status !== 'Active') return bad('Only active records can be merged.', 409);
  if (!isVersion(body.sourceVersion) || source.version !== body.sourceVersion) return conflict(source);
  // The target keeps its values. Differing source values are reported, never copied over.
  const compare = type === 'organization' ? ['name', 'orgType', 'website', 'relationshipOwner', 'source'] : ['name', 'role', 'email', 'phone', 'relationshipOwner', 'organizationId'];
  const conflicts = compare.filter(k => source[k] && target[k] && source[k] !== target[k]);
  const at = nowIso(), requestId = crypto.randomUUID();
  const refs = type === 'organization' ? ORGANIZATION_REFS : CONTACT_REFS;
  const results = await db().batch([
    db().prepare(`UPDATE ${spec.table} SET status = 'Merged', merged_into_id = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status = 'Active'`)
      .bind(targetId, at, requestId, sourceId, source.version),
    ...refs.map(([table, column]) => db().prepare(`UPDATE ${table} SET ${column} = ?, version = version + 1, updated_at = ? WHERE ${column} = ? AND EXISTS (SELECT 1 FROM ${spec.table} WHERE id = ? AND last_request_id = ?)`)
      .bind(targetId, at, sourceId, sourceId, requestId)),
    activity(actor, at, type, sourceId, { type: `${type}.merged`, summary: `${spec.label} merged into another record`, details: { targetId, conflicts } }, spec.table, requestId),
    activityStatement(actor, at, type, targetId, { type: `${type}.merge_received`, summary: `${spec.label} received merged references`, details: { sourceId, conflicts } }, `SELECT 1 FROM ${spec.table} WHERE id = ? AND last_request_id = ?`, [sourceId, requestId]),
  ]);
  if (!results[0].meta.changes) return conflict(await getRecord(type, sourceId));
  return { status: 200, body: { target: await getRecord(type, targetId), source: await getRecord(type, sourceId), conflicts } };
}

/**
 * Links existing requests and opportunities to organization/contact records by exact
 * normalized name or email; creates records only when no exact match exists.
 * Processes a bounded batch per call and is safe to rerun (only unlinked rows).
 */
async function linkExisting(_body: Body, actor: string): Promise<StoreResult<unknown>> {
  const LIMIT = 12;
  const orgRows = (await db().prepare("SELECT id, name_key FROM organizations WHERE status = 'Active' AND name_key <> ''").all<Row>()).results;
  const contactRows = (await db().prepare("SELECT id, email_key FROM contacts WHERE status = 'Active' AND email_key <> ''").all<Row>()).results;
  const orgs = new Map(orgRows.map(r => [String(r.name_key), String(r.id)]));
  const people = new Map(contactRows.map(r => [String(r.email_key), String(r.id)]));
  const pending = [
    ...(await db().prepare("SELECT 'inquiries' AS tbl, id, version, organization AS org, name AS person, email, organization_id, contact_id FROM inquiries WHERE (organization_id IS NULL AND organization <> '') OR (contact_id IS NULL AND email <> '')").all<Row>()).results,
    ...(await db().prepare("SELECT 'opportunities' AS tbl, id, version, agency AS org, contact_name AS person, contact_email AS email, organization_id, contact_id FROM opportunities WHERE (organization_id IS NULL AND agency <> '') OR (contact_id IS NULL AND contact_email <> '')").all<Row>()).results,
  ].filter(r => (r.organization_id === null && organizationKey(str(r.org))) || (r.contact_id === null && emailKey(str(r.email))));
  const batch = pending.slice(0, LIMIT), at = nowIso(), statements = [];
  let createdOrganizations = 0, createdContacts = 0;
  for (const r of batch) {
    let orgId = (r.organization_id as string | null) ?? null;
    const key = organizationKey(str(r.org));
    if (!orgId && key) {
      orgId = orgs.get(key) ?? null;
      if (!orgId) {
        orgId = crypto.randomUUID(); orgs.set(key, orgId); createdOrganizations++;
        statements.push(insertStatement(SPECS.organization, orgId, { name: str(r.org), orgType: r.tbl === 'inquiries' ? 'Prospective client' : 'Government buyer', website: '', relationshipOwner: '', source: r.tbl === 'inquiries' ? 'Linked from a client request' : 'Linked from an opportunity', notes: '', status: 'Active', mergedIntoId: null, nameKey: key, domain: websiteDomain('') }, at, 'link-existing'));
      }
    }
    let contactId = (r.contact_id as string | null) ?? null;
    const ekey = emailKey(str(r.email));
    if (!contactId && ekey) {
      contactId = people.get(ekey) ?? null;
      if (!contactId) {
        contactId = crypto.randomUUID(); people.set(ekey, contactId); createdContacts++;
        statements.push(insertStatement(SPECS.contact, contactId, { organizationId: orgId, name: str(r.person) || str(r.email), role: '', email: str(r.email), phone: '', relationshipOwner: '', source: 'Linked from existing records', notes: '', status: 'Active', mergedIntoId: null, emailKey: ekey }, at, 'link-existing'));
      }
    }
    statements.push(db().prepare(`UPDATE ${r.tbl} SET organization_id = COALESCE(organization_id, ?), contact_id = COALESCE(contact_id, ?), version = version + 1, updated_at = ? WHERE id = ? AND version = ?`).bind(orgId, contactId, at, r.id, r.version));
  }
  if (statements.length) {
    statements.push(activityStatement(actor, at, 'workspace', null, { type: 'organization.linked_existing', summary: `Linked ${batch.length} existing records to organizations and contacts`, details: { createdOrganizations, createdContacts } }, 'SELECT 1', []));
    await db().batch(statements);
  }
  return { status: 200, body: { processed: batch.length, createdOrganizations, createdContacts, remaining: Math.max(0, pending.length - batch.length) } };
}

/** Links (or unlinks) an inquiry or opportunity to an organization and contact. */
async function linkParty(table: 'inquiries' | 'opportunities', subjectType: string, body: Body, actor: string): Promise<StoreResult<unknown>> {
  const id = str(body.id);
  const row = await db().prepare(`SELECT id, version FROM ${table} WHERE id = ?`).bind(id).first<Row>();
  if (!row) return bad('Record not found.', 404);
  if (!isVersion(body.version) || Number(row.version) !== body.version) return conflict(null);
  const organizationId = body.organizationId ? str(body.organizationId) : null, contactId = body.contactId ? str(body.contactId) : null;
  const org = organizationId ? await getRecord('organization', organizationId) : null;
  const contact = contactId ? await getRecord('contact', contactId) : null;
  if (organizationId && (!org || org.status !== 'Active')) return bad('Choose an active organization.');
  if (contactId && (!contact || contact.status !== 'Active')) return bad('Choose an active contact.');
  if (contact && organizationId && contact.organizationId && contact.organizationId !== organizationId) return bad('That contact belongs to a different organization.');
  const at = nowIso(), requestId = crypto.randomUUID();
  const results = await db().batch([
    db().prepare(`UPDATE ${table} SET organization_id = ?, contact_id = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ?`).bind(organizationId, contactId, at, requestId, id, row.version),
    activity(actor, at, subjectType, id, { type: `${subjectType}.party_linked`, summary: org ? `Linked to organization ${String(org.name).slice(0, 120)}` : 'Organization link cleared', details: { organizationId, contactId } }, table, requestId),
  ]);
  return results[0].meta.changes ? { status: 200, body: { organizationId, contactId } } : conflict(null);
}

export const ACTIONS: Record<string, Action> = {
  'evidence.link': (b, a) => linkEvidence(b, a),
  'evidence.unlink': (b, a) => linkEvidence(b, a, true),
  'organization.merge': (b, a) => merge('organization', b, a),
  'contact.merge': (b, a) => merge('contact', b, a),
  'organization.linkExisting': linkExisting,
  'inquiry.link': (b, a) => linkParty('inquiries', 'inquiry', b, a),
  'opportunity.link': (b, a) => linkParty('opportunities', 'opportunity', b, a),
};
export type { Values };
