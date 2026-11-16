'use client';
// Award → project conversion and delivery planning UI.
import { useState, type ReactNode } from 'react';
import { ArrowLeft, BriefcaseBusiness, Plus, Search, Trash2 } from 'lucide-react';
import { SPECS, PROJECT_TRANSITIONS, reasonRequired, type Sections, type Values } from '../../lib/records';
import type { OpportunityRecord } from '../../lib/workflow';
import { Alert, DueChip, StatusBadge, type Workflow } from './workflow';
import { EvidenceLinks, RecordDialog, recs, saver, Tabs, type PursuitTab } from './records-ui';
import { usePagedList, useRecordContext } from './data';
import { ListFooter, ListGate, RefPicker } from './list-ui';
import { RefreshCw } from 'lucide-react';
import { Dialog } from './pursuit-ui';
import { DeliverablesPanel } from './delivery-ui';

const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

// ── Pursuit tab: confirmed award → project ──────────────────────────────────

export function AwardProjectPanel({ wf, opportunity, onOpenProject }: { wf: Workflow; opportunity: OpportunityRecord; onOpenProject: (id: string) => void }) {
  const [creating, setCreating] = useState<Values | null>(null);
  const project = recs(wf, 'project').find(p => p.opportunityId === opportunity.id);
  const awarded = recs(wf, 'submission').filter(s => s.opportunityId === opportunity.id && s.outcome === 'Awarded' && s.awardEvidenceId);
  if (project) return <div className="notice"><BriefcaseBusiness size={16} aria-hidden="true" /><span>Project “{str(project.title)}” was created from this award ({str(project.status)}). The opportunity, proposal and approved version stay available here.</span><button className="button secondary" onClick={() => onOpenProject(str(project.id))}>Open project</button></div>;
  return <>
    <div className="notice"><span>A project can be created only from a recorded award with award evidence. Proposal approval or submission is not an award.</span></div>
    {awarded.length ? awarded.map(s => <div key={str(s.id)} className="section-toolbar"><span>Award recorded {str(s.outcomeDate)}</span><button className="button primary" onClick={() => setCreating(s)}>Review and create project</button></div>)
      : <p className="muted empty-row">No confirmed award yet. Record the outcome on the Submission & award tab.</p>}
    {creating && <CreateProjectDialog wf={wf} opportunity={opportunity} submission={creating} onClose={() => setCreating(null)} onCreated={id => { setCreating(null); onOpenProject(id); }} />}
  </>;
}

function CreateProjectDialog({ wf, opportunity, submission, onClose, onCreated }: { wf: Workflow; opportunity: OpportunityRecord; submission: Values; onClose: () => void; onCreated: (id: string) => void }) {
  const version = recs(wf, 'proposalVersion').find(v => v.id === submission.proposalVersionId);
  const sections = (version?.sections ?? {}) as Sections;
  const proposedScope = ['understanding', 'approach', 'deliverables'].map(k => sections[k]?.body?.trim()).filter(Boolean).join('\n\n');
  const [form, setForm] = useState({ title: opportunity.title, clientOrganizationId: opportunity.organizationId ?? '', owner: opportunity.owner, startDate: str(submission.outcomeDate), plannedEndDate: '', scope: proposedScope || '', confirm: false });
  const [deliverables, setDeliverables] = useState<{ title: string; dueDate: string; required: boolean }[]>([{ title: '', dueDate: '', required: true }]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const r = await wf.action<{ record: Values }>('project.createFromAward', { submissionId: submission.id, ...form, clientOrganizationId: form.clientOrganizationId || null, startDate: form.startDate || null, plannedEndDate: form.plannedEndDate || null, deliverables: deliverables.filter(d => d.title.trim()).map(d => ({ ...d, dueDate: d.dueDate || null })) });
    setBusy(false);
    if (r.ok) onCreated(str(r.data.record.id)); else setError(r.error);
  }
  return <Dialog title="Review the awarded project" eyebrow="CONFIRMED AWARD → PROJECT" onClose={onClose}><form onSubmit={e => void submit(e)}>
    <p className="muted">Check the client, scope, owner, dates and initial deliverables. The scope becomes baseline 1; later changes need an approved change request.{version ? ` Prefilled from approved proposal version ${str(version.number)}.` : ''}</p>
    <div className="form-grid">
      <label className="field wide"><span>Project title *</span><input required maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <RefPicker wf={wf} type="organization" label="Client organization" placeholder="Not linked" value={form.clientOrganizationId || null} onChange={id => setForm({ ...form, clientOrganizationId: id ?? '' })} filters={{ status: 'Active' }} />
      <label className="field"><span>Project owner</span><input maxLength={120} value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} /></label>
      <label className="field"><span>Start date</span><input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></label>
      <label className="field"><span>Planned completion</span><input type="date" value={form.plannedEndDate} onChange={e => setForm({ ...form, plannedEndDate: e.target.value })} /></label>
      <label className="field wide"><span>Awarded scope (baseline) *</span><textarea required rows={5} maxLength={8000} value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })} /></label>
    </div>
    <fieldset className="proposal-section"><legend>Initial deliverables</legend>
      {deliverables.map((d, i) => <div className="deliverable-row" key={i}>
        <label className="field"><span>Deliverable {i + 1}</span><input maxLength={200} value={d.title} onChange={e => setDeliverables(ds => ds.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} /></label>
        <label className="field"><span>Due date</span><input type="date" value={d.dueDate} onChange={e => setDeliverables(ds => ds.map((x, j) => j === i ? { ...x, dueDate: e.target.value } : x))} /></label>
        <label className="inline-check"><input type="checkbox" checked={d.required} onChange={e => setDeliverables(ds => ds.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))} />Required for closeout</label>
        <button type="button" className="icon-button small" aria-label={`Remove deliverable ${i + 1}`} onClick={() => setDeliverables(ds => ds.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
      </div>)}
      <button type="button" className="text-button" onClick={() => setDeliverables(ds => [...ds, { title: '', dueDate: '', required: true }])}><Plus size={13} />Add deliverable</button>
    </fieldset>
    <label className="field wide checkbox-field"><input type="checkbox" required checked={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.checked })} /><span>I confirm these details match the written award. Creating the project does not sign or accept any agreement.</span></label>
    <Alert message={error} />
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button></div>
  </form></Dialog>;
}

export const awardTab = (wf: Workflow, onOpenProject: (id: string) => void) => (o: OpportunityRecord): PursuitTab[] => [
  { id: 'project', label: 'Project', render: () => <section className="panel followup-section"><AwardProjectPanel wf={wf} opportunity={o} onOpenProject={onOpenProject} /></section> },
];

// ── Projects list and project workspace ─────────────────────────────────────

export function ProjectsView({ wf, onOpen }: { wf: Workflow; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState('Open projects'), [query, setQuery] = useState('');
  const list = usePagedList(wf, 'project', { q: query, filters: status === 'All' ? {} : status === 'Open projects' ? { open: 'true' } : { status } });
  const filtered = status !== 'Open projects' || Boolean(query.trim());
  return <>
    <div className="table-tools workflow-tools"><label className="search"><Search size={16} /><input type="search" aria-label="Search projects" placeholder="Search projects" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="filter-row"><select aria-label="Filter projects by status" value={status} onChange={e => setStatus(e.target.value)}>{['Open projects', 'All', 'Planning', 'Active', 'On hold', 'Closing', 'Closed', 'Cancelled'].map(s => <option key={s}>{s}</option>)}</select></div></div>
    <ListGate list={list} noun="projects" filtered={filtered} onClear={() => { setStatus('All'); setQuery(''); }}
      empty={<section className="panel large-empty"><BriefcaseBusiness size={28} /><h2>No projects yet.</h2><p>Projects are created from a confirmed award on an opportunity’s Project tab.</p></section>}>
      <div className="opportunity-grid">{list.items.map(p => <section className="panel opportunity-card" key={str(p.id)} aria-labelledby={`prj-${str(p.id)}`}>
        <div className="panel-heading"><span className="category">{str(p._clientName) || 'Client not linked'}</span><StatusBadge status={str(p.status)} /></div>
        <h2 id={`prj-${str(p.id)}`}>{str(p.title)}</h2>
        <div className="opportunity-meta"><span>Milestones<strong>{Number(p._milestonesComplete ?? 0)} / {Number(p._milestones ?? 0)}</strong></span><span>Deliverables accepted<strong>{Number(p._deliverablesAccepted ?? 0)} / {Number(p._deliverables ?? 0)}</strong></span><span>Planned end<strong>{str(p.plannedEndDate) || 'Not set'}</strong></span></div>
        <div className="card-buttons"><button className="button primary" onClick={() => onOpen(str(p.id))}>Open project</button></div>
      </section>)}</div>
    </ListGate>
    {list.state !== 'loading' && (list.items.length > 0 || filtered) && <ListFooter list={list} noun="projects" />}
  </>;
}

function StatusControl({ wf, project }: { wf: Workflow; project: Values }) {
  const from = str(project.status), options = PROJECT_TRANSITIONS[from] ?? [];
  const [to, setTo] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState('');
  const needsReason = to ? reasonRequired(from, to) : false;
  async function apply(e: React.FormEvent) { e.preventDefault(); setError(''); const r = await wf.action('project.transition', { id: project.id, version: project.version, to, reason }); if (r.ok) { setTo(''); setReason(''); } else setError(r.error); }
  if (!options.length) return null;
  return <form className="status-control" onSubmit={e => void apply(e)} aria-label="Change project status">
    <label className="field"><span>Move project to</span><select value={to} onChange={e => setTo(e.target.value)}><option value="">Choose status…</option>{options.map(o => <option key={o}>{o}</option>)}</select></label>
    {to && <label className="field wide"><span>Reason{needsReason ? ' *' : ' (optional)'}</span><textarea rows={2} required={needsReason} maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} /></label>}
    <button type="submit" className="button secondary" disabled={!to}>Apply status</button>
    <Alert message={error} /><p className="muted">Closed is reached through the closeout checklist; cancellation is recorded separately from completion.</p>
  </form>;
}

function RecordList({ wf, type, projectId, empty, render, refOptions = {}, title }: { wf: Workflow; type: string; projectId: string; empty: string; title: string; render: (r: Values) => ReactNode; refOptions?: Record<string, { id: string; label: string }[]> }) {
  const [dialog, setDialog] = useState<null | { record?: Values }>(null);
  const items = recs(wf, type).filter(r => r.projectId === projectId);
  return <>
    <div className="section-toolbar"><span /><button className="button primary" onClick={() => setDialog({})}><Plus size={14} />Add {SPECS[type].label.toLowerCase()}</button></div>
    {items.length ? <ul className="followup-list">{items.map(r => <li key={str(r.id)}><div>{render(r)}</div><div className="row-actions"><button className="button secondary" onClick={() => setDialog({ record: r })}>Edit</button></div></li>)}</ul> : <p className="muted empty-row">{empty}</p>}
    {dialog && <RecordDialog wf={wf} spec={SPECS[type]} record={dialog.record} fixed={dialog.record ? {} : { projectId }} hide={['projectId']} title={dialog.record ? `Edit ${SPECS[type].label.toLowerCase()}` : `Add ${SPECS[type].label.toLowerCase()}`} eyebrow={title.toUpperCase()} refOptions={refOptions}
      onClose={() => setDialog(null)} onSave={v => saver(dialog.record ? wf.updateRecord(type, dialog.record, v) : wf.createRecord(type, v))} />}
  </>;
}

export function ProjectView({ wf, projectId, onBack, onOpenPursuit, extraTabs = () => [] }: { wf: Workflow; projectId: string; onBack: () => void; onOpenPursuit: (opportunityId: string) => void; extraTabs?: (p: Values) => PursuitTab[] }) {
  const [editing, setEditing] = useState(false);
  const ctx = useRecordContext(wf, 'project', projectId);
  const project = recs(wf, 'project').find(p => p.id === projectId);
  if (!project || ctx.state === 'loading') {
    if (ctx.state === 'missing') return <section className="panel large-empty"><h2>Project not found.</h2><button className="button secondary" onClick={onBack}><ArrowLeft size={14} />All projects</button></section>;
    if (ctx.state === 'error') return <section className="panel large-empty"><Alert message={ctx.error} /><button className="button secondary" onClick={() => void ctx.retry()}><RefreshCw size={14} />Retry</button></section>;
    return <section className="panel large-empty" aria-busy="true"><p className="muted">Loading project…</p></section>;
  }
  const today = wf.data?.today ?? '';
  const pid = str(project.id), title = str(project.title);
  const milestones = recs(wf, 'milestone').filter(m => m.projectId === pid);
  const msOptions = (exclude?: unknown) => milestones.filter(m => m.id !== exclude).map(m => ({ id: str(m.id), label: str(m.title) }));
  const baselines = recs(wf, 'projectBaseline').filter(b => b.projectId === pid).sort((a, b) => Number(b.number) - Number(a.number));
  const version = recs(wf, 'proposalVersion').find(v => v.id === project.proposalVersionId);
  const org = recs(wf, 'organization').find(o => o.id === project.clientOrganizationId);
  return <div className="pursuit">
    <button className="text-button back-link" onClick={onBack}><ArrowLeft size={14} />All projects</button>
    <section className="panel pursuit-header"><div><span className="chip-row"><StatusBadge status={str(project.status)} />{project.statusReason ? <span className="muted">Reason: {str(project.statusReason)}</span> : null}</span><h2>{title}</h2>
      <p className="muted">{org ? str(org.name) : 'Client not linked'} · Start {str(project.startDate) || '—'} · Planned completion {str(project.plannedEndDate) || '—'}{project.actualEndDate ? ` · Completed ${str(project.actualEndDate)}` : ''}</p></div>
      <div className="row-actions"><button className="button secondary" onClick={() => onOpenPursuit(str(project.opportunityId))}>Open pursuit</button>{!['Closed', 'Cancelled'].includes(str(project.status)) && <button className="button secondary" onClick={() => setEditing(true)}>Edit details</button>}</div></section>
    <Tabs label="Project sections" tabs={[
      { id: 'overview', label: 'Overview', render: () => <section className="panel followup-section">
        <StatusControl key={str(project.version)} wf={wf} project={project} />
        <h3 className="section-label">Active baseline</h3><p className="inquiry-scope full">{str(project.scope)}</p>
        <h3 className="section-label">Baseline history</h3><ul className="followup-list">{baselines.map(b => <li key={str(b.id)}><div><strong>Baseline {str(b.number)}{b.id === project.activeBaselineId ? ' (active)' : ''}</strong><small>{str(b.source)} · planned completion {str(b.plannedEndDate) || '—'} · recorded {str(b.createdAt).slice(0, 10)}</small></div></li>)}</ul>
        <h3 className="section-label">Provenance</h3><p className="muted">Created from a confirmed award{version ? ` · approved proposal version ${str(version.number)}` : ''}. The original opportunity, proposal and versions remain accessible from the pursuit.</p>
        <h3 className="section-label">Project evidence</h3><EvidenceLinks wf={wf} subjectType="project" subjectId={pid} />
        {project.nextAction ? <p>Next action: {str(project.nextAction)} <DueChip due={(project.nextActionDue as string | null) ?? null} today={today} /></p> : null}
      </section> },
      { id: 'milestones', label: 'Milestones', render: () => <section className="panel followup-section"><RecordList wf={wf} type="milestone" projectId={pid} title={title} empty="Plan milestones with owners, dates, dependencies and completion criteria." refOptions={{ milestone: msOptions() }}
        render={m => <><strong>{str(m.title)}</strong><small>{str(m.owner) || 'No owner'} · planned {str(m.plannedDate) || '—'}{m.actualDate ? ` · completed ${str(m.actualDate)}` : ''}{(m.dependsOn as string[]).length ? ` · depends on ${(m.dependsOn as string[]).map(id => str(milestones.find(x => x.id === id)?.title)).join(', ')}` : ''}</small>
          <span className="chip-row"><StatusBadge status={str(m.status)} />{m.status !== 'Complete' ? <DueChip due={(m.plannedDate as string | null) ?? null} today={today} /> : null}</span>{m.completionCriteria ? <small>Done when: {str(m.completionCriteria)}</small> : null}</>} /></section> },
      { id: 'deliverables', label: 'Deliverables', render: () => <section className="panel followup-section"><DeliverablesPanel wf={wf} project={project} /></section> },
      { id: 'log', label: 'Risks & issues', render: () => <section className="panel followup-section"><RecordList wf={wf} type="projectLog" projectId={pid} title={title} empty="Track risks, issues, decisions and actions."
        render={l => <><strong>{str(l.kind)}: {str(l.title)}</strong><small>{str(l.owner) || 'No owner'} · severity {str(l.severity)}</small><span className="chip-row"><StatusBadge status={str(l.status)} />{['Open', 'Monitoring'].includes(str(l.status)) ? <DueChip due={(l.dueDate as string | null) ?? null} today={today} /> : null}</span>{l.resolution ? <small>Resolution: {str(l.resolution)}</small> : null}</>} /></section> },
      ...extraTabs(project),
    ]} />
    {editing && <RecordDialog wf={wf} spec={SPECS.project} record={project} title="Edit project details" onClose={() => setEditing(false)} onSave={v => saver(wf.updateRecord('project', project, v))} />}
  </div>;
}
