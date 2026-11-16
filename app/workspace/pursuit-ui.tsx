'use client';
// Pursuit tabs: teaming partners, proposal workspace (owner review), submission & award records.
import { useId, useState } from 'react';
import { CheckCircle2, Download, FileText, Plus, Send, X } from 'lucide-react';
import { SPECS, PROPOSAL_SECTIONS, SECTION_BASIS, SUBMISSION_METHODS, SUBMISSION_OUTCOMES, proposalDocument, evidenceState, type Sections, type Values } from '../../lib/records';
import type { OpportunityRecord } from '../../lib/workflow';
import { Alert, DueChip, StatusBadge, useDialog, type Workflow } from './workflow';
import { EvidenceChip, EvidenceLinks, RecordDialog, recs, saver, type PursuitTab } from './records-ui';

const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const escapeHtml = (t: string) => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function download(name: string, data: string, type: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'proposal';

function Dialog({ title, eyebrow, onClose, children }: { title: string; eyebrow?: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useDialog(onClose); const id = useId();
  return <div className="modal-backdrop" onClick={onClose}><section ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={id} onClick={e => e.stopPropagation()}>
    <div className="modal-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={id}>{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></div>{children}</section></div>;
}
export { Dialog };

// ── Teaming ─────────────────────────────────────────────────────────────────

export function TeamingPanel({ wf, opportunity }: { wf: Workflow; opportunity: OpportunityRecord }) {
  const [dialog, setDialog] = useState<null | { record?: Values }>(null);
  const today = wf.data?.today ?? '';
  const orgs = recs(wf, 'organization').filter(o => o.status === 'Active');
  const partners = recs(wf, 'teamingPartner').filter(t => t.opportunityId === opportunity.id);
  const orgName = (id: unknown) => str(recs(wf, 'organization').find(o => o.id === id)?.name) || 'Unknown organization';
  const contacts = recs(wf, 'contact').filter(c => c.status === 'Active').map(c => ({ id: str(c.id), label: `${str(c.name)} — ${orgName(c.organizationId)}` }));
  return <>
    <div className="notice"><span>Partners listed here are proposed. Participation is confirmed only when an agreement is signed and its reference is recorded. Nothing is sent to partners from this workspace.</span></div>
    <div className="section-toolbar"><span className="muted">{orgs.length ? '' : 'Add partner organizations on the Organizations page first.'}</span><button className="button primary" disabled={!orgs.length} onClick={() => setDialog({})}><Plus size={14} />Add partner</button></div>
    {partners.length ? <ul className="followup-list">{partners.map(t => <li key={str(t.id)}><div>
      <strong>{orgName(t.organizationId)} · {str(t.proposedRole)}</strong>
      <small>{t.discussionStatus === 'Agreement signed' ? `Agreement signed — ${str(t.agreementReference)}` : 'Proposed — participation not confirmed'}{t.relationshipOwner ? ` · Owner: ${str(t.relationshipOwner)}` : ''}</small>
      <span className="chip-row"><StatusBadge status={str(t.discussionStatus)} /><DueChip due={(t.nextActionDue as string | null) ?? null} today={today} /></span>
      {t.workPackage ? <small>Work package: {str(t.workPackage)}</small> : null}{t.capabilityFit ? <small>Capability fit: {str(t.capabilityFit)}</small> : null}{t.nextAction ? <small>Next action: {str(t.nextAction)}</small> : null}
    </div><div className="row-actions"><button className="button secondary" onClick={() => setDialog({ record: t })}>Edit</button></div></li>)}</ul> : <p className="muted empty-row">No teaming partners proposed for this opportunity.</p>}
    {dialog && <RecordDialog spec={SPECS.teamingPartner} record={dialog.record} fixed={dialog.record ? {} : { opportunityId: opportunity.id }} hide={['opportunityId']} title={dialog.record ? 'Edit teaming partner' : 'Propose a teaming partner'} eyebrow={opportunity.title.toUpperCase()}
      refOptions={{ organization: orgs.map(o => ({ id: str(o.id), label: str(o.name) })), contact: contacts }} onClose={() => setDialog(null)}
      onSave={v => saver(dialog.record ? wf.updateRecord('teamingPartner', dialog.record, v) : wf.createRecord('teamingPartner', v))} />}
  </>;
}

// ── Proposal workspace ──────────────────────────────────────────────────────

const STATUS_NOTE: Record<string, string> = {
  Draft: 'Draft — edit the sections, then send the proposal for owner review.',
  'Internal review': 'In owner review. Approve this exact version or request changes. The content is locked meanwhile.',
  'Changes requested': 'Changes requested in owner review. Edit the sections and send them for review again.',
  Approved: 'Approved in owner review (single-owner workspace; not an independent second review). Editing creates a new draft that needs review; the approved version is preserved.',
  Submitted: 'Submitted. The workspace keeps the exact approved version that was recorded as submitted.',
};

export function ProposalPanel({ wf, opportunity }: { wf: Workflow; opportunity: OpportunityRecord }) {
  const proposals = recs(wf, 'proposal').filter(p => p.opportunityId === opportunity.id);
  const [selected, setSelected] = useState<string>(''), [creating, setCreating] = useState(false);
  const current = proposals.find(p => p.id === selected) ?? proposals[proposals.length - 1];
  return <>
    {proposals.length > 1 && <label className="field"><span>Proposal</span><select value={str(current?.id)} onChange={e => setSelected(e.target.value)}>{proposals.map(p => <option key={str(p.id)} value={str(p.id)}>{str(p.title)} · {str(p.status)}</option>)}</select></label>}
    {current ? <ProposalEditor key={`${str(current.id)}:${str(current.version)}`} wf={wf} opportunity={opportunity} proposal={current} /> : <section className="large-empty"><FileText size={28} /><h2>No proposal yet.</h2><p>Start from a blank outline or a saved template. A template only fills a new proposal; existing proposals are never overwritten.</p></section>}
    <div className="section-toolbar"><span /><button className="button secondary" onClick={() => setCreating(true)}><Plus size={14} />New proposal</button></div>
    {creating && <CreateProposal wf={wf} opportunity={opportunity} onClose={() => setCreating(false)} onCreated={id => { setSelected(id); setCreating(false); }} />}
  </>;
}

function CreateProposal({ wf, opportunity, onClose, onCreated }: { wf: Workflow; opportunity: OpportunityRecord; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState(`${opportunity.title} — proposal`), [templateId, setTemplateId] = useState(''), [error, setError] = useState('');
  const templates = recs(wf, 'proposalTemplate');
  async function submit(e: React.FormEvent) { e.preventDefault(); const r = await wf.action<{ record: Values }>('proposal.create', { opportunityId: opportunity.id, title, templateId: templateId || null }); if (r.ok) onCreated(str(r.data.record.id)); else setError(r.error); }
  return <Dialog title="New proposal" eyebrow={opportunity.title.toUpperCase()} onClose={onClose}><form onSubmit={e => void submit(e)}>
    <div className="form-grid"><label className="field wide"><span>Proposal title *</span><input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className="field wide"><span>Start from</span><select value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">Blank outline (all sections)</option>{templates.map(t => <option key={str(t.id)} value={str(t.id)}>Template: {str(t.name)}</option>)}</select></label></div>
    <Alert message={error} /><div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Create proposal</button></div></form></Dialog>;
}

function ProposalEditor({ wf, opportunity, proposal }: { wf: Workflow; opportunity: OpportunityRecord; proposal: Values }) {
  const [sections, setSections] = useState<Sections>(() => structuredClone(proposal.sections as Sections));
  const [title, setTitle] = useState(str(proposal.title));
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | 'changes' | 'submit' | 'template' | { view: Values }>(null);
  const status = str(proposal.status), locked = status === 'Internal review' || status === 'Submitted';
  const dirty = title !== proposal.title || JSON.stringify(sections) !== JSON.stringify(proposal.sections);
  const evidence = recs(wf, 'evidence'), today = wf.data?.today ?? '';
  const versions = recs(wf, 'proposalVersion').filter(v => v.proposalId === proposal.id).sort((a, b) => Number(b.number) - Number(a.number));
  const latest = versions.find(v => v.id === proposal.latestVersionId), approved = versions.find(v => v.id === proposal.approvedVersionId);
  const org = recs(wf, 'organization').find(o => o.id === opportunity.organizationId);
  const setSection = (key: string, patch: Partial<Sections[string]>) => setSections(s => ({ ...s, [key]: { ...s[key], ...patch } }));
  async function run(name: string, body: Values, done: string) {
    setBusy(true); setError(''); setNotice('');
    const r = await wf.action(name, { id: proposal.id, version: proposal.version, ...body });
    setBusy(false);
    if (r.ok) { setNotice(done); setDialog(null); } else setError(r.status === 409 && !r.error.includes('version') ? r.error : r.error);
    return r.ok;
  }
  async function save() {
    setBusy(true); setError(''); setNotice('');
    const r = await wf.updateRecord('proposal', proposal, { title, sections });
    setBusy(false);
    if (r.ok) setNotice(status === 'Approved' ? 'Saved as a new draft. The approved version is preserved and a new owner review is required.' : 'Proposal saved.'); else setError(r.error);
  }
  function exportDoc(kind: 'md' | 'html', source: 'draft' | Values) {
    const content = source === 'draft' ? { sections, version: null } : { sections: source.sections as Sections, version: { number: Number(source.number), status: str(source.status), reviewedAt: str(source.reviewedAt) } };
    const md = proposalDocument({ title, opportunityTitle: opportunity.title, organization: str(org?.name), ...content, evidenceTitles: Object.fromEntries(evidence.map(e => [str(e.id), str(e.title)])) });
    const name = `${slug(title)}-${source === 'draft' ? 'draft' : 'v' + str(source.number)}`;
    if (kind === 'md') { download(name + '.md', md, 'text/markdown'); return; }
    const html = md.split('\n').map(line => line.startsWith('# ') ? `<h1>${escapeHtml(line.slice(2))}</h1>` : line.startsWith('## ') ? `<h2>${escapeHtml(line.slice(3))}</h2>` : line.startsWith('> ') ? `<p class="banner">${escapeHtml(line.slice(2)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>` : line === '---' ? '<hr>' : line ? `<p>${escapeHtml(line).replace(/^_(.+)_$/, '<em>$1</em>')}</p>` : '').join('\n');
    download(name + '.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 20px;color:#253c37;line-height:1.6}h1{color:#245e4b}h2{color:#245e4b;border-bottom:1px solid #e7ebe8;padding-bottom:4px}.banner{background:#f4f1e5;padding:10px 14px;border-radius:6px}</style></head><body>${html}</body></html>`, 'text/html');
  }
  return <section className="proposal-editor" aria-label="Proposal">
    <div className="pursuit-header panel"><div><span className="chip-row"><StatusBadge status={status} />{latest ? <span className="muted">Latest version {str(latest.number)}</span> : <span className="muted">No versions yet</span>}{approved ? <span className="muted">· Approved version {str(approved.number)}</span> : null}</span>
      <p className="muted">{STATUS_NOTE[status]}</p>{status === 'Changes requested' && latest?.reviewReason ? <p><strong>Requested changes:</strong> {str(latest.reviewReason)}</p> : null}</div></div>
    <div aria-live="polite">{notice && <p className="success-line"><CheckCircle2 size={13} />{notice}</p>}</div>
    <Alert message={error} />
    <div className="card-buttons proposal-actions">
      {(status === 'Draft' || status === 'Changes requested') && <button className="button primary" disabled={busy || dirty} title={dirty ? 'Save your edits first' : undefined} onClick={() => void run('proposal.submitForReview', {}, 'Sent for owner review. A version snapshot was created.')}><Send size={14} />Send for owner review</button>}
      {status === 'Internal review' && <><button className="button primary" disabled={busy} onClick={() => void run('proposal.approve', {}, 'Approved in owner review. This exact version is preserved.')}>Approve (owner review)</button><button className="button secondary" disabled={busy} onClick={() => setDialog('changes')}>Request changes</button></>}
      {status === 'Approved' && proposal.approvedVersionId === proposal.latestVersionId && <button className="button primary" disabled={busy} onClick={() => setDialog('submit')}>Record submission</button>}
      <button className="button secondary" onClick={() => exportDoc('md', 'draft')}><Download size={14} />Export draft (.md)</button>
      {approved && <button className="button secondary" onClick={() => exportDoc('html', approved)}><Download size={14} />Export approved v{str(approved.number)} (.html)</button>}
      <button className="text-button" onClick={() => setDialog('template')}>Save as template</button>
    </div>
    <label className="field wide"><span>Proposal title</span><input value={title} disabled={locked} maxLength={200} onChange={e => setTitle(e.target.value)} /></label>
    {PROPOSAL_SECTIONS.map(({ key, label }) => { const sec = sections[key] ?? { body: '', basis: SECTION_BASIS[0], refs: [] }; return <fieldset className="proposal-section" key={key} disabled={locked}>
      <legend>{label}</legend>
      <label className="field wide"><span className="sr-only">{label} text</span><textarea rows={key === 'executiveSummary' || key === 'approach' ? 5 : 3} maxLength={20000} value={sec.body} onChange={e => setSection(key, { body: e.target.value })} /></label>
      <label className="field"><span>Basis for {label.toLowerCase()}</span><select value={sec.basis} onChange={e => setSection(key, { basis: e.target.value })}>{SECTION_BASIS.map(b => <option key={b}>{b}</option>)}</select></label>
      {sec.basis === SECTION_BASIS[2] && <div className="field wide"><span>Supporting evidence for {label.toLowerCase()}</span><div className="evidence-picker">{evidence.length ? evidence.map(e => <label key={str(e.id)} className="inline-check"><input type="checkbox" checked={sec.refs.includes(str(e.id))} onChange={ev => setSection(key, { refs: ev.target.checked ? [...sec.refs, str(e.id)] : sec.refs.filter(r => r !== e.id) })} />{str(e.title)} <EvidenceChip evidence={e} today={today} /></label>) : <span className="muted">Add evidence in the register first.</span>}</div>
        {sec.refs.some(r => { const e = evidence.find(x => x.id === r); return !e || evidenceState(e, today) !== 'current'; }) && <small className="field-hint">Approval requires verified, unexpired evidence for verified sections.</small>}</div>}
    </fieldset>; })}
    {!locked && <div className="section-toolbar"><span className="muted" aria-live="polite">{dirty ? 'Unsaved changes' : 'All changes saved'}</span><button className="button primary" disabled={busy || !dirty} onClick={() => void save()}>Save proposal</button></div>}
    <h3 className="section-label">Proposal evidence</h3><EvidenceLinks wf={wf} subjectType="proposal" subjectId={str(proposal.id)} />
    <h3 className="section-label">Version history</h3>
    {versions.length ? <ul className="followup-list">{versions.map(v => <li key={str(v.id)}><div><strong>Version {str(v.number)}</strong><small>Sent {str(v.submittedAt).slice(0, 16).replace('T', ' ')}{v.reviewedAt ? ` · Reviewed ${str(v.reviewedAt).slice(0, 16).replace('T', ' ')} by ${str(v.reviewedBy)}` : ''}</small>{v.reviewReason ? <small>Notes: {str(v.reviewReason)}</small> : null}<span className="chip-row"><StatusBadge status={str(v.status)} /></span></div>
      <div className="row-actions"><button className="text-button" onClick={() => setDialog({ view: v })}>View</button><button className="text-button" onClick={() => exportDoc('md', v)}>Export</button></div></li>)}</ul> : <p className="muted">Sending for owner review creates the first preserved version.</p>}
    {dialog === 'changes' && <ReasonDialog title="Request changes" label="What needs to change? *" onClose={() => setDialog(null)} onSubmit={reason => run('proposal.requestChanges', { reason }, 'Changes requested. The version and your notes are preserved.')} />}
    {dialog === 'template' && <ReasonDialog title="Save as template" label="Template name *" submitLabel="Save template" onClose={() => setDialog(null)} onSubmit={async name => { const r = await wf.action('proposal.saveTemplate', { id: proposal.id, name }); if (r.ok) { setNotice('Template saved. It can start new proposals; it never changes existing ones.'); setDialog(null); } else setError(r.error); return r.ok; }} />}
    {dialog === 'submit' && <SubmissionDialog onClose={() => setDialog(null)} onSubmit={body => run('proposal.recordSubmission', body, 'Submission recorded for the approved version. Nothing was sent from this workspace.')} versionNumber={str(approved?.number)} />}
    {dialog && typeof dialog === 'object' && <Dialog title={`Version ${str(dialog.view.number)} · ${str(dialog.view.status)}`} eyebrow="PRESERVED VERSION" onClose={() => setDialog(null)}>
      <div className="version-view">{PROPOSAL_SECTIONS.map(({ key, label }) => { const s = (dialog.view.sections as Sections)[key]; return <section key={key}><h3>{label}</h3><p className="muted">Basis: {s?.basis}</p><p className="inquiry-scope full">{s?.body || '[Not yet written]'}</p></section>; })}</div></Dialog>}
  </section>;
}

export function ReasonDialog({ title, label, submitLabel = 'Save', onClose, onSubmit, children }: { title: string; label: string; submitLabel?: string; onClose: () => void; onSubmit: (text: string) => Promise<boolean>; children?: React.ReactNode }) {
  const [text, setText] = useState(''), [busy, setBusy] = useState(false);
  return <Dialog title={title} onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); const ok = await onSubmit(text); setBusy(false); if (ok) onClose(); }}>
    {children}<label className="field wide"><span>{label}</span><textarea required rows={4} maxLength={4000} value={text} onChange={e => setText(e.target.value)} /></label>
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy || !text.trim()}>{submitLabel}</button></div></form></Dialog>;
}

function SubmissionDialog({ onClose, onSubmit, versionNumber }: { onClose: () => void; onSubmit: (body: Values) => Promise<boolean>; versionNumber: string }) {
  const [form, setForm] = useState({ submittedOn: '', method: SUBMISSION_METHODS[0] as string, reference: '', notes: '' });
  return <Dialog title="Record submission" eyebrow={`APPROVED VERSION ${versionNumber}`} onClose={onClose}><form onSubmit={async e => { e.preventDefault(); if (await onSubmit(form)) onClose(); }}>
    <p className="muted">Record how and when you submitted this approved version yourself. This does not send or submit anything.</p>
    <div className="form-grid"><label className="field"><span>Submission date *</span><input type="date" required value={form.submittedOn} onChange={e => setForm({ ...form, submittedOn: e.target.value })} /></label>
      <label className="field"><span>Method</span><select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>{SUBMISSION_METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
      <label className="field wide"><span>Confirmation / reference</span><input maxLength={200} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></label>
      <label className="field wide"><span>Notes</span><textarea rows={2} maxLength={4000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label></div>
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Record submission</button></div></form></Dialog>;
}

// ── Submission records and award ────────────────────────────────────────────

export function SubmissionPanel({ wf, opportunity }: { wf: Workflow; opportunity: OpportunityRecord }) {
  const [dialog, setDialog] = useState<null | { outcome: Values } | { edit: Values }>(null);
  const subs = recs(wf, 'submission').filter(s => s.opportunityId === opportunity.id);
  const versions = recs(wf, 'proposalVersion');
  return <>
    <div className="notice"><span>Submission records are your own notes of what was submitted and the result. Approval and submission are not an award: record an award only after written notice, with the notice linked as evidence.</span></div>
    {subs.length ? <ul className="followup-list">{subs.map(s => { const v = versions.find(x => x.id === s.proposalVersionId); return <li key={str(s.id)}><div>
      <strong>Version {str(v?.number)} submitted {str(s.submittedOn)} · {str(s.method)}</strong>
      <small>{s.reference ? `Reference: ${str(s.reference)}` : 'No reference recorded'}{s.outcomeDate ? ` · Outcome date ${str(s.outcomeDate)}` : ''}</small>
      <span className="chip-row"><StatusBadge status={str(s.outcome)} /></span>{s.outcomeNotes ? <small>{str(s.outcomeNotes)}</small> : null}
    </div><div className="row-actions"><button className="button secondary" onClick={() => setDialog({ outcome: s })}>Record outcome</button><button className="text-button" onClick={() => setDialog({ edit: s })}>Edit details</button></div></li>; })}</ul>
      : <p className="muted empty-row">No submission recorded. Approve the proposal in owner review, then record the submission from the Proposal tab.</p>}
    {dialog && 'outcome' in dialog && <OutcomeDialog wf={wf} submission={dialog.outcome} onClose={() => setDialog(null)} />}
    {dialog && 'edit' in dialog && <RecordDialog spec={SPECS.submission} record={dialog.edit} title="Edit submission details" onClose={() => setDialog(null)} onSave={v => saver(wf.updateRecord('submission', dialog.edit, v))} />}
  </>;
}

function OutcomeDialog({ wf, submission, onClose }: { wf: Workflow; submission: Values; onClose: () => void }) {
  const [form, setForm] = useState({ outcome: str(submission.outcome) || 'Pending', outcomeDate: str(submission.outcomeDate), outcomeNotes: str(submission.outcomeNotes), awardEvidenceId: str(submission.awardEvidenceId), confirmAward: false });
  const [error, setError] = useState('');
  const evidence = recs(wf, 'evidence').filter(e => !['Rejected', 'Superseded'].includes(str(e.reviewStatus)));
  const awarded = form.outcome === 'Awarded';
  async function submit(e: React.FormEvent) { e.preventDefault(); const r = await wf.action('submission.recordOutcome', { id: submission.id, version: submission.version, ...form, outcomeDate: form.outcomeDate || null, awardEvidenceId: form.awardEvidenceId || null }); if (r.ok) onClose(); else setError(r.error); }
  return <Dialog title="Record outcome" eyebrow="SUBMISSION RECORD" onClose={onClose}><form onSubmit={e => void submit(e)}>
    <div className="form-grid"><label className="field"><span>Outcome</span><select value={form.outcome} onChange={e => setForm({ ...form, outcome: e.target.value })}>{SUBMISSION_OUTCOMES.map(o => <option key={o}>{o}</option>)}</select></label>
      <label className="field"><span>Outcome date{awarded ? ' *' : ''}</span><input type="date" required={awarded} value={form.outcomeDate} onChange={e => setForm({ ...form, outcomeDate: e.target.value })} /></label>
      {awarded && <label className="field wide"><span>Award evidence (notice of award or signed contract) *</span><select required value={form.awardEvidenceId} onChange={e => setForm({ ...form, awardEvidenceId: e.target.value })}><option value="">Choose evidence…</option>{evidence.map(e => <option key={str(e.id)} value={str(e.id)}>{str(e.title)} · {str(e.reviewStatus)}</option>)}</select></label>}
      <label className="field wide"><span>Outcome notes</span><textarea rows={2} maxLength={4000} value={form.outcomeNotes} onChange={e => setForm({ ...form, outcomeNotes: e.target.value })} /></label>
      {awarded && <label className="field wide checkbox-field"><input type="checkbox" checked={form.confirmAward} onChange={e => setForm({ ...form, confirmAward: e.target.checked })} required /><span>I confirm the award was received in writing. Recording it does not accept, sign or create any agreement.</span></label>}</div>
    <Alert message={error} /><div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Save outcome</button></div></form></Dialog>;
}

export const pursuitTabs = (wf: Workflow, extra: (o: OpportunityRecord) => PursuitTab[] = () => []) => (o: OpportunityRecord): PursuitTab[] => [
  { id: 'teaming', label: 'Teaming', render: () => <section className="panel followup-section"><TeamingPanel wf={wf} opportunity={o} /></section> },
  { id: 'proposal', label: 'Proposal', render: () => <section className="panel followup-section"><ProposalPanel wf={wf} opportunity={o} /></section> },
  { id: 'submission', label: 'Submission & award', render: () => <section className="panel followup-section"><SubmissionPanel wf={wf} opportunity={o} /></section> },
  ...extra(o),
];
