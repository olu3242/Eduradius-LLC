'use client';
// Deliverable review/acceptance, change control, closeout, experience records and reports.
import { useMemo, useState } from 'react';
import { AlertTriangle, Award, BarChart3, CheckCircle2, Circle, Plus } from 'lucide-react';
import { SPECS, ACCEPTANCE_KINDS, closeoutChecklist, evidenceState, type Values } from '../../lib/records';
import { operationalReport } from '../../lib/reports';
import { Alert, DueChip, StatusBadge, type Workflow } from './workflow';
import { EvidenceChip, EvidenceLinks, RecordDialog, recs, saver, type PursuitTab } from './records-ui';
import { Dialog, ReasonDialog } from './pursuit-ui';

const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const evidenceOptions = (wf: Workflow) => recs(wf, 'evidence').filter(e => !['Rejected', 'Superseded'].includes(str(e.reviewStatus)));

// ── Deliverables: review and acceptance ─────────────────────────────────────

export function DeliverablesPanel({ wf, project }: { wf: Workflow; project: Values }) {
  const [dialog, setDialog] = useState<null | { edit?: Values; create?: true } | { accept: Values } | { changes: Values } | { history: Values }>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pid = str(project.id), today = wf.data?.today ?? '';
  const items = recs(wf, 'deliverable').filter(d => d.projectId === pid);
  const versions = recs(wf, 'deliverableVersion');
  const milestones = recs(wf, 'milestone').filter(m => m.projectId === pid).map(m => ({ id: str(m.id), label: str(m.title) }));
  const locked = ['Closed', 'Cancelled'].includes(str(project.status));
  async function submit(d: Values) { setError(''); setNotice(''); const r = await wf.action('deliverable.submitForReview', { id: d.id, version: d.version }); if (r.ok) setNotice(`“${str(d.title)}” is ready for review. A version was preserved; nothing was sent externally.`); else setError(r.error); }
  return <>
    <div className="notice"><span>Deliverables are reviewed here; nothing is sent to the client. Internal approval is recorded separately from client acceptance, which requires the accepting person’s authority and verified acceptance evidence.</span></div>
    <div aria-live="polite">{notice && <p className="success-line"><CheckCircle2 size={13} />{notice}</p>}</div><Alert message={error} />
    {!locked && <div className="section-toolbar"><span /><button className="button primary" onClick={() => setDialog({ create: true })}><Plus size={14} />Add deliverable</button></div>}
    {items.length ? <ul className="followup-list">{items.map(d => {
      const accepted = versions.find(v => v.id === d.acceptedVersionId), latest = versions.find(v => v.id === d.latestVersionId);
      return <li key={str(d.id)}><div>
        <strong>{str(d.title)}</strong>
        <small>{str(d.owner) || 'No owner'} · due {str(d.dueDate) || '—'} · {d.required ? 'Required for closeout' : 'Optional'}</small>
        <span className="chip-row"><StatusBadge status={str(d.status)} />{d.status !== 'Accepted' ? <DueChip due={(d.dueDate as string | null) ?? null} today={today} /> : null}</span>
        {accepted ? <small>Accepted version {str(accepted.number)} — {str(accepted.acceptanceKind)}{accepted.acceptanceKind === 'Client acceptance' ? ` by ${str(accepted.acceptanceAuthority)}` : ''}</small> : null}
        {d.status === 'Changes requested' && latest?.reviewNotes ? <small>Requested revision: {str(latest.reviewNotes)}</small> : null}
        {d.draftSummary ? <small>Current draft: {str(d.draftSummary)}</small> : null}
        <EvidenceLinks wf={wf} subjectType="deliverable" subjectId={str(d.id)} />
      </div><div className="row-actions">
        {!locked && ['Draft', 'Changes requested'].includes(str(d.status)) && <button className="button primary" onClick={() => void submit(d)}>Submit for review</button>}
        {!locked && d.status === 'Ready for review' && <><button className="button primary" onClick={() => setDialog({ accept: d })}>Record acceptance</button><button className="button secondary" onClick={() => setDialog({ changes: d })}>Request revision</button></>}
        {!locked && d.status !== 'Ready for review' && <button className="button secondary" onClick={() => setDialog({ edit: d })}>{d.status === 'Accepted' ? 'Revise' : 'Edit'}</button>}
        {versions.some(v => v.deliverableId === d.id) && <button className="text-button" onClick={() => setDialog({ history: d })}>Versions</button>}
      </div></li>; })}</ul> : <p className="muted empty-row">No deliverables yet.</p>}
    {dialog && 'create' in dialog && <RecordDialog spec={SPECS.deliverable} fixed={{ projectId: pid }} hide={['projectId']} title="Add deliverable" refOptions={{ milestone: milestones }} onClose={() => setDialog(null)} onSave={v => saver(wf.createRecord('deliverable', v))} />}
    {dialog && 'edit' in dialog && dialog.edit && <RecordDialog spec={SPECS.deliverable} record={dialog.edit} title={dialog.edit.status === 'Accepted' ? 'Revise accepted deliverable' : 'Edit deliverable'} refOptions={{ milestone: milestones }} onClose={() => setDialog(null)} onSave={v => saver(wf.updateRecord('deliverable', dialog.edit!, v))}>
      {dialog.edit.status === 'Accepted' && <p className="muted">Changing the content starts a new draft that needs review. The accepted version stays on record.</p>}</RecordDialog>}
    {dialog && 'changes' in dialog && <ReasonDialog title="Request revision" label="What needs to change? *" onClose={() => setDialog(null)} onSubmit={async notes => { const r = await wf.action('deliverable.requestChanges', { id: dialog.changes.id, version: dialog.changes.version, notes }); if (!r.ok) setError(r.error); else setNotice('Revision requested; the submitted version is preserved.'); return r.ok; }} />}
    {dialog && 'accept' in dialog && <AcceptDialog wf={wf} deliverable={dialog.accept} onClose={() => setDialog(null)} onDone={m => setNotice(m)} />}
    {dialog && 'history' in dialog && <Dialog title={`Versions · ${str(dialog.history.title)}`} eyebrow="PRESERVED VERSIONS" onClose={() => setDialog(null)}>
      <ul className="followup-list">{versions.filter(v => v.deliverableId === dialog.history.id).sort((a, b) => Number(b.number) - Number(a.number)).map(v => <li key={str(v.id)}><div><strong>Version {str(v.number)}</strong><small>Submitted {str(v.submittedAt).slice(0, 16).replace('T', ' ')}{v.reviewedAt ? ` · reviewed ${str(v.reviewedAt).slice(0, 16).replace('T', ' ')}` : ''}</small><span className="chip-row"><StatusBadge status={str(v.status)} /></span><small>{str(v.summary)}</small>{v.reviewNotes ? <small>Notes: {str(v.reviewNotes)}</small> : null}{v.acceptanceKind ? <small>{str(v.acceptanceKind)}: {str(v.acceptanceAuthority)}</small> : null}</div></li>)}</ul></Dialog>}
  </>;
}

function AcceptDialog({ wf, deliverable, onClose, onDone }: { wf: Workflow; deliverable: Values; onClose: () => void; onDone: (m: string) => void }) {
  const [form, setForm] = useState({ acceptanceKind: ACCEPTANCE_KINDS[0] as string, acceptanceAuthority: '', acceptanceEvidenceId: '', notes: '' });
  const [error, setError] = useState('');
  const today = wf.data?.today ?? '', client = form.acceptanceKind === 'Client acceptance';
  const options = recs(wf, 'evidence').filter(e => evidenceState(e, today) === 'current');
  async function submit(e: React.FormEvent) { e.preventDefault(); const r = await wf.action('deliverable.accept', { id: deliverable.id, version: deliverable.version, ...form, acceptanceEvidenceId: form.acceptanceEvidenceId || null }); if (r.ok) { onDone(client ? 'Client acceptance recorded with verified evidence.' : 'Internal approval recorded. This is not client acceptance.'); onClose(); } else setError(r.error); }
  return <Dialog title="Record acceptance" eyebrow={str(deliverable.title).toUpperCase()} onClose={onClose}><form onSubmit={e => void submit(e)}>
    <fieldset className="refs-field"><legend>Type of acceptance</legend>{ACCEPTANCE_KINDS.map(k => <label key={k} className="inline-check"><input type="radio" name="kind" checked={form.acceptanceKind === k} onChange={() => setForm({ ...form, acceptanceKind: k })} />{k === 'Internal approval' ? 'Internal approval (workspace owner) — not client acceptance' : 'Client acceptance — with the client’s written acceptance'}</label>)}</fieldset>
    {client && <div className="form-grid">
      <label className="field wide"><span>Accepted by (name and role) *</span><input required maxLength={200} value={form.acceptanceAuthority} onChange={e => setForm({ ...form, acceptanceAuthority: e.target.value })} /></label>
      <label className="field wide"><span>Acceptance evidence (verified) *</span><select required value={form.acceptanceEvidenceId} onChange={e => setForm({ ...form, acceptanceEvidenceId: e.target.value })}><option value="">Choose verified evidence…</option>{options.map(e => <option key={str(e.id)} value={str(e.id)}>{str(e.title)}</option>)}</select></label></div>}
    <label className="field wide"><span>Notes</span><textarea rows={2} maxLength={4000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
    <Alert message={error} />
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Record acceptance</button></div></form></Dialog>;
}

// ── Change control ──────────────────────────────────────────────────────────

export function ChangesPanel({ wf, project }: { wf: Workflow; project: Values }) {
  const [dialog, setDialog] = useState<null | { create: true } | { edit: Values } | { decide: Values }>(null);
  const pid = str(project.id), locked = ['Closed', 'Cancelled'].includes(str(project.status));
  const items = recs(wf, 'changeRequest').filter(c => c.projectId === pid);
  return <>
    <div className="notice"><span>Recording a decision here does not create, sign or modify any legally binding agreement; reference the supporting agreement separately. Only an approved change updates the active baseline; earlier baselines are kept.</span></div>
    {!locked && <div className="section-toolbar"><span /><button className="button primary" onClick={() => setDialog({ create: true })}><Plus size={14} />Propose change</button></div>}
    {items.length ? <ul className="followup-list">{items.map(c => <li key={str(c.id)}><div>
      <strong>{str(c.title)}</strong><small>{str(c.requestedChange)}</small><small>Reason: {str(c.reason)}</small>
      <small>Scope: {str(c.scopeImpact) || '—'} · Schedule: {str(c.scheduleImpact) || '—'}{c.newPlannedEndDate ? ` (new planned completion ${str(c.newPlannedEndDate)})` : ''} · Cost (narrative): {str(c.costImpact) || '—'}</small>
      <span className="chip-row"><StatusBadge status={str(c.status)} />{c.agreementReference ? <span className="muted">Agreement: {str(c.agreementReference)}</span> : null}</span>
      {c.decisionReason ? <small>Decision rationale: {str(c.decisionReason)}</small> : null}
    </div><div className="row-actions">{c.status === 'Proposed' && !locked && <><button className="button primary" onClick={() => setDialog({ decide: c })}>Record decision</button><button className="button secondary" onClick={() => setDialog({ edit: c })}>Edit</button></>}</div></li>)}</ul> : <p className="muted empty-row">No change requests.</p>}
    {dialog && 'create' in dialog && <RecordDialog spec={SPECS.changeRequest} fixed={{ projectId: pid }} hide={['projectId']} title="Propose a change" onClose={() => setDialog(null)} onSave={v => saver(wf.createRecord('changeRequest', v))} />}
    {dialog && 'edit' in dialog && <RecordDialog spec={SPECS.changeRequest} record={dialog.edit} title="Edit change request" onClose={() => setDialog(null)} onSave={v => saver(wf.updateRecord('changeRequest', dialog.edit, v))} />}
    {dialog && 'decide' in dialog && <DecideDialog wf={wf} change={dialog.decide} onClose={() => setDialog(null)} />}
  </>;
}

function DecideDialog({ wf, change, onClose }: { wf: Workflow; change: Values; onClose: () => void }) {
  const [decision, setDecision] = useState('Approved'), [reason, setReason] = useState(''), [error, setError] = useState('');
  async function submit(e: React.FormEvent) { e.preventDefault(); const r = await wf.action('changeRequest.decide', { id: change.id, version: change.version, decision, reason }); if (r.ok) onClose(); else setError(r.error); }
  return <Dialog title="Record change decision" eyebrow={str(change.title).toUpperCase()} onClose={onClose}><form onSubmit={e => void submit(e)}>
    <fieldset className="refs-field"><legend>Decision</legend>{['Approved', 'Rejected', 'Withdrawn'].map(d => <label key={d} className="inline-check"><input type="radio" name="decision" checked={decision === d} onChange={() => setDecision(d)} />{d}{d === 'Approved' ? ' — creates a new active baseline' : ''}</label>)}</fieldset>
    <label className="field wide"><span>Decision rationale *</span><textarea required rows={3} maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    <p className="muted">This records your decision only; it does not create or modify an agreement.</p><Alert message={error} />
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Record decision</button></div></form></Dialog>;
}

// ── Closeout ────────────────────────────────────────────────────────────────

export function CloseoutPanel({ wf, project, onOpenExperience }: { wf: Workflow; project: Values; onOpenExperience: () => void }) {
  const [form, setForm] = useState({ finalAcceptanceEvidenceId: '', lessonsLearned: '', archiveReviewed: false, retentionNotes: '', actualEndDate: wf.data?.today ?? '', exceptionReason: '' });
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pid = str(project.id), today = wf.data?.today ?? '';
  const checklist = useMemo(() => closeoutChecklist(pid, wf.data?.records ?? {}, { ...form, finalAcceptanceEvidenceId: form.finalAcceptanceEvidenceId || null }, today), [pid, wf.data, form, today]);
  const failing = checklist.filter(c => !c.passed);
  const closeouts = recs(wf, 'closeout').filter(c => c.projectId === pid).sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
  const experience = recs(wf, 'experience').find(e => e.projectId === pid);
  async function close(e: React.FormEvent) { e.preventDefault(); setError(''); const r = await wf.action('project.closeout', { id: project.id, version: project.version, ...form, finalAcceptanceEvidenceId: form.finalAcceptanceEvidenceId || null, exceptionReason: failing.length ? form.exceptionReason : '' }); if (r.ok) setNotice('Project closed. The checklist was recorded with the closeout.'); else setError(r.error); }
  async function createExperience() { setError(''); const r = await wf.action('experience.createFromProject', { projectId: project.id }); if (r.ok) { setNotice('Private experience record created. Review it on the Experience page.'); onOpenExperience(); } else setError(r.error); }
  return <>
    <div aria-live="polite">{notice && <p className="success-line"><CheckCircle2 size={13} />{notice}</p>}</div><Alert message={error} />
    {project.status === 'Closing' ? <form onSubmit={e => void close(e)} className="closeout-form">
      <ul className="checklist" aria-label="Closeout checklist">{checklist.map(c => <li key={c.key} className={c.passed ? 'passed' : 'open'}>{c.passed ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}<span><strong>{c.label}</strong><small>{c.passed ? 'Done' : 'Open'} — {c.detail}</small></span></li>)}</ul>
      <div className="form-grid">
        <label className="field wide"><span>Final acceptance evidence</span><select value={form.finalAcceptanceEvidenceId} onChange={e => setForm({ ...form, finalAcceptanceEvidenceId: e.target.value })}><option value="">Choose evidence…</option>{evidenceOptions(wf).map(e => <option key={str(e.id)} value={str(e.id)}>{str(e.title)} · {str(e.reviewStatus)}</option>)}</select></label>
        <label className="field wide"><span>Lessons learned</span><textarea rows={3} maxLength={8000} value={form.lessonsLearned} onChange={e => setForm({ ...form, lessonsLearned: e.target.value })} /></label>
        <label className="field wide checkbox-field"><input type="checkbox" checked={form.archiveReviewed} onChange={e => setForm({ ...form, archiveReviewed: e.target.checked })} /><span>Archive and retention reviewed</span></label>
        <label className="field wide"><span>Retention notes</span><textarea rows={2} maxLength={4000} value={form.retentionNotes} onChange={e => setForm({ ...form, retentionNotes: e.target.value })} /></label>
        <label className="field"><span>Actual completion date</span><input type="date" value={form.actualEndDate} onChange={e => setForm({ ...form, actualEndDate: e.target.value })} /></label>
        {failing.length > 0 && <label className="field wide"><span>Owner exception reason (required to close with open items) *</span><textarea required rows={2} maxLength={4000} value={form.exceptionReason} onChange={e => setForm({ ...form, exceptionReason: e.target.value })} /></label>}
      </div>
      {failing.length > 0 && <p className="muted"><AlertTriangle size={13} aria-hidden="true" /> {failing.length} checklist item{failing.length === 1 ? ' is' : 's are'} open. Normal closeout is blocked; closing now records an owner exception.</p>}
      <div className="section-toolbar"><span /><button type="submit" className="button primary">{failing.length ? 'Close with recorded exception' : 'Complete closeout'}</button></div>
    </form> : <p className="muted">{project.status === 'Closed' ? 'This project is closed.' : project.status === 'Cancelled' ? 'This project was cancelled. Cancellation is recorded separately from successful completion.' : 'Move the project to Closing (Overview tab) to start the closeout checklist.'}</p>}
    {closeouts.length > 0 && <><h3 className="section-label">Closeout records</h3><ul className="followup-list">{closeouts.map(c => <li key={str(c.id)}><div><strong>Closed {str(c.createdAt).slice(0, 10)}</strong><small>{c.exceptionReason ? `Owner exception: ${str(c.exceptionReason)}` : 'All checklist items complete'}</small>{c.lessonsLearned ? <small>Lessons: {str(c.lessonsLearned)}</small> : null}</div></li>)}</ul></>}
    {project.status === 'Closed' && (experience ? <p className="muted">Experience record exists ({str(experience.publicationStatus)}). <button className="text-button" onClick={onOpenExperience}>Open experience records</button></p>
      : <div className="section-toolbar"><span className="muted">Capture what was actually delivered as a private, owner-reviewed experience record.</span><button className="button primary" onClick={() => void createExperience()}><Award size={14} />Create private experience record</button></div>)}
  </>;
}

export const deliveryTabs = (wf: Workflow, onOpenExperience: () => void) => (p: Values): PursuitTab[] => [
  { id: 'changes', label: 'Changes', render: () => <section className="panel followup-section"><ChangesPanel wf={wf} project={p} /></section> },
  { id: 'closeout', label: 'Closeout', render: () => <section className="panel followup-section"><CloseoutPanel key={str(p.version)} wf={wf} project={p} onOpenExperience={onOpenExperience} /></section> },
];

// ── Experience records ──────────────────────────────────────────────────────

export function ExperienceView({ wf }: { wf: Workflow }) {
  const [dialog, setDialog] = useState<null | { edit: Values } | { withdraw: Values }>(null);
  const [error, setError] = useState('');
  if (wf.state !== 'ready') return <section className="panel large-empty" aria-busy="true"><p className="muted">Loading experience records…</p></section>;
  const items = recs(wf, 'experience'), today = wf.data!.today;
  async function review(e: Values, to: string) { setError(''); const r = await wf.action('experience.review', { id: e.id, version: e.version, to }); if (!r.ok) setError(r.error); }
  return <>
    <div className="notice"><Award size={16} aria-hidden="true" /><span>Experience records are private by default and come only from completed projects. Owner approval allows use in your capability statement draft; nothing is published to the website. Never add endorsements, ratings, savings, revenue, contract values, certifications or government past performance that are not evidenced.</span></div>
    <Alert message={error} />
    {!items.length ? <section className="panel large-empty"><Award size={28} /><h2>No experience records yet.</h2><p>Close a project as completed, then create a private record from its Closeout tab.</p></section>
      : <ul className="followup-list panel followup-section">{items.map(e => {
        const prov = (e.provenance ?? {}) as Values, delivered = (e.verifiedDeliverables as Values[]) ?? [];
        const permission = recs(wf, 'evidence').find(x => x.id === e.permissionEvidenceId);
        return <li key={str(e.id)}><div>
          <strong>{str(e.title)}</strong><small>{str(e.clientLabel) || 'Client description not set'} · {str(e.startDate) || '—'} to {str(e.endDate) || '—'}</small>
          <span className="chip-row"><StatusBadge status={str(e.publicationStatus)} />{permission ? <EvidenceChip evidence={permission} today={today} /> : null}</span>
          <small>Verified deliverables: {delivered.length ? delivered.map(d => `${str(d.title)} (${str(d.acceptanceKind)})`).join('; ') : 'none'}</small>
          {e.outcomes ? <small>Measured outcomes: {str(e.outcomes)}</small> : <small>No measured outcomes recorded.</small>}
          {prov.approvedAt ? <small>Provenance: approved {str(prov.approvedAt).slice(0, 10)} by owner review · project, award, accepted deliverables and {(prov.outcomeEvidenceIds as string[] | undefined)?.length ?? 0} outcome evidence records on file.</small> : null}
          <EvidenceLinks wf={wf} subjectType="experience" subjectId={str(e.id)} label="Outcome evidence" />
        </div><div className="row-actions">
          <button className="button secondary" onClick={() => setDialog({ edit: e })}>Edit</button>
          {e.publicationStatus === 'Private' && <button className="button primary" onClick={() => void review(e, 'Ready for owner review')}>Send for owner review</button>}
          {e.publicationStatus === 'Ready for owner review' && <><button className="button primary" onClick={() => void review(e, 'Approved for capability statement')}>Approve for capability statement</button><button className="text-button" onClick={() => void review(e, 'Private')}>Return to private</button></>}
          {e.publicationStatus === 'Approved for capability statement' && <button className="button secondary" onClick={() => setDialog({ withdraw: e })}>Withdraw approval</button>}
          {e.publicationStatus === 'Withdrawn' && <button className="text-button" onClick={() => void review(e, 'Private')}>Return to private</button>}
        </div></li>; })}</ul>}
    {dialog && 'edit' in dialog && <RecordDialog spec={SPECS.experience} record={dialog.edit} title="Edit experience record" eyebrow="PRIVATE BY DEFAULT" refOptions={{ evidence: evidenceOptions(wf).map(x => ({ id: str(x.id), label: str(x.title) })) }} onClose={() => setDialog(null)} onSave={v => saver(wf.updateRecord('experience', dialog.edit, v))}>
      {dialog.edit.publicationStatus === 'Approved for capability statement' && <p className="muted">Editing an approved record returns it to private until it is reviewed again.</p>}</RecordDialog>}
    {dialog && 'withdraw' in dialog && <ReasonDialog title="Withdraw approval" label="Why is the approval withdrawn? *" onClose={() => setDialog(null)} onSubmit={async reason => { const r = await wf.action('experience.review', { id: dialog.withdraw.id, version: dialog.withdraw.version, to: 'Withdrawn', reason }); if (!r.ok) setError(r.error); return r.ok; }} />}
  </>;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export function ReportsView({ wf }: { wf: Workflow }) {
  if (wf.state !== 'ready' || !wf.data) return <section className="panel large-empty" aria-busy="true"><p className="muted">Loading reports…</p></section>;
  const metrics = operationalReport({ opportunities: wf.data.opportunities, records: wf.data.records ?? {}, evidenceLinks: wf.data.evidenceLinks ?? [] }, wf.data.today);
  return <>
    <div className="notice"><BarChart3 size={16} aria-hidden="true" /><span>Operational tracking only — not accounting, invoicing or financial reporting. Dates use Central Time ({wf.data.businessTimeZone}); today is {wf.data.today}. “No records yet” means the source is empty, which is different from zero.</span></div>
    <div className="report-grid">{metrics.map(m => <section className="panel followup-section" key={m.key} aria-labelledby={`rep-${m.key}`}>
      <div className="panel-heading"><h2 id={`rep-${m.key}`}>{m.label}</h2><span className="report-count">{m.noData ? 'No records yet' : m.items.length}</span></div>
      <p className="muted">{m.definition} <span className="report-source">Source: {m.source}.</span></p>
      {m.unavailable > 0 && <p className="field-hint">{m.unavailable} record{m.unavailable === 1 ? '' : 's'} could not be evaluated (missing date) and are not counted.</p>}
      {m.items.length > 0 && <ul className="followup-list">{m.items.slice(0, 8).map(i => <li key={i.kind + i.id}><div><strong>{i.title}</strong><small>{i.detail}</small>{i.due ? <DueChip due={i.due} today={wf.data!.today} /> : null}</div></li>)}</ul>}
      {m.items.length > 8 && <p className="muted">and {m.items.length - 8} more</p>}
    </section>)}</div>
  </>;
}
