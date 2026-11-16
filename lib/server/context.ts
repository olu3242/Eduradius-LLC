// Detail-view context: one record plus the related records its view needs, in one request.
// Children are read by parent key (indexed) and bounded by CHILD_LIMIT; `totals` reports
// the full count so the UI can say when a list is incomplete instead of truncating silently.
import { SPECS, type EvidenceLink, type Values } from '../records';
import { db, getRecord, getRecords, listByField, toRecord } from './records-store';
import { getInquiry, getOpportunity, INQUIRY_SELECT, OPPORTUNITY_SELECT, toInquiry, toOpportunity } from './workflow-store';

export const CHILD_LIMIT = 500;
type Row = Record<string, unknown>;
/** Tells the client which cached collections this response replaces (so deletions disappear). */
export type Scope = { type: string; key: string; ids: string[] };
export type Context = { record: Values; records: Record<string, Values[]>; evidenceLinks: EvidenceLink[]; linkScopes: { subjectType: string; ids: string[] }[]; scopes: Scope[]; totals: Record<string, number>; inquiries?: Values[]; opportunities?: Values[]; activity?: Values[] };

const uniq = (values: unknown[]) => [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))];
const toLink = (r: Row): EvidenceLink => ({ id: String(r.id), evidenceId: String(r.evidence_id), subjectType: String(r.subject_type), subjectId: String(r.subject_id), createdAt: String(r.created_at) });

async function countBy(table: string, column: string, id: string) {
  return Number((await db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).bind(id).first<Row>())?.n ?? 0);
}
async function children(out: Context, type: string, key: string, parentIds: string[]) {
  const items = await listByField(type, key, parentIds, CHILD_LIMIT);
  out.records[type] = [...(out.records[type] ?? []), ...items];
  out.scopes.push({ type, key, ids: parentIds });
  if (items.length >= CHILD_LIMIT && parentIds.length === 1) out.totals[type] = await countBy(SPECS[type].table, SPECS[type].fields.find(f => f.key === key)!.column, parentIds[0]);
  return items;
}
async function linksFor(out: Context, subjectType: string, ids: string[]) {
  out.linkScopes.push({ subjectType, ids });
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const rows = (await db().prepare(`SELECT id, evidence_id, subject_type, subject_id, created_at FROM evidence_links WHERE subject_type = ? AND subject_id IN (${chunk.map(() => '?').join(', ')}) ORDER BY created_at, rowid`).bind(subjectType, ...chunk).all<Row>()).results;
    out.evidenceLinks.push(...rows.map(toLink));
  }
}
async function addRecords(out: Context, type: string, ids: unknown[]) {
  const have = new Set((out.records[type] ?? []).map(r => r.id));
  const missing = uniq(ids).filter(id => !have.has(id));
  if (missing.length) out.records[type] = [...(out.records[type] ?? []), ...(await getRecords(type, missing))];
}
const sectionRefs = (proposals: Values[]) => proposals.flatMap(p => Object.values((p.sections as Record<string, { refs?: unknown[] }>) ?? {}).flatMap(s => (Array.isArray(s?.refs) ? s.refs : [])));
const empty = (record: Values): Context => ({ record, records: {}, evidenceLinks: [], linkScopes: [], scopes: [], totals: {} });

export async function opportunityContext(id: string): Promise<Context | null> {
  const opportunity = await getOpportunity(id);
  if (!opportunity) return null;
  const out = empty(opportunity as unknown as Values);
  out.opportunities = [opportunity as unknown as Values];
  const requirements = await children(out, 'requirement', 'opportunityId', [id]);
  const proposals = await children(out, 'proposal', 'opportunityId', [id]);
  const versions = await children(out, 'proposalVersion', 'proposalId', uniq(proposals.map(p => p.id)));
  const submissions = await children(out, 'submission', 'opportunityId', [id]);
  const partners = await children(out, 'teamingPartner', 'opportunityId', [id]);
  await children(out, 'project', 'opportunityId', [id]);
  // Proposal templates are workspace-wide reference data; bounded and merged (not replaced).
  out.records.proposalTemplate = (await db().prepare('SELECT * FROM proposal_templates ORDER BY lower(name), id LIMIT 100').all<Row>()).results.map(r => toRecord(SPECS.proposalTemplate, r));
  await linksFor(out, 'opportunity', [id]);
  await linksFor(out, 'requirement', uniq(requirements.map(r => r.id)));
  await linksFor(out, 'proposal', uniq(proposals.map(p => p.id)));
  await addRecords(out, 'organization', [opportunity.organizationId, ...partners.map(p => p.organizationId)]);
  await addRecords(out, 'contact', [opportunity.contactId, ...partners.map(p => p.contactId)]);
  await addRecords(out, 'evidence', [...out.evidenceLinks.map(l => l.evidenceId), ...submissions.map(s => s.awardEvidenceId), ...sectionRefs([...proposals, ...versions]), ...versions.flatMap(v => (v.evidenceIds as string[]) ?? [])]);
  return out;
}

export async function projectContext(id: string): Promise<Context | null> {
  const project = await getRecord('project', id);
  if (!project) return null;
  const out = empty(project);
  out.records.project = [project];
  await children(out, 'milestone', 'projectId', [id]);
  const deliverables = await children(out, 'deliverable', 'projectId', [id]);
  const versions = await children(out, 'deliverableVersion', 'deliverableId', uniq(deliverables.map(d => d.id)));
  await children(out, 'projectLog', 'projectId', [id]);
  await children(out, 'changeRequest', 'projectId', [id]);
  await children(out, 'projectBaseline', 'projectId', [id]);
  const closeouts = await children(out, 'closeout', 'projectId', [id]);
  const experience = await children(out, 'experience', 'projectId', [id]);
  await linksFor(out, 'project', [id]);
  await linksFor(out, 'deliverable', uniq(deliverables.map(d => d.id)));
  await linksFor(out, 'experience', uniq(experience.map(e => e.id)));
  await addRecords(out, 'proposalVersion', [project.proposalVersionId]);
  await addRecords(out, 'submission', [project.submissionId]);
  await addRecords(out, 'organization', [project.clientOrganizationId]);
  const opportunity = project.opportunityId ? await getOpportunity(String(project.opportunityId)) : null;
  if (opportunity) out.opportunities = [opportunity as unknown as Values];
  await addRecords(out, 'evidence', [project.awardEvidenceId, ...out.evidenceLinks.map(l => l.evidenceId), ...versions.flatMap(v => [v.acceptanceEvidenceId, ...((v.evidenceIds as string[]) ?? [])]), ...closeouts.map(c => c.finalAcceptanceEvidenceId), ...experience.map(e => e.permissionEvidenceId)]);
  return out;
}

export async function organizationContext(id: string): Promise<Context | null> {
  const organization = await getRecord('organization', id);
  if (!organization) return null;
  const out = empty(organization);
  out.records.organization = [organization];
  await children(out, 'contact', 'organizationId', [id]);
  await addRecords(out, 'organization', [organization.mergedIntoId]);
  const [inquiries, opportunities] = await db().batch([
    db().prepare(`SELECT ${INQUIRY_SELECT} FROM inquiries WHERE organization_id = ? ORDER BY created_at DESC, id DESC LIMIT 101`).bind(id),
    db().prepare(`SELECT ${OPPORTUNITY_SELECT} FROM opportunities WHERE organization_id = ? ORDER BY created_at DESC, id DESC LIMIT 101`).bind(id),
  ]);
  out.inquiries = (inquiries.results as Row[]).slice(0, 100).map(r => toInquiry(r) as unknown as Values);
  out.opportunities = (opportunities.results as Row[]).slice(0, 100).map(r => toOpportunity(r) as unknown as Values);
  if (inquiries.results.length > 100) out.totals.inquiry = await countBy('inquiries', 'organization_id', id);
  if (opportunities.results.length > 100) out.totals.opportunity = await countBy('opportunities', 'organization_id', id);
  return out;
}

export async function inquiryContext(id: string): Promise<Context | null> {
  const inquiry = await getInquiry(id);
  if (!inquiry) return null;
  const out = empty(inquiry as unknown as Values);
  out.inquiries = [inquiry as unknown as Values];
  out.activity = (await db().prepare('SELECT id, occurred_at, actor, type, subject_type, subject_id, summary, details FROM activity_events WHERE subject_type = ? AND subject_id = ? ORDER BY occurred_at DESC, rowid DESC LIMIT 100').bind('inquiry', id).all<Row>()).results
    .map(r => ({ id: r.id, occurredAt: r.occurred_at, actor: r.actor, type: r.type, subjectType: r.subject_type, subjectId: r.subject_id, summary: r.summary, details: (() => { try { return JSON.parse(String(r.details)); } catch { return {}; } })() }));
  if (inquiry.opportunityId) { const o = await getOpportunity(inquiry.opportunityId); if (o) out.opportunities = [o as unknown as Values]; }
  await addRecords(out, 'organization', [inquiry.organizationId]);
  await addRecords(out, 'contact', [inquiry.contactId]);
  return out;
}

export const CONTEXTS: Record<string, (id: string) => Promise<Context | null>> = { opportunity: opportunityContext, project: projectContext, organization: organizationContext, inquiry: inquiryContext };
