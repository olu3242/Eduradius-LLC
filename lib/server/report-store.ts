// Operational report over the FULL dataset, aggregated on the server (GET /api/reports).
// Only rows that can meet a metric definition are read (filtered in SQL), and the shared
// definitions in lib/reports.ts are applied to them. Each metric returns its full `count`
// and at most REPORT_ITEM_LIMIT items, flagged with `truncated` when more exist.
import { SPECS, type EvidenceLink, type Values } from '../records';
import { addDays, operationalReport, type Metric } from '../reports';
import { businessDate, type OpportunityRecord } from '../workflow';
import { db, getRecords, listByField, toRecord } from './records-store';
import { OPPORTUNITY_SELECT, toOpportunity } from './workflow-store';

export const REPORT_ITEM_LIMIT = 100;
type Row = Record<string, unknown>;
const OPEN_PROJECT = "('Planning', 'Active', 'On hold', 'Closing')";
const rows = async (type: string, where: string, args: unknown[] = []) =>
  (await db().prepare(`SELECT * FROM ${SPECS[type].table} WHERE ${where}`).bind(...args).all<Row>()).results.map(r => toRecord(SPECS[type], r));

export async function serverReport(horizonDays = 14) {
  const today = businessDate();
  const horizon2 = addDays(today, horizonDays * 2);
  const totalsRow = (await db().prepare(`SELECT ${Object.entries(SPECS).map(([type, spec]) => `(SELECT COUNT(*) FROM ${spec.table}) AS "${type}"`).join(', ')}`).first<Row>())!;
  const totals = Object.fromEntries(Object.entries(totalsRow).map(([k, v]) => [k, Number(v)]));

  const openOpps = (await db().prepare(`SELECT ${OPPORTUNITY_SELECT} FROM opportunities o WHERE o.stage <> 'Closed' AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.opportunity_id = o.id)`).all<Row>()).results.map(toOpportunity);
  const openProjects = await rows('project', `status IN ${OPEN_PROJECT}`);
  const openProjectIds = openProjects.map(p => p.id);
  const requirements = await listByField('requirement', 'opportunityId', openOpps.map(o => o.id), 1_000_000);
  const links: EvidenceLink[] = [];
  const reqIds = requirements.map(r => String(r.id));
  for (let i = 0; i < reqIds.length; i += 90) {
    const chunk = reqIds.slice(i, i + 90);
    links.push(...(await db().prepare(`SELECT id, evidence_id, subject_type, subject_id, created_at FROM evidence_links WHERE subject_type = 'requirement' AND subject_id IN (${chunk.map(() => '?').join(', ')})`).bind(...chunk).all<Row>()).results
      .map(r => ({ id: String(r.id), evidenceId: String(r.evidence_id), subjectType: String(r.subject_type), subjectId: String(r.subject_id), createdAt: String(r.created_at) })));
  }
  const reviewEvidence = await rows('evidence', "review_date IS NOT NULL AND review_date <= ? AND review_status NOT IN ('Rejected', 'Superseded')", [horizon2]);
  const linkedEvidence = await getRecords('evidence', links.map(l => l.evidenceId).filter(id => !reviewEvidence.some(e => e.id === id)));
  const proposals = await rows('proposal', "status = 'Internal review'");
  const submissions = await rows('submission', "outcome = 'Pending'");
  const milestones = (await listByField('milestone', 'projectId', openProjectIds, 1_000_000)).filter(m => m.status !== 'Complete');
  const deliverables = await rows('deliverable', "status = 'Ready for review'");
  const changes = await rows('changeRequest', "status = 'Proposed'");
  const logs = (await listByField('projectLog', 'projectId', openProjectIds, 1_000_000)).filter(l => ['Risk', 'Issue'].includes(String(l.kind)) && ['Open', 'Monitoring'].includes(String(l.status)));
  // Titles for items that belong to records outside the filtered sets.
  const extraProjects = await getRecords('project', [...deliverables, ...changes].map(x => x.projectId).filter(id => !openProjectIds.includes(id)));
  const oppIds = new Set(openOpps.map(o => o.id));
  const extraOpps = submissions.map(x => String(x.opportunityId)).filter(id => !oppIds.has(id));
  const titledOpps: OpportunityRecord[] = [];
  for (let i = 0; i < extraOpps.length; i += 90) {
    const chunk = extraOpps.slice(i, i + 90);
    titledOpps.push(...(await db().prepare(`SELECT ${OPPORTUNITY_SELECT} FROM opportunities WHERE id IN (${chunk.map(() => '?').join(', ')})`).bind(...chunk).all<Row>()).results.map(toOpportunity));
  }
  // Projects referenced only for titles must not count as open: mark them so the definition filters them out.
  const data = {
    opportunities: [...openOpps, ...titledOpps.map(o => ({ ...o, stage: 'Closed' }))],
    evidenceLinks: links,
    records: {
      project: [...openProjects, ...extraProjects.filter(p => !openProjects.some(o => o.id === p.id))], requirement: requirements, evidence: [...reviewEvidence, ...linkedEvidence],
      proposal: proposals, submission: submissions, milestone: milestones, deliverable: deliverables, changeRequest: changes, projectLog: logs,
    } as Record<string, Values[]>,
  };
  // Evidence without a review date is counted across the whole register, as in the shared definition.
  const undated = Number((await db().prepare('SELECT COUNT(*) AS n FROM evidence WHERE review_date IS NULL').first<Row>())?.n ?? 0);
  const metrics = operationalReport(data, today, horizonDays, totals).map((m: Metric) => ({ ...m, unavailable: m.key === 'evidence-review' ? undated : m.unavailable, count: m.items.length, truncated: m.items.length > REPORT_ITEM_LIMIT, items: m.items.slice(0, REPORT_ITEM_LIMIT) }));
  return { today, horizonDays, generatedAt: new Date().toISOString(), itemLimit: REPORT_ITEM_LIMIT, metrics };
}
