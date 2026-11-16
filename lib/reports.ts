// Operational reporting: pure calculations over workflow records, shared by UI and tests.
// Dates are business-calendar dates (YYYY-MM-DD, America/Chicago) compared as strings.
// This is operational tracking only — not accounting, invoicing or financial reporting.
import { evidenceState, requirementSummary, type EvidenceLink, type Values } from './records';
import type { OpportunityRecord } from './workflow';

export type ReportItem = { id: string; title: string; detail: string; due?: string | null; kind: string };
export type Metric = {
  key: string; label: string; definition: string; source: string;
  /** Items that meet the definition. */
  items: ReportItem[];
  /** Records that could not be evaluated (e.g. missing dates) — shown separately, never as zero. */
  unavailable: number;
  /** True when the source has no records at all ("no data yet" rather than "zero"). */
  noData: boolean;
};

/** Adds days to a YYYY-MM-DD calendar date without timezone drift. */
export function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

type Data = { opportunities: OpportunityRecord[]; records: Record<string, Values[]>; evidenceLinks: EvidenceLink[] };
const s = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const OPEN_PROJECT = ['Planning', 'Active', 'On hold', 'Closing'];

export function operationalReport(data: Data, today: string, horizonDays = 14): Metric[] {
  const r = (type: string) => data.records[type] ?? [];
  const projects = r('project'), openProjects = projects.filter(p => OPEN_PROJECT.includes(s(p.status)));
  const openProjectIds = new Set(openProjects.map(p => s(p.id)));
  const projectTitle = (id: unknown) => s(projects.find(p => p.id === id)?.title);
  const evidenceById = new Map(r('evidence').map(e => [s(e.id), e]));
  const openOpps = data.opportunities.filter(o => o.stage !== 'Closed' && !projects.some(p => p.opportunityId === o.id));
  const horizon = addDays(today, horizonDays);

  const awaitingRequirements = openOpps.map(o => {
    const reqs = r('requirement').filter(q => q.opportunityId === o.id);
    const summary = requirementSummary(reqs, evidenceById, data.evidenceLinks, today);
    const reason = !reqs.length ? 'No requirements recorded' : summary.evidenceNeeded ? `${summary.evidenceNeeded} awaiting evidence` : summary.weakEvidence ? `${summary.weakEvidence} with unreviewed or expired evidence` : '';
    return reason ? { id: o.id, title: o.title, detail: reason, kind: 'opportunity' } : null;
  }).filter(Boolean) as ReportItem[];

  const milestones = r('milestone').filter(m => openProjectIds.has(s(m.projectId)) && m.status !== 'Complete');
  const activeForCloseout = openProjects.filter(p => p.status === 'Active');
  const evidence = r('evidence');

  return [
    { key: 'opportunities-awaiting', label: 'Opportunities awaiting requirements or evidence', definition: 'Open opportunities (not closed, no project yet) with no requirements, requirements marked “Evidence needed”, or requirements whose linked evidence is unreviewed or expired.', source: 'opportunities, requirements, evidence, evidence_links', items: awaitingRequirements, unavailable: 0, noData: !openOpps.length },
    { key: 'proposals-review', label: 'Proposals awaiting owner review', definition: 'Proposals in “Internal review”.', source: 'proposals', items: r('proposal').filter(p => p.status === 'Internal review').map(p => ({ id: s(p.id), title: s(p.title), detail: 'In owner review', kind: 'proposal' })), unavailable: 0, noData: !r('proposal').length },
    { key: 'submitted-pending', label: 'Submitted proposals awaiting an outcome', definition: 'Submission records whose outcome is still “Pending”.', source: 'submissions', items: r('submission').filter(x => x.outcome === 'Pending').map(x => ({ id: s(x.id), title: s(data.opportunities.find(o => o.id === x.opportunityId)?.title) || 'Submission', detail: `Submitted ${s(x.submittedOn)} · ${s(x.method)}`, due: null, kind: 'submission' })), unavailable: 0, noData: !r('submission').length },
    { key: 'active-projects', label: 'Active projects', definition: 'Projects in Planning, Active, On hold or Closing.', source: 'projects', items: openProjects.map(p => ({ id: s(p.id), title: s(p.title), detail: s(p.status), due: (p.plannedEndDate as string | null) ?? null, kind: 'project' })), unavailable: 0, noData: !projects.length },
    { key: 'overdue-milestones', label: 'Overdue milestones', definition: 'Incomplete milestones in open projects whose planned date is before today (business date). Milestones without a planned date cannot be evaluated and are counted separately.', source: 'milestones', items: milestones.filter(m => m.plannedDate && s(m.plannedDate) < today).map(m => ({ id: s(m.id), title: s(m.title), detail: projectTitle(m.projectId), due: s(m.plannedDate), kind: 'milestone' })), unavailable: milestones.filter(m => !m.plannedDate).length, noData: !r('milestone').length },
    { key: 'deliverables-review', label: 'Deliverables awaiting review', definition: 'Deliverables in “Ready for review”.', source: 'deliverables', items: r('deliverable').filter(d => d.status === 'Ready for review').map(d => ({ id: s(d.id), title: s(d.title), detail: projectTitle(d.projectId), due: (d.dueDate as string | null) ?? null, kind: 'deliverable' })), unavailable: 0, noData: !r('deliverable').length },
    { key: 'changes-pending', label: 'Changes awaiting decision', definition: 'Change requests still “Proposed”.', source: 'change_requests', items: r('changeRequest').filter(c => c.status === 'Proposed').map(c => ({ id: s(c.id), title: s(c.title), detail: projectTitle(c.projectId), kind: 'changeRequest' })), unavailable: 0, noData: !r('changeRequest').length },
    { key: 'approaching-closeout', label: 'Projects approaching closeout', definition: `Projects in “Closing”, or Active projects whose planned completion is within ${horizonDays} days (or past). Active projects without a planned completion date cannot be evaluated.`, source: 'projects', items: openProjects.filter(p => p.status === 'Closing' || (p.status === 'Active' && p.plannedEndDate && s(p.plannedEndDate) <= horizon)).map(p => ({ id: s(p.id), title: s(p.title), detail: p.status === 'Closing' ? 'Closing' : `Planned completion ${s(p.plannedEndDate)}`, due: (p.plannedEndDate as string | null) ?? null, kind: 'project' })), unavailable: activeForCloseout.filter(p => !p.plannedEndDate).length, noData: !projects.length },
    { key: 'risks-issues', label: 'Unresolved risks and issues', definition: 'Risks and issues in Open or Monitoring status on open projects.', source: 'project_log', items: r('projectLog').filter(l => openProjectIds.has(s(l.projectId)) && ['Risk', 'Issue'].includes(s(l.kind)) && ['Open', 'Monitoring'].includes(s(l.status))).map(l => ({ id: s(l.id), title: `${s(l.kind)}: ${s(l.title)}`, detail: `${s(l.severity)} · ${projectTitle(l.projectId)}`, due: (l.dueDate as string | null) ?? null, kind: 'projectLog' })), unavailable: 0, noData: !r('projectLog').length },
    { key: 'evidence-review', label: 'Evidence expired or due for review', definition: `Evidence whose expiration/review date is before today or within ${horizonDays * 2} days. Evidence without a review date cannot be evaluated.`, source: 'evidence', items: evidence.filter(e => e.reviewDate && s(e.reviewDate) <= addDays(today, horizonDays * 2) && !['Rejected', 'Superseded'].includes(s(e.reviewStatus))).map(e => ({ id: s(e.id), title: s(e.title), detail: evidenceState(e, today) === 'expired' ? 'Expired' : 'Review due soon', due: s(e.reviewDate), kind: 'evidence' })), unavailable: evidence.filter(e => !e.reviewDate).length, noData: !evidence.length },
  ];
}
