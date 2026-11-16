// Explicit, transactional workflow actions dispatched by POST /api/actions/:name.
// Generic edits (records-store) never change workflow-controlled fields; these do.
import { SPECS, EVIDENCE_SUBJECTS, PROJECT_TRANSITIONS, ACCEPTANCE_KINDS, closeoutChecklist, reasonRequired, SECTION_BASIS, SUBMISSION_METHODS, SUBMISSION_OUTCOMES, emptySections, evidenceState, organizationKey, emailKey, websiteDomain, validateSections, type Sections, type Values } from '../records';
import { businessDate, isIsoDate } from '../workflow';
import { activityStatement, type StoreResult } from './workflow-store';
import { db, nowIso, getRecord, getRecords, listByField, recordExists, tableFor, activity, conflict, insertStatement } from './records-store';
import { resolveImportConflict } from './import-conflicts';

type Body = Record<string, unknown>;
export type Action = (body: Body, actor: string) => Promise<StoreResult<unknown>>;
const bad = (error: string, status = 400) => ({ status, body: { error } });
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isVersion = (v: unknown): v is number => Number.isInteger(v);
type Row = Record<string, unknown>;

/** Columns that reference organizations/contacts; merges move every reference. Extended per increment. */
export const ORGANIZATION_REFS: [string, string][] = [['contacts', 'organization_id'], ['inquiries', 'organization_id'], ['opportunities', 'organization_id'], ['teaming_partners', 'organization_id'], ['projects', 'client_organization_id']];
export const CONTACT_REFS: [string, string][] = [['inquiries', 'contact_id'], ['opportunities', 'contact_id'], ['teaming_partners', 'contact_id']];

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
  let results;
  try { results = await db().batch([
    db().prepare(`UPDATE ${spec.table} SET status = 'Merged', merged_into_id = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status = 'Active'`)
      .bind(targetId, at, requestId, sourceId, source.version),
    ...refs.map(([table, column]) => db().prepare(`UPDATE ${table} SET ${column} = ?, version = version + 1, updated_at = ? WHERE ${column} = ? AND EXISTS (SELECT 1 FROM ${spec.table} WHERE id = ? AND last_request_id = ?)`)
      .bind(targetId, at, sourceId, sourceId, requestId)),
    activity(actor, at, type, sourceId, { type: `${type}.merged`, summary: `${spec.label} merged into another record`, details: { targetId, conflicts } }, spec.table, requestId),
    activityStatement(actor, at, type, targetId, { type: `${type}.merge_received`, summary: `${spec.label} received merged references`, details: { sourceId, conflicts } }, `SELECT 1 FROM ${spec.table} WHERE id = ? AND last_request_id = ?`, [sourceId, requestId]),
  ]); } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error))) return bad('Both records are partners on the same opportunity. Remove one teaming record before merging.', 409);
    throw error;
  }
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

// ── Proposals: owner review, versions, submission records ──────────────────

const proposalGuard = 'SELECT 1 FROM proposals WHERE id = ? AND last_request_id = ?';
const reviewerLabel = (actor: string) => `${actor} (owner review)`;
async function loadProposal(body: Body) {
  const proposal = await getRecord('proposal', str(body.id));
  if (!proposal) return { error: bad('Proposal not found.', 404) };
  if (!isVersion(body.version) || proposal.version !== body.version) return { error: conflict(proposal) };
  return { proposal };
}

async function createProposal(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const opportunityId = str(body.opportunityId), title = str(body.title).trim();
  if (!(await recordExists('opportunity', opportunityId))) return bad('Opportunity not found.', 404);
  if (!title || title.length > 200) return bad('Proposal title is required (200 characters or fewer).');
  const sections: Sections = emptySections();
  let templateId: string | null = null;
  if (body.templateId) {
    const template = await getRecord('proposalTemplate', str(body.templateId));
    if (!template) return bad('Template not found.', 404);
    templateId = String(template.id);
    // Copies template text into a NEW proposal; existing proposals are never overwritten.
    for (const [key, section] of Object.entries((template.sections ?? {}) as Sections)) if (key in sections) sections[key] = { body: String(section.body ?? ''), basis: SECTION_BASIS[0], refs: [] };
  }
  const id = crypto.randomUUID(), at = nowIso(), requestId = crypto.randomUUID();
  await db().batch([
    insertStatement(SPECS.proposal, id, { opportunityId, title, owner: str(body.owner).slice(0, 120), sections, status: 'Draft', templateId, latestVersionId: null, approvedVersionId: null }, at, requestId),
    activity(actor, at, 'proposal', id, { type: 'proposal.created', summary: `Proposal created${templateId ? ' from a template' : ''}: ${title.slice(0, 120)}` }, 'proposals', requestId),
  ]);
  return { status: 201, body: { record: await getRecord('proposal', id) } };
}

async function submitForReview(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const { proposal, error } = await loadProposal(body); if (error) return error;
  if (!['Draft', 'Changes requested'].includes(String(proposal!.status))) return bad(`A proposal in ${proposal!.status} cannot be sent for owner review.`, 409);
  const sections = proposal!.sections as Sections;
  const invalid = validateSections(sections); if (invalid) return bad(invalid);
  if (!sections.executiveSummary?.body.trim()) return bad('Write the executive summary before sending the proposal for owner review.');
  const max = await db().prepare('SELECT COALESCE(MAX(number), 0) AS n FROM proposal_versions WHERE proposal_id = ?').bind(proposal!.id).first<{ n: number }>();
  const number = Number(max?.n ?? 0) + 1, versionId = crypto.randomUUID(), at = nowIso(), requestId = crypto.randomUUID();
  const results = await db().batch([
    db().prepare("UPDATE proposals SET status = 'Internal review', latest_version_id = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status IN ('Draft', 'Changes requested')").bind(versionId, at, requestId, proposal!.id, proposal!.version),
    insertStatement(SPECS.proposalVersion, versionId, { proposalId: proposal!.id, number, title: proposal!.title, sections, status: 'Internal review', submittedBy: actor, submittedAt: at, reviewReason: '', reviewedBy: '', reviewedAt: '' }, at, requestId, { sql: proposalGuard, args: [proposal!.id, requestId] }),
    activity(actor, at, 'proposal', String(proposal!.id), { type: 'proposal.review_requested', summary: `Version ${number} sent for owner review`, details: { versionId, number } }, 'proposals', requestId),
  ]);
  return results[0].meta.changes ? { status: 200, body: { record: await getRecord('proposal', String(proposal!.id)), versionId } } : conflict(await getRecord('proposal', String(proposal!.id)));
}

async function reviewProposal(body: Body, actor: string, decision: 'approve' | 'changes'): Promise<StoreResult<unknown>> {
  const { proposal, error } = await loadProposal(body); if (error) return error;
  if (proposal!.status !== 'Internal review' || !proposal!.latestVersionId) return bad('Only a proposal in owner review can be approved or returned for changes.', 409);
  const reason = str(body.reason).trim();
  if (decision === 'changes' && !reason) return bad('Record what needs to change.');
  if (reason.length > 4000) return bad('Review notes must be 4,000 characters or fewer.');
  const versionId = String(proposal!.latestVersionId);
  if (decision === 'approve') {
    const version = await getRecord('proposalVersion', versionId);
    const today = businessDate(), problems: string[] = [];
    for (const [key, section] of Object.entries((version?.sections ?? {}) as Sections)) {
      if (section.basis !== SECTION_BASIS[2]) continue;
      for (const ref of section.refs) { const e = await getRecord('evidence', ref); if (!e || evidenceState(e, today) !== 'current') problems.push(key); }
    }
    if (problems.length) return bad(`Verified sections must cite verified, unexpired evidence: ${[...new Set(problems)].join(', ')}.`);
  }
  const at = nowIso(), requestId = crypto.randomUUID();
  const statements = decision === 'approve' ? [
    db().prepare("UPDATE proposals SET status = 'Approved', approved_version_id = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status = 'Internal review'").bind(versionId, at, requestId, proposal!.id, proposal!.version),
    db().prepare(`UPDATE proposal_versions SET status = 'Superseded', version = version + 1, updated_at = ? WHERE proposal_id = ? AND status = 'Approved' AND id <> ? AND EXISTS (${proposalGuard})`).bind(at, proposal!.id, versionId, proposal!.id, requestId),
    db().prepare(`UPDATE proposal_versions SET status = 'Approved', review_reason = ?, reviewed_by = ?, reviewed_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND EXISTS (${proposalGuard})`).bind(reason, reviewerLabel(actor), at, at, versionId, proposal!.id, requestId),
    activity(actor, at, 'proposal', String(proposal!.id), { type: 'proposal.approved', summary: 'Proposal approved by the workspace owner (owner review)', details: { versionId } }, 'proposals', requestId),
  ] : [
    db().prepare("UPDATE proposals SET status = 'Changes requested', version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status = 'Internal review'").bind(at, requestId, proposal!.id, proposal!.version),
    db().prepare(`UPDATE proposal_versions SET status = 'Changes requested', review_reason = ?, reviewed_by = ?, reviewed_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND EXISTS (${proposalGuard})`).bind(reason, reviewerLabel(actor), at, at, versionId, proposal!.id, requestId),
    activity(actor, at, 'proposal', String(proposal!.id), { type: 'proposal.changes_requested', summary: 'Owner review requested changes', details: { versionId, reason: reason.slice(0, 200) } }, 'proposals', requestId),
  ];
  const results = await db().batch(statements);
  return results[0].meta.changes ? { status: 200, body: { record: await getRecord('proposal', String(proposal!.id)) } } : conflict(await getRecord('proposal', String(proposal!.id)));
}

/** Records (does not perform) a submission of the exact approved version. */
async function recordSubmission(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const { proposal, error } = await loadProposal(body); if (error) return error;
  if (proposal!.status !== 'Approved' || !proposal!.approvedVersionId || proposal!.approvedVersionId !== proposal!.latestVersionId) return bad('Only the current owner-approved version can be recorded as submitted.', 409);
  if (!isIsoDate(body.submittedOn)) return bad('Submission date is required.');
  if (!(SUBMISSION_METHODS as readonly unknown[]).includes(body.method)) return bad('Choose how the proposal was submitted.');
  const reference = str(body.reference).trim(), notes = str(body.notes).trim();
  if (reference.length > 200 || notes.length > 4000) return bad('Reference or notes are too long.');
  const id = crypto.randomUUID(), at = nowIso(), requestId = crypto.randomUUID(), versionId = String(proposal!.approvedVersionId);
  try {
    const results = await db().batch([
      db().prepare("UPDATE proposals SET status = 'Submitted', version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status = 'Approved' AND approved_version_id = ?").bind(at, requestId, proposal!.id, proposal!.version, versionId),
      insertStatement(SPECS.submission, id, { proposalId: proposal!.id, proposalVersionId: versionId, opportunityId: proposal!.opportunityId, submittedOn: body.submittedOn, method: body.method, reference, notes, outcome: 'Pending', outcomeDate: null, outcomeNotes: '', awardEvidenceId: null }, at, requestId, { sql: proposalGuard, args: [proposal!.id, requestId] }),
      db().prepare(`UPDATE proposal_versions SET status = 'Submitted', version = version + 1, updated_at = ? WHERE id = ? AND EXISTS (${proposalGuard})`).bind(at, versionId, proposal!.id, requestId),
      activity(actor, at, 'proposal', String(proposal!.id), { type: 'proposal.submission_recorded', summary: `Submission recorded (${String(body.method)}) — nothing was sent from this workspace`, details: { submissionId: id, versionId } }, 'proposals', requestId),
    ]);
    if (!results[0].meta.changes) return conflict(await getRecord('proposal', String(proposal!.id)));
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String(e))) return bad('A submission is already recorded for this approved version.', 409);
    throw e;
  }
  return { status: 201, body: { record: await getRecord('submission', id) } };
}

/** Manual outcome. "Awarded" needs explicit confirmation, a date and award evidence. */
async function recordOutcome(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const submission = await getRecord('submission', str(body.id));
  if (!submission) return bad('Submission record not found.', 404);
  if (!isVersion(body.version) || submission.version !== body.version) return conflict(submission);
  const outcome = str(body.outcome);
  if (!(SUBMISSION_OUTCOMES as readonly string[]).includes(outcome)) return bad('Choose an outcome.');
  const locked = await db().prepare('SELECT 1 AS found FROM projects WHERE submission_id = ?').bind(submission.id).first().catch(() => null);
  if (locked) return bad('A project was created from this award; the outcome is kept as recorded.', 409);
  const outcomeDate = body.outcomeDate ? str(body.outcomeDate) : null, outcomeNotes = str(body.outcomeNotes).trim();
  if (outcomeDate && !isIsoDate(outcomeDate)) return bad('Outcome date must be a valid date.');
  if (outcomeNotes.length > 4000) return bad('Outcome notes are too long.');
  let awardEvidenceId: string | null = null;
  if (outcome === 'Awarded') {
    if (body.confirmAward !== true) return bad('Confirm that the award was received in writing before recording it.');
    if (!outcomeDate) return bad('Record the award date.');
    const evidence = body.awardEvidenceId ? await getRecord('evidence', str(body.awardEvidenceId)) : null;
    if (!evidence || ['Rejected', 'Superseded'].includes(String(evidence.reviewStatus))) return bad('Link the award notice or contract as evidence.');
    awardEvidenceId = String(evidence.id);
  }
  const at = nowIso(), requestId = crypto.randomUUID();
  const results = await db().batch([
    db().prepare('UPDATE submissions SET outcome = ?, outcome_date = ?, outcome_notes = ?, award_evidence_id = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ?').bind(outcome, outcomeDate, outcomeNotes, awardEvidenceId, at, requestId, submission.id, submission.version),
    ...(awardEvidenceId ? [db().prepare(`INSERT OR IGNORE INTO evidence_links (id, evidence_id, subject_type, subject_id, created_at) SELECT ?, ?, 'opportunity', ?, ? WHERE EXISTS (SELECT 1 FROM submissions WHERE id = ? AND last_request_id = ?)`).bind(crypto.randomUUID(), awardEvidenceId, submission.opportunityId, at, submission.id, requestId)] : []),
    activity(actor, at, 'submission', String(submission.id), { type: 'submission.outcome_recorded', summary: `Outcome recorded: ${outcome}`, details: { outcome, awardEvidenceId } }, 'submissions', requestId),
  ]);
  return results[0].meta.changes ? { status: 200, body: { record: await getRecord('submission', String(submission.id)) } } : conflict(await getRecord('submission', String(submission.id)));
}

async function saveTemplate(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const proposal = await getRecord('proposal', str(body.id));
  if (!proposal) return bad('Proposal not found.', 404);
  const name = str(body.name).trim();
  if (!name || name.length > 160) return bad('Template name is required (160 characters or fewer).');
  const sections = Object.fromEntries(Object.entries(proposal.sections as Sections).map(([k, v]) => [k, { body: v.body, basis: SECTION_BASIS[0], refs: [] }]));
  const id = crypto.randomUUID(), at = nowIso(), requestId = crypto.randomUUID();
  await db().batch([
    insertStatement(SPECS.proposalTemplate, id, { name, description: str(body.description).slice(0, 2000), sections }, at, requestId),
    activity(actor, at, 'proposalTemplate', id, { type: 'proposalTemplate.created', summary: `Template saved: ${name.slice(0, 120)}` }, 'proposal_templates', requestId),
  ]);
  return { status: 201, body: { record: await getRecord('proposalTemplate', id) } };
}

// ── Award → project and project status ─────────────────────────────────────

/**
 * Creates exactly one project for an opportunity from a confirmed award. Requires a
 * submission with outcome "Awarded" and award evidence, plus explicit confirmation of the
 * reviewed client, scope, owner, dates and initial deliverables. Retries return the
 * existing project (unique opportunity index).
 */
async function createProjectFromAward(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const submission = await getRecord('submission', str(body.submissionId));
  if (!submission) return bad('Submission record not found.', 404);
  const existing = await db().prepare('SELECT id FROM projects WHERE opportunity_id = ?').bind(submission.opportunityId).first<Row>();
  if (existing) return { status: 200, body: { record: await getRecord('project', String(existing.id)), alreadyCreated: true } };
  if (submission.outcome !== 'Awarded' || !submission.awardEvidenceId) return bad('A project can only be created after the award is recorded with award evidence. Approval or submission is not an award.', 409);
  if (body.confirm !== true) return bad('Confirm the reviewed project details before creating the project.');
  const title = str(body.title).trim(), scope = str(body.scope).trim(), owner = str(body.owner).trim();
  if (!title || title.length > 200) return bad('Project title is required (200 characters or fewer).');
  if (!scope || scope.length > 8000) return bad('Describe the awarded scope (8,000 characters or fewer).');
  const startDate = body.startDate ? str(body.startDate) : null, plannedEndDate = body.plannedEndDate ? str(body.plannedEndDate) : null;
  if ((startDate && !isIsoDate(startDate)) || (plannedEndDate && !isIsoDate(plannedEndDate))) return bad('Dates must be valid.');
  if (startDate && plannedEndDate && plannedEndDate < startDate) return bad('Planned completion cannot be before the start date.');
  const clientOrganizationId = body.clientOrganizationId ? str(body.clientOrganizationId) : null;
  if (clientOrganizationId) { const org = await getRecord('organization', clientOrganizationId); if (!org || org.status !== 'Active') return bad('Choose an active client organization.'); }
  const deliverables = Array.isArray(body.deliverables) ? body.deliverables as Body[] : [];
  if (deliverables.length > 30) return bad('Add up to 30 initial deliverables; more can be added later.');
  for (const d of deliverables) if (!str(d.title).trim() || str(d.title).length > 200 || (d.dueDate && !isIsoDate(d.dueDate))) return bad('Each deliverable needs a title and a valid due date (if set).');
  const proposal = await getRecord('proposal', String(submission.proposalId));
  const id = crypto.randomUUID(), baselineId = crypto.randomUUID(), at = nowIso(), requestId = crypto.randomUUID();
  const guard = { sql: 'SELECT 1 FROM projects WHERE id = ? AND last_request_id = ?', args: [id, requestId] };
  try {
    await db().batch([
      insertStatement(SPECS.project, id, { opportunityId: submission.opportunityId, proposalId: submission.proposalId, proposalVersionId: submission.proposalVersionId, submissionId: submission.id, awardEvidenceId: submission.awardEvidenceId, clientOrganizationId, title, owner, startDate, scope, plannedEndDate, actualEndDate: null, status: 'Planning', statusReason: '', activeBaselineId: baselineId, nextAction: '', nextActionDue: null }, at, requestId),
      insertStatement(SPECS.projectBaseline, baselineId, { projectId: id, number: 1, scope, plannedEndDate, source: 'Award baseline', changeRequestId: null, createdBy: actor }, at, requestId, guard),
      ...deliverables.map(d => insertStatement(SPECS.deliverable, crypto.randomUUID(), { projectId: id, milestoneId: null, title: str(d.title).trim(), description: '', owner: '', dueDate: d.dueDate || null, required: d.required !== false, draftSummary: '', status: 'Draft', latestVersionId: null, acceptedVersionId: null }, at, requestId, guard)),
      db().prepare(`INSERT OR IGNORE INTO evidence_links (id, evidence_id, subject_type, subject_id, created_at) SELECT ?, ?, 'project', ?, ? WHERE EXISTS (${guard.sql})`).bind(crypto.randomUUID(), submission.awardEvidenceId, id, at, ...guard.args),
      activity(actor, at, 'project', id, { type: 'project.created', summary: `Project created from confirmed award${proposal ? ` (proposal “${String(proposal.title).slice(0, 80)}”)` : ''}`, details: { opportunityId: submission.opportunityId, submissionId: submission.id, proposalVersionId: submission.proposalVersionId, deliverables: deliverables.length } }, 'projects', requestId),
    ]);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error))) {
      const row = await db().prepare('SELECT id FROM projects WHERE opportunity_id = ?').bind(submission.opportunityId).first<Row>();
      if (row) return { status: 200, body: { record: await getRecord('project', String(row.id)), alreadyCreated: true } };
    }
    throw error;
  }
  return { status: 201, body: { record: await getRecord('project', id), alreadyCreated: false } };
}

async function transitionProject(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const project = await getRecord('project', str(body.id));
  if (!project) return bad('Project not found.', 404);
  if (!isVersion(body.version) || project.version !== body.version) return conflict(project);
  const from = String(project.status), to = str(body.to), reason = str(body.reason).trim();
  if (to === 'Closed') return bad('Projects are closed through the closeout checklist.');
  if (!(PROJECT_TRANSITIONS[from] ?? []).includes(to)) return bad(`A project cannot move from ${from} to ${to}.`, 409);
  if (reasonRequired(from, to) && !reason) return bad(`Record the reason for moving this project to ${to}.`);
  if (reason.length > 4000) return bad('Reason is too long.');
  const at = nowIso(), requestId = crypto.randomUUID();
  const results = await db().batch([
    db().prepare('UPDATE projects SET status = ?, status_reason = ?, actual_end_date = CASE WHEN ? IN (\'Active\', \'Planning\') THEN NULL ELSE actual_end_date END, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status = ?')
      .bind(to, reason, to, at, requestId, project.id, project.version, from),
    activity(actor, at, 'project', String(project.id), { type: from === 'Closed' || from === 'Cancelled' || (from === 'Closing' && to === 'Active') ? 'project.reopened' : to === 'Cancelled' ? 'project.cancelled' : 'project.status_changed', summary: `Project status ${from} → ${to}${reason ? ` (reason recorded)` : ''}`, details: { from, to, reason: reason.slice(0, 200) } }, 'projects', requestId),
  ]);
  return results[0].meta.changes ? { status: 200, body: { record: await getRecord('project', String(project.id)) } } : conflict(await getRecord('project', String(project.id)));
}

// ── Deliverable review and acceptance ──────────────────────────────────────

const deliverableGuard = 'SELECT 1 FROM deliverables WHERE id = ? AND last_request_id = ?';
async function loadDeliverable(body: Body) {
  const deliverable = await getRecord('deliverable', str(body.id));
  if (!deliverable) return { error: bad('Deliverable not found.', 404) };
  if (!isVersion(body.version) || deliverable.version !== body.version) return { error: conflict(deliverable) };
  const project = await getRecord('project', String(deliverable.projectId));
  if (!project || ['Closed', 'Cancelled'].includes(String(project.status))) return { error: bad('Reopen the project before reviewing its deliverables.', 409) };
  return { deliverable };
}

async function submitDeliverable(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const { deliverable: d, error } = await loadDeliverable(body); if (error) return error;
  if (!['Draft', 'Changes requested'].includes(String(d!.status))) return bad(`A deliverable in ${d!.status} cannot be submitted for review.`, 409);
  if (!String(d!.draftSummary).trim()) return bad('Describe the current draft (content and where it is kept) before submitting it for review.');
  const evidenceIds = (await db().prepare("SELECT evidence_id FROM evidence_links WHERE subject_type = 'deliverable' AND subject_id = ?").bind(d!.id).all<Row>()).results.map(r => String(r.evidence_id));
  const max = await db().prepare('SELECT COALESCE(MAX(number), 0) AS n FROM deliverable_versions WHERE deliverable_id = ?').bind(d!.id).first<{ n: number }>();
  const number = Number(max?.n ?? 0) + 1, versionId = crypto.randomUUID(), at = nowIso(), requestId = crypto.randomUUID();
  const results = await db().batch([
    db().prepare("UPDATE deliverables SET status = 'Ready for review', latest_version_id = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status IN ('Draft', 'Changes requested')").bind(versionId, at, requestId, d!.id, d!.version),
    insertStatement(SPECS.deliverableVersion, versionId, { deliverableId: d!.id, number, title: d!.title, summary: d!.draftSummary, evidenceIds, status: 'Ready for review', submittedBy: actor, submittedAt: at, reviewNotes: '', reviewedBy: '', reviewedAt: '', acceptanceKind: '', acceptanceAuthority: '', acceptanceEvidenceId: null }, at, requestId, { sql: deliverableGuard, args: [d!.id, requestId] }),
    activity(actor, at, 'deliverable', String(d!.id), { type: 'deliverable.submitted_for_review', summary: `Version ${number} ready for review (nothing was sent externally)`, details: { versionId, number } }, 'deliverables', requestId),
  ]);
  return results[0].meta.changes ? { status: 200, body: { record: await getRecord('deliverable', String(d!.id)), versionId } } : conflict(await getRecord('deliverable', String(d!.id)));
}

async function reviewDeliverable(body: Body, actor: string, decision: 'accept' | 'changes'): Promise<StoreResult<unknown>> {
  const { deliverable: d, error } = await loadDeliverable(body); if (error) return error;
  if (d!.status !== 'Ready for review' || !d!.latestVersionId) return bad('Only a deliverable that is ready for review can be accepted or returned.', 409);
  const notes = str(body.notes).trim(), versionId = String(d!.latestVersionId);
  if (notes.length > 4000) return bad('Review notes are too long.');
  let kind = '', authority = '', evidenceId: string | null = null;
  if (decision === 'changes' && !notes) return bad('Record the requested revisions.');
  if (decision === 'accept') {
    kind = str(body.acceptanceKind);
    if (!(ACCEPTANCE_KINDS as readonly string[]).includes(kind)) return bad('Choose internal approval or client acceptance.');
    if (kind === 'Client acceptance') {
      authority = str(body.acceptanceAuthority).trim();
      if (!authority || authority.length > 200) return bad('Record who accepted on the client side (name and role).');
      const evidence = body.acceptanceEvidenceId ? await getRecord('evidence', str(body.acceptanceEvidenceId)) : null;
      if (!evidence || evidenceState(evidence, businessDate()) !== 'current') return bad('Client acceptance needs verified, unexpired acceptance evidence (e.g. a signed acceptance or written confirmation).');
      evidenceId = String(evidence.id);
    } else authority = `${actor} (internal approval — not client acceptance)`;
  }
  const at = nowIso(), requestId = crypto.randomUUID();
  const statements = decision === 'accept' ? [
    db().prepare("UPDATE deliverables SET status = 'Accepted', accepted_version_id = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status = 'Ready for review'").bind(versionId, at, requestId, d!.id, d!.version),
    db().prepare(`UPDATE deliverable_versions SET status = 'Superseded', version = version + 1, updated_at = ? WHERE deliverable_id = ? AND status = 'Accepted' AND id <> ? AND EXISTS (${deliverableGuard})`).bind(at, d!.id, versionId, d!.id, requestId),
    db().prepare(`UPDATE deliverable_versions SET status = 'Accepted', review_notes = ?, reviewed_by = ?, reviewed_at = ?, acceptance_kind = ?, acceptance_authority = ?, acceptance_evidence_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND EXISTS (${deliverableGuard})`).bind(notes, actor, at, kind, authority, evidenceId, at, versionId, d!.id, requestId),
    ...(evidenceId ? [db().prepare(`INSERT OR IGNORE INTO evidence_links (id, evidence_id, subject_type, subject_id, created_at) SELECT ?, ?, 'deliverable', ?, ? WHERE EXISTS (${deliverableGuard})`).bind(crypto.randomUUID(), evidenceId, d!.id, at, d!.id, requestId)] : []),
    activity(actor, at, 'deliverable', String(d!.id), { type: 'deliverable.accepted', summary: kind === 'Client acceptance' ? 'Client acceptance recorded with verified evidence' : 'Internal approval recorded (not client acceptance)', details: { versionId, kind } }, 'deliverables', requestId),
  ] : [
    db().prepare("UPDATE deliverables SET status = 'Changes requested', version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status = 'Ready for review'").bind(at, requestId, d!.id, d!.version),
    db().prepare(`UPDATE deliverable_versions SET status = 'Changes requested', review_notes = ?, reviewed_by = ?, reviewed_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND EXISTS (${deliverableGuard})`).bind(notes, actor, at, at, versionId, d!.id, requestId),
    activity(actor, at, 'deliverable', String(d!.id), { type: 'deliverable.changes_requested', summary: 'Revision requested', details: { versionId, notes: notes.slice(0, 200) } }, 'deliverables', requestId),
  ];
  const results = await db().batch(statements);
  return results[0].meta.changes ? { status: 200, body: { record: await getRecord('deliverable', String(d!.id)) } } : conflict(await getRecord('deliverable', String(d!.id)));
}

// ── Change control ──────────────────────────────────────────────────────────

/** Records a decision. Only an approval creates a new active baseline; earlier baselines are kept. */
async function decideChange(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const change = await getRecord('changeRequest', str(body.id));
  if (!change) return bad('Change request not found.', 404);
  if (!isVersion(body.version) || change.version !== body.version) return conflict(change);
  if (change.status !== 'Proposed') return bad('This change request has already been decided.', 409);
  const decision = str(body.decision), reason = str(body.reason).trim();
  if (!['Approved', 'Rejected', 'Withdrawn'].includes(decision)) return bad('Choose approve, reject or withdraw.');
  if (!reason || reason.length > 4000) return bad('Record the decision rationale.');
  const project = await getRecord('project', String(change.projectId));
  if (!project || ['Closed', 'Cancelled'].includes(String(project.status))) return bad('Reopen the project before deciding changes.', 409);
  const at = nowIso(), requestId = crypto.randomUUID(), guard = 'SELECT 1 FROM change_requests WHERE id = ? AND last_request_id = ?';
  const statements = [
    db().prepare('UPDATE change_requests SET status = ?, decision_reason = ?, decided_by = ?, decided_at = ?, resulting_baseline_id = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status = \'Proposed\'')
      .bind(decision, reason, actor, at, null, at, requestId, change.id, change.version),
  ];
  let baselineId: string | null = null;
  if (decision === 'Approved') {
    const max = await db().prepare('SELECT COALESCE(MAX(number), 0) AS n FROM project_baselines WHERE project_id = ?').bind(project.id).first<{ n: number }>();
    baselineId = crypto.randomUUID();
    const scope = String(change.newScope).trim() || String(project.scope), plannedEndDate = (change.newPlannedEndDate as string | null) ?? (project.plannedEndDate as string | null);
    statements.push(
      insertStatement(SPECS.projectBaseline, baselineId, { projectId: project.id, number: Number(max?.n ?? 0) + 1, scope, plannedEndDate, source: `Approved change: ${String(change.title).slice(0, 150)}`, changeRequestId: change.id, createdBy: actor }, at, requestId, { sql: guard, args: [change.id, requestId] }),
      db().prepare(`UPDATE change_requests SET resulting_baseline_id = ? WHERE id = ? AND EXISTS (${guard})`).bind(baselineId, change.id, change.id, requestId),
      db().prepare(`UPDATE projects SET scope = ?, planned_end_date = ?, active_baseline_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND EXISTS (${guard})`).bind(scope, plannedEndDate, baselineId, at, project.id, change.id, requestId),
      activityStatement(actor, at, 'project', String(project.id), { type: 'project.baseline_changed', summary: `Baseline updated by approved change “${String(change.title).slice(0, 100)}”`, details: { changeRequestId: change.id, baselineId } }, guard, [change.id, requestId]),
    );
  }
  statements.push(activity(actor, at, 'changeRequest', String(change.id), { type: `changeRequest.${decision.toLowerCase()}`, summary: `Change ${decision.toLowerCase()} (decision recorded; no agreement is created or modified)`, details: { baselineId } }, 'change_requests', requestId));
  const results = await db().batch(statements);
  return results[0].meta.changes ? { status: 200, body: { record: await getRecord('changeRequest', String(change.id)), baselineId } } : conflict(await getRecord('changeRequest', String(change.id)));
}

// ── Closeout ────────────────────────────────────────────────────────────────

async function closeoutProject(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const project = await getRecord('project', str(body.id));
  if (!project) return bad('Project not found.', 404);
  if (!isVersion(body.version) || project.version !== body.version) return conflict(project);
  if (project.status !== 'Closing') return bad('Move the project to Closing before completing closeout. Cancellation is recorded separately.', 409);
  const lessonsLearned = str(body.lessonsLearned).trim(), retentionNotes = str(body.retentionNotes).trim(), exceptionReason = str(body.exceptionReason).trim();
  if (lessonsLearned.length > 8000 || retentionNotes.length > 4000 || exceptionReason.length > 4000) return bad('Closeout notes are too long.');
  const actualEndDate = body.actualEndDate ? str(body.actualEndDate) : businessDate();
  if (!isIsoDate(actualEndDate)) return bad('Actual completion date must be valid.');
  const finalAcceptanceEvidenceId = body.finalAcceptanceEvidenceId ? str(body.finalAcceptanceEvidenceId) : null;
  const pid = String(project.id);
  const records = {
    project: [project], deliverable: await listByField('deliverable', 'projectId', [pid], 5000), projectLog: await listByField('projectLog', 'projectId', [pid], 5000),
    milestone: await listByField('milestone', 'projectId', [pid], 5000), changeRequest: await listByField('changeRequest', 'projectId', [pid], 5000),
    evidence: await getRecords('evidence', [finalAcceptanceEvidenceId]),
  };
  const checklist = closeoutChecklist(pid, records, { finalAcceptanceEvidenceId, lessonsLearned, archiveReviewed: body.archiveReviewed === true }, businessDate());
  const failing = checklist.filter(c => !c.passed);
  if (failing.length && !exceptionReason) return { status: 409, body: { error: `Closeout is blocked: ${failing.map(c => c.label.toLowerCase()).join('; ')}. Resolve these or record an owner exception with a reason.`, checklist } as never };
  const id = crypto.randomUUID(), at = nowIso(), requestId = crypto.randomUUID();
  const results = await db().batch([
    db().prepare("UPDATE projects SET status = 'Closed', status_reason = ?, actual_end_date = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ? AND status = 'Closing'")
      .bind(failing.length ? `Closed with owner exception: ${exceptionReason.slice(0, 300)}` : 'Closed after completing the closeout checklist', actualEndDate, at, requestId, project.id, project.version),
    insertStatement(SPECS.closeout, id, { projectId: project.id, outcome: 'Completed', lessonsLearned, finalAcceptanceEvidenceId, archiveReviewed: body.archiveReviewed === true, retentionNotes, exceptionReason: failing.length ? exceptionReason : '', checklist, closedBy: actor }, at, requestId, { sql: 'SELECT 1 FROM projects WHERE id = ? AND last_request_id = ?', args: [project.id, requestId] }),
    activity(actor, at, 'project', String(project.id), { type: failing.length ? 'project.closed_with_exception' : 'project.closed', summary: failing.length ? `Project closed with an owner exception (${failing.length} checklist items open)` : 'Project closed after completing the closeout checklist', details: { failing: failing.map(c => c.key) } }, 'projects', requestId),
  ]);
  return results[0].meta.changes ? { status: 200, body: { record: await getRecord('project', String(project.id)), checklist } } : conflict(await getRecord('project', String(project.id)));
}

// ── Experience records ──────────────────────────────────────────────────────

/** Latest closeout for a project (earlier closeouts of reopened projects are kept). */
const latestCloseout = (all: Values[], projectId: string) => all.filter(c => c.projectId === projectId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];

async function createExperience(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const project = await getRecord('project', str(body.projectId));
  if (!project) return bad('Project not found.', 404);
  const existing = await db().prepare('SELECT id FROM experience_records WHERE project_id = ?').bind(project.id).first<Row>();
  if (existing) return { status: 200, body: { record: await getRecord('experience', String(existing.id)), alreadyCreated: true } };
  const closeout = latestCloseout(await listByField('closeout', 'projectId', [project.id], 5000), String(project.id));
  if (project.status !== 'Closed' || !closeout || closeout.outcome !== 'Completed') return bad('Experience records come only from projects closed as completed (not cancelled).', 409);
  const accepted = (await listByField('deliverable', 'projectId', [project.id], 5000)).filter(d => d.acceptedVersionId);
  const versions = await getRecords('deliverableVersion', accepted.map(d => d.acceptedVersionId));
  const verified = accepted.map(d => {
    const v = versions.find(x => x.id === d.acceptedVersionId);
    return { deliverableId: d.id, title: d.title, versionId: d.acceptedVersionId, versionNumber: v?.number ?? null, acceptanceKind: v?.acceptanceKind ?? '', acceptanceEvidenceId: v?.acceptanceEvidenceId ?? null };
  });
  const id = crypto.randomUUID(), at = nowIso(), requestId = crypto.randomUUID();
  try {
    await db().batch([
      insertStatement(SPECS.experience, id, { projectId: project.id, title: project.title, clientLabel: '', actualScope: project.scope, startDate: project.startDate, endDate: project.actualEndDate, outcomes: '', lessonsLearned: closeout.lessonsLearned, permissionReference: '', permissionEvidenceId: null, verifiedDeliverables: verified, publicationStatus: 'Private', reviewedBy: '', reviewedAt: '', provenance: {} }, at, requestId),
      activity(actor, at, 'experience', id, { type: 'experience.created', summary: 'Private experience record created from a completed project' }, 'experience_records', requestId),
    ]);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error))) { const row = await db().prepare('SELECT id FROM experience_records WHERE project_id = ?').bind(project.id).first<Row>(); if (row) return { status: 200, body: { record: await getRecord('experience', String(row.id)), alreadyCreated: true } }; }
    throw error;
  }
  return { status: 201, body: { record: await getRecord('experience', id), alreadyCreated: false } };
}

/** Owner review of an experience record. Approval snapshots the provenance of every claim. */
async function reviewExperience(body: Body, actor: string): Promise<StoreResult<unknown>> {
  const exp = await getRecord('experience', str(body.id));
  if (!exp) return bad('Experience record not found.', 404);
  if (!isVersion(body.version) || exp.version !== body.version) return conflict(exp);
  const to = str(body.to), reason = str(body.reason).trim();
  const allowed: Record<string, string[]> = { Private: ['Ready for owner review'], 'Ready for owner review': ['Approved for capability statement', 'Private'], 'Approved for capability statement': ['Withdrawn', 'Private'], Withdrawn: ['Private'] };
  if (!(allowed[String(exp.publicationStatus)] ?? []).includes(to)) return bad(`An experience record cannot move from ${exp.publicationStatus} to ${to}.`, 409);
  if (to === 'Withdrawn' && !reason) return bad('Record why the approval is withdrawn.');
  let provenance: Values = (exp.provenance as Values) ?? {};
  if (to === 'Approved for capability statement') {
    const today = businessDate();
    const project = await getRecord('project', String(exp.projectId));
    const closeout = latestCloseout(await listByField('closeout', 'projectId', [exp.projectId], 5000), String(exp.projectId));
    const verified = (exp.verifiedDeliverables as Values[]) ?? [];
    const outcomeEvidence = (await db().prepare("SELECT e.* FROM evidence e JOIN evidence_links l ON l.evidence_id = e.id WHERE l.subject_type = 'experience' AND l.subject_id = ?").bind(exp.id).all<Row>()).results;
    const currentOutcomeEvidence = outcomeEvidence.filter(e => evidenceState({ reviewStatus: e.review_status, reviewDate: e.review_date }, today) === 'current');
    const permission = exp.permissionEvidenceId ? await getRecord('evidence', String(exp.permissionEvidenceId)) : null;
    if (!String(exp.clientLabel).trim()) return bad('Describe how the client is named (a generic description unless permission allows naming them).');
    if (!verified.length) return bad('Only experience with at least one accepted deliverable can be approved.');
    if (String(exp.outcomes).trim() && !currentOutcomeEvidence.length) return bad('Link verified evidence for the measured outcomes, or remove the outcomes.');
    if (!(permission && evidenceState(permission, today) === 'current') && !String(exp.permissionReference).trim()) return bad('Record the client’s permission (verified evidence or a reference) before approving use.');
    provenance = { projectId: exp.projectId, opportunityId: project?.opportunityId ?? null, proposalVersionId: project?.proposalVersionId ?? null, submissionId: project?.submissionId ?? null, awardEvidenceId: project?.awardEvidenceId ?? null, closeoutId: closeout?.id ?? null, closeoutException: closeout?.exceptionReason || null, acceptedDeliverables: verified, outcomeEvidenceIds: currentOutcomeEvidence.map(e => e.id), permission: { reference: exp.permissionReference, evidenceId: exp.permissionEvidenceId }, approvedBy: actor, approvedAt: nowIso() };
  }
  const at = nowIso(), requestId = crypto.randomUUID();
  const results = await db().batch([
    db().prepare('UPDATE experience_records SET publication_status = ?, reviewed_by = ?, reviewed_at = ?, provenance = ?, version = version + 1, updated_at = ?, last_request_id = ? WHERE id = ? AND version = ?')
      .bind(to, to === 'Approved for capability statement' ? actor : exp.reviewedBy, to === 'Approved for capability statement' ? at : exp.reviewedAt, JSON.stringify(provenance), at, requestId, exp.id, exp.version),
    activity(actor, at, 'experience', String(exp.id), { type: 'experience.review', summary: `Experience record: ${exp.publicationStatus} → ${to}${to === 'Approved for capability statement' ? ' (owner review; provenance recorded; not published to the website)' : ''}`, details: { to, reason: reason.slice(0, 200) } }, 'experience_records', requestId),
  ]);
  return results[0].meta.changes ? { status: 200, body: { record: await getRecord('experience', String(exp.id)) } } : conflict(await getRecord('experience', String(exp.id)));
}

export const ACTIONS: Record<string, Action> = {
  'deliverable.submitForReview': submitDeliverable,
  'deliverable.requestChanges': (b, a) => reviewDeliverable(b, a, 'changes'),
  'deliverable.accept': (b, a) => reviewDeliverable(b, a, 'accept'),
  'changeRequest.decide': decideChange,
  'project.closeout': closeoutProject,
  'experience.createFromProject': createExperience,
  'experience.review': reviewExperience,
  'project.createFromAward': createProjectFromAward,
  'project.transition': transitionProject,
  'proposal.create': createProposal,
  'proposal.submitForReview': submitForReview,
  'proposal.approve': (b, a) => reviewProposal(b, a, 'approve'),
  'proposal.requestChanges': (b, a) => reviewProposal(b, a, 'changes'),
  'proposal.recordSubmission': recordSubmission,
  'proposal.saveTemplate': saveTemplate,
  'submission.recordOutcome': recordOutcome,
  'evidence.link': (b, a) => linkEvidence(b, a),
  'evidence.unlink': (b, a) => linkEvidence(b, a, true),
  'organization.merge': (b, a) => merge('organization', b, a),
  'contact.merge': (b, a) => merge('contact', b, a),
  'organization.linkExisting': linkExisting,
  'inquiry.link': (b, a) => linkParty('inquiries', 'inquiry', b, a),
  'opportunity.link': (b, a) => linkParty('opportunities', 'opportunity', b, a),
  'importConflict.resolve': resolveImportConflict,
};
export type { Values };
