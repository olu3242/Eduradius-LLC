// Explicit, transactional workflow actions dispatched by POST /api/actions/:name.
// Generic edits (records-store) never change workflow-controlled fields; these do.
import { SPECS, EVIDENCE_SUBJECTS, PROJECT_TRANSITIONS, reasonRequired, SECTION_BASIS, SUBMISSION_METHODS, SUBMISSION_OUTCOMES, emptySections, evidenceState, organizationKey, emailKey, websiteDomain, validateSections, type Sections, type Values } from '../records';
import { businessDate, isIsoDate } from '../workflow';
import { activityStatement, type StoreResult } from './workflow-store';
import { db, nowIso, getRecord, recordExists, tableFor, activity, conflict, insertStatement } from './records-store';

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

export const ACTIONS: Record<string, Action> = {
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
};
export type { Values };
