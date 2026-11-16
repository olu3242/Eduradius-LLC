'use client';
// Contracting execution UI: spec-driven record editor, organizations, evidence register
// and the opportunity "pursuit" workspace.
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Building2, FileCheck2, Link2, Plus, RefreshCw, Search, Unlink, X } from 'lucide-react';
import { SPECS, ORGANIZATION_TYPES, evidenceState, requirementSummary, type FieldSpec, type TypeSpec, type Values, type EvidenceLink } from '../../lib/records';
import type { OpportunityRecord } from '../../lib/workflow';
import { Alert, DueChip, StatusBadge, useDialog, type Workflow } from './workflow';

export const recs = (wf: Workflow, type: string): Values[] => wf.data?.records?.[type] ?? [];
const links = (wf: Workflow): EvidenceLink[] => wf.data?.evidenceLinks ?? [];
const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
export type Option = { id: string; label: string };

// ── Generic record dialog ───────────────────────────────────────────────────

type SaveResult = { ok: boolean; error?: string; duplicates?: Values[] };
export function RecordDialog({ spec, record, fixed = {}, hide = [], refOptions = {}, title, eyebrow, onClose, onSave, onUseExisting, children }: {
  spec: TypeSpec; record?: Values; fixed?: Values; hide?: string[]; refOptions?: Record<string, Option[]>; title: string; eyebrow?: string;
  onClose: () => void; onSave: (values: Values, confirmDistinct: boolean) => Promise<SaveResult>; onUseExisting?: (id: string) => void; children?: ReactNode;
}) {
  const ref = useDialog(onClose);
  const titleId = useId();
  const editable = spec.fields.filter(f => !f.derived && !f.readOnly && !(f.key in fixed) && !hide.includes(f.key) && !(record && f.immutable));
  const [values, setValues] = useState<Values>(() => Object.fromEntries(editable.map(f => [f.key, record ? record[f.key] : f.default ?? (f.kind === 'bool' ? false : f.kind === 'date' || f.kind === 'ref' ? null : '')])));
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [duplicates, setDuplicates] = useState<Values[]>([]);
  const set = (k: string, v: unknown) => setValues(prev => ({ ...prev, [k]: v }));
  async function submit(e: React.FormEvent | null, confirmDistinct = false) {
    e?.preventDefault();
    setSaving(true); setError('');
    const payload: Values = record ? Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(record[k]))) : { ...fixed, ...values };
    const result = await onSave(payload, confirmDistinct);
    setSaving(false);
    if (result.ok) { onClose(); return; }
    setDuplicates(result.duplicates ?? []);
    setError(result.error ?? 'Unable to save.');
  }
  return <div className="modal-backdrop" onClick={onClose}><section ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()}>
    <div className="modal-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={titleId}>{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></div>
    {children}
    <form onSubmit={e => void submit(e)}>
      <div className="form-grid">{editable.map(f => <FieldInput key={f.key} field={f} value={values[f.key]} onChange={v => set(f.key, v)} options={f.ref ? refOptions[f.ref] ?? [] : undefined} />)}</div>
      <Alert message={error} />
      {duplicates.length > 0 && <div className="duplicate-panel" role="group" aria-label="Possible duplicates">
        <p className="muted">Possible duplicates. Records are never merged automatically.</p>
        <ul>{duplicates.map(d => <li key={str(d.id)}><span>{str(d.name)}{d.email ? ` · ${str(d.email)}` : ''}{d.website ? ` · ${str(d.website)}` : ''}</span>{onUseExisting && <button type="button" className="text-button" onClick={() => { onUseExisting(str(d.id)); onClose(); }}>Use this record</button>}</li>)}</ul>
        <button type="button" className="button secondary" disabled={saving} onClick={() => void submit(null, true)}>Save as a distinct record</button>
      </div>}
      <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
    </form>
  </section></div>;
}

export function FieldInput({ field, value, onChange, options }: { field: FieldSpec; value: unknown; onChange: (v: unknown) => void; options?: Option[] }) {
  const hintId = useId();
  const label = <span>{field.label}{field.required ? ' *' : ''}</span>;
  const hint = field.hint ? <small id={hintId} className="field-hint">{field.hint}</small> : null;
  const described = field.hint ? hintId : undefined;
  if (field.kind === 'bool') return <label className="field checkbox-field"><input type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} aria-describedby={described} />{label}{hint}</label>;
  if (field.kind === 'enum') return <label className="field">{label}<select value={str(value)} onChange={e => onChange(e.target.value)} aria-describedby={described}>{(field.options ?? []).map(o => <option key={o}>{o}</option>)}</select>{hint}</label>;
  if (field.kind === 'ref') return <label className="field">{label}<select value={str(value)} onChange={e => onChange(e.target.value || null)} aria-describedby={described}><option value="">None</option>{(options ?? []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>{hint}</label>;
  if (field.kind === 'longtext') return <label className="field wide">{label}<textarea rows={3} value={str(value)} required={field.required} maxLength={field.max} onChange={e => onChange(e.target.value)} aria-describedby={described} />{hint}</label>;
  const type = field.kind === 'date' ? 'date' : field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : 'text';
  return <label className="field">{label}<input type={type} value={str(value)} required={field.required} maxLength={field.max} onChange={e => onChange(field.kind === 'date' ? e.target.value || null : e.target.value)} aria-describedby={described} />{hint}</label>;
}

/** Wraps a create/update call into the dialog's SaveResult. */
export const saver = (call: Promise<{ ok: boolean; error?: string; body?: Values; status: number }>) => call.then(r => (r.ok ? { ok: true } : { ok: false, error: r.error, duplicates: (r.body?.duplicates as Values[] | undefined) ?? [] }));

function Loading({ wf, label }: { wf: Workflow; label: string }) {
  if (wf.state === 'error') return <section className="panel large-empty"><Alert message={wf.error} /><button className="button secondary" onClick={() => void wf.reload()}><RefreshCw size={14} />Retry</button></section>;
  return <section className="panel large-empty" aria-busy="true"><p className="muted">Loading {label}…</p></section>;
}

// ── Organizations and contacts ──────────────────────────────────────────────

export function OrganizationsView({ wf }: { wf: Workflow }) {
  const [query, setQuery] = useState(''), [type, setType] = useState('All types'), [showMerged, setShowMerged] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: 'org'; record?: Values } | { kind: 'detail'; id: string }>(null);
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [linking, setLinking] = useState(false);
  const orgs = recs(wf, 'organization'), contacts = recs(wf, 'contact');
  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, Values[]>();
    for (const o of orgs.filter(o => o.status === 'Active')) for (const key of [str(o.nameKey) && 'n:' + str(o.nameKey), str(o.domain) && 'd:' + str(o.domain)].filter(Boolean) as string[]) groups.set(key, [...(groups.get(key) ?? []), o]);
    return [...groups.values()].filter(g => g.length > 1);
  }, [orgs]);
  if (wf.state !== 'ready') return <Loading wf={wf} label="organizations" />;
  const q = query.trim().toLowerCase();
  const visible = orgs.filter(o => (showMerged || o.status === 'Active') && (type === 'All types' || o.orgType === type) && (!q || [o.name, o.website, o.relationshipOwner].some(v => str(v).toLowerCase().includes(q))));
  async function linkExisting() {
    setLinking(true); setNotice(''); setError('');
    let processed = 0, orgsCreated = 0, contactsCreated = 0;
    for (let i = 0; i < 40; i++) {
      const r = await wf.action<{ processed: number; createdOrganizations: number; createdContacts: number; remaining: number }>('organization.linkExisting', {});
      if (!r.ok) { setError(r.error); break; }
      processed += r.data.processed; orgsCreated += r.data.createdOrganizations; contactsCreated += r.data.createdContacts;
      if (!r.data.remaining) break;
    }
    setLinking(false);
    setNotice(processed ? `Linked ${processed} existing records (${orgsCreated} organizations and ${contactsCreated} contacts created; exact matches only).` : 'All existing requests and opportunities are already linked.');
  }
  const detail = dialog?.kind === 'detail' ? orgs.find(o => o.id === dialog.id) : undefined;
  return <>
    <div className="table-tools workflow-tools">
      <label className="search"><Search size={16} /><input aria-label="Search organizations" placeholder="Search organizations" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="filter-row">
        <select aria-label="Filter by organization type" value={type} onChange={e => setType(e.target.value)}>{['All types', ...ORGANIZATION_TYPES].map(t => <option key={t}>{t}</option>)}</select>
        <label className="inline-check"><input type="checkbox" checked={showMerged} onChange={e => setShowMerged(e.target.checked)} />Show merged</label>
        <button className="button secondary" disabled={linking} onClick={() => void linkExisting()}><Link2 size={14} />{linking ? 'Linking…' : 'Link existing records'}</button>
        <button className="button primary" onClick={() => setDialog({ kind: 'org' })}><Plus size={14} />Add organization</button>
      </div>
    </div>
    <div aria-live="polite">{notice && <p className="success-line">{notice}</p>}</div>
    <Alert message={error} />
    {duplicateGroups.length > 0 && <section className="panel followup-section" aria-labelledby="dup-h"><div className="panel-heading"><h2 id="dup-h">Possible duplicates <span className="nav-count">{duplicateGroups.length}</span></h2></div>
      <ul className="followup-list">{duplicateGroups.map(g => <li key={g.map(o => str(o.id)).join()}><div><strong>{g.map(o => str(o.name)).join(' · ')}</strong><small>Same normalized name or website domain. Review and merge explicitly if they are the same organization.</small></div><div className="row-actions"><button className="button secondary" onClick={() => setDialog({ kind: 'detail', id: str(g[0].id) })}>Review</button></div></li>)}</ul></section>}
    {!orgs.length ? <section className="panel large-empty"><Building2 size={28} /><h2>No organizations yet.</h2><p>Add clients, buyers, primes and partners, or link existing requests and opportunities.</p></section>
      : <div className="opportunity-grid">{visible.map(o => {
        const people = contacts.filter(c => c.organizationId === o.id && c.status === 'Active').length;
        const related = (wf.data?.inquiries.filter(i => i.organizationId === o.id).length ?? 0) + (wf.data?.opportunities.filter(op => op.organizationId === o.id).length ?? 0);
        return <section className="panel opportunity-card" key={str(o.id)} aria-labelledby={`org-${str(o.id)}`}>
          <div className="panel-heading"><span className="category">{str(o.orgType)}</span>{o.status === 'Merged' && <StatusBadge status="Merged" />}</div>
          <h2 id={`org-${str(o.id)}`}>{str(o.name)}</h2>
          <p className="muted">{str(o.website) || 'No website recorded'}</p>
          <div className="opportunity-meta"><span>Contacts<strong>{people}</strong></span><span>Related records<strong>{related}</strong></span><span>Owner<strong>{str(o.relationshipOwner) || 'Unassigned'}</strong></span></div>
          <div className="card-buttons"><button className="button secondary" onClick={() => setDialog({ kind: 'detail', id: str(o.id) })}>Open organization</button></div>
        </section>; })}</div>}
    {dialog?.kind === 'org' && <RecordDialog spec={SPECS.organization} record={dialog.record} title={dialog.record ? 'Edit organization' : 'Add organization'} eyebrow="ORGANIZATION" onClose={() => setDialog(null)}
      onSave={(v, confirm) => saver(dialog.record ? wf.updateRecord('organization', dialog.record, v, confirm) : wf.createRecord('organization', v, confirm))}
      onUseExisting={id => setDialog({ kind: 'detail', id })} />}
    {detail && <OrganizationDialog wf={wf} org={detail} onClose={() => setDialog(null)} onEdit={() => setDialog({ kind: 'org', record: detail })} />}
  </>;
}

function OrganizationDialog({ wf, org, onClose, onEdit }: { wf: Workflow; org: Values; onClose: () => void; onEdit: () => void }) {
  const ref = useDialog(onClose);
  const titleId = useId();
  const [contactDialog, setContactDialog] = useState<null | { record?: Values }>(null);
  const [target, setTarget] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const orgs = recs(wf, 'organization').filter(o => o.status === 'Active' && o.id !== org.id);
  const people = recs(wf, 'contact').filter(c => c.organizationId === org.id);
  const requests = wf.data?.inquiries.filter(i => i.organizationId === org.id) ?? [];
  const opportunities = wf.data?.opportunities.filter(o => o.organizationId === org.id) ?? [];
  const merged = org.status === 'Merged';
  async function mergeInto() {
    const t = orgs.find(o => o.id === target);
    if (!t) return;
    setError(''); setNotice('');
    const r = await wf.action<{ conflicts: string[] }>('organization.merge', { sourceId: org.id, targetId: t.id, sourceVersion: org.version });
    if (!r.ok) { setError(r.error); return; }
    setNotice(`Merged into ${str(t.name)}. ${r.data.conflicts.length ? `Kept ${str(t.name)}’s values for: ${r.data.conflicts.join(', ')}. Review them manually.` : 'No conflicting fields.'}`);
  }
  return <div className="modal-backdrop" onClick={onClose}><section ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()}>
    <div className="modal-heading"><div><span className="eyebrow">{str(org.orgType).toUpperCase()}</span><h2 id={titleId}>{str(org.name)}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></div>
    <dl className="inquiry-facts">
      <div><dt>Website</dt><dd>{str(org.website) || '—'}</dd></div>
      <div><dt>Relationship owner</dt><dd>{str(org.relationshipOwner) || 'Unassigned'}</dd></div>
      <div><dt>Source</dt><dd>{str(org.source) || '—'}</dd></div>
      {str(org.notes) && <div className="wide"><dt>Notes</dt><dd className="inquiry-scope full">{str(org.notes)}</dd></div>}
      {merged && <div className="wide"><dt>Merged</dt><dd>Kept read-only for reference. References now point to {str(recs(wf, 'organization').find(o => o.id === org.mergedIntoId)?.name)}.</dd></div>}
    </dl>
    <div aria-live="polite">{notice && <p className="success-line">{notice}</p>}</div>
    <Alert message={error} />
    {!merged && <div className="card-buttons"><button className="button secondary" onClick={onEdit}>Edit organization</button><button className="button secondary" onClick={() => setContactDialog({})}><Plus size={14} />Add contact</button></div>}
    <h3 className="section-label">Contacts</h3>
    {people.length ? <ul className="followup-list">{people.map(c => <li key={str(c.id)}><div><strong>{str(c.name)}</strong><small>{[c.role, c.email, c.phone].map(str).filter(Boolean).join(' · ') || 'No details'}{c.status === 'Merged' ? ' · merged' : ''}</small></div>{c.status === 'Active' && !merged && <div className="row-actions"><button className="text-button" onClick={() => setContactDialog({ record: c })}>Edit</button></div>}</li>)}</ul> : <p className="muted">No contacts recorded.</p>}
    <h3 className="section-label">Related requests and opportunities</h3>
    {requests.length + opportunities.length ? <ul className="followup-list">{requests.map(i => <li key={i.id}><div><strong>{i.kind}</strong><small>Request · {i.status}</small></div></li>)}{opportunities.map(o => <li key={o.id}><div><strong>{o.title}</strong><small>Opportunity · {o.stage}</small></div></li>)}</ul> : <p className="muted">None linked.</p>}
    {!merged && orgs.length > 0 && <><h3 className="section-label">Consolidate</h3>
      <p className="muted">Merging moves contacts, requests and opportunities to the chosen organization. Its own details are kept; differing values here are reported, not copied. This record stays available as “Merged”.</p>
      <div className="filter-row"><select aria-label="Merge into organization" value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose organization…</option>{orgs.map(o => <option key={str(o.id)} value={str(o.id)}>{str(o.name)}</option>)}</select><button className="button secondary" disabled={!target} onClick={() => void mergeInto()}>Merge into selected</button></div></>}
    {contactDialog && <RecordDialog spec={SPECS.contact} record={contactDialog.record} fixed={contactDialog.record ? {} : { organizationId: org.id }} hide={['organizationId']} title={contactDialog.record ? 'Edit contact' : 'Add contact'} eyebrow={str(org.name).toUpperCase()}
      onClose={() => setContactDialog(null)} onSave={(v, confirm) => saver(contactDialog.record ? wf.updateRecord('contact', contactDialog.record, v, confirm) : wf.createRecord('contact', v, confirm))} />}
  </section></div>;
}

// ── Evidence register ───────────────────────────────────────────────────────

export function EvidenceChip({ evidence, today }: { evidence: Values; today: string }) {
  const state = evidenceState(evidence, today);
  const label = { current: 'Verified', unreviewed: 'Unreviewed', expired: 'Expired', rejected: str(evidence.reviewStatus) }[state];
  return <span className={'evidence-chip ' + state}>{label}</span>;
}
const SUBJECT_LABEL: Record<string, string> = { opportunity: 'Opportunity', requirement: 'Requirement', proposal: 'Proposal', project: 'Project', deliverable: 'Deliverable', experience: 'Experience' };

export function EvidenceView({ wf }: { wf: Workflow }) {
  const [dialog, setDialog] = useState<null | { record?: Values }>(null);
  const [query, setQuery] = useState(''), [state, setState] = useState('All');
  if (wf.state !== 'ready') return <Loading wf={wf} label="evidence" />;
  const today = wf.data!.today, items = recs(wf, 'evidence');
  const q = query.trim().toLowerCase();
  const visible = items.filter(e => (!q || [e.title, e.category, e.owner, e.location].some(v => str(v).toLowerCase().includes(q))) && (state === 'All' || evidenceState(e, today) === state.toLowerCase()));
  return <>
    <div className="notice"><FileCheck2 size={16} aria-hidden="true" /><span>Reference-only register: files are not uploaded or stored in this workspace (no private storage is configured). Record where each document is kept, or an approved https link. Never place private evidence in the public website.</span></div>
    <div className="table-tools workflow-tools">
      <label className="search"><Search size={16} /><input aria-label="Search evidence" placeholder="Search evidence" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="filter-row"><select aria-label="Filter by evidence state" value={state} onChange={e => setState(e.target.value)}>{['All', 'Current', 'Unreviewed', 'Expired', 'Rejected'].map(s => <option key={s}>{s}</option>)}</select><button className="button primary" onClick={() => setDialog({})}><Plus size={14} />Add evidence</button></div>
    </div>
    {!items.length ? <section className="panel large-empty"><FileCheck2 size={28} /><h2>No evidence recorded yet.</h2><p>Track registrations, certifications, references and other proof with owners and review dates.</p></section>
      : <section className="panel followup-section"><ul className="followup-list">{visible.map(e => {
        const used = links(wf).filter(l => l.evidenceId === e.id);
        return <li key={str(e.id)}><div><strong>{str(e.title)}{e.versionLabel ? ` · ${str(e.versionLabel)}` : ''}</strong>
          <small>{str(e.category)} · {str(e.owner) || 'No owner'} · {str(e.storageKind)}{e.location ? ` · ${str(e.location)}` : ''}</small>
          <span className="chip-row"><EvidenceChip evidence={e} today={today} />{e.reviewDate ? <DueChip due={str(e.reviewDate)} today={today} /> : <span className="muted">No review date</span>}</span>
          <small>{used.length ? `Linked to ${used.map(l => SUBJECT_LABEL[l.subjectType] ?? l.subjectType).join(', ')}` : 'Not linked to any record'}</small></div>
          <div className="row-actions">{e.url ? <a className="text-button" href={str(e.url)} target="_blank" rel="noreferrer noopener">Open link</a> : null}<button className="button secondary" onClick={() => setDialog({ record: e })}>Edit</button></div></li>; })}</ul>
        {!visible.length && <p className="muted empty-row">No evidence matches these filters.</p>}</section>}
    {dialog && <RecordDialog spec={SPECS.evidence} record={dialog.record} title={dialog.record ? 'Edit evidence' : 'Add evidence'} eyebrow="EVIDENCE REGISTER" onClose={() => setDialog(null)}
      onSave={v => saver(dialog.record ? wf.updateRecord('evidence', dialog.record, v) : wf.createRecord('evidence', v))} />}
  </>;
}

/** Evidence linked to a record, with link/unlink controls. */
export function EvidenceLinks({ wf, subjectType, subjectId, label = 'Supporting evidence' }: { wf: Workflow; subjectType: string; subjectId: string; label?: string }) {
  const [pick, setPick] = useState(''), [error, setError] = useState('');
  const today = wf.data?.today ?? '';
  const all = recs(wf, 'evidence');
  const linked = links(wf).filter(l => l.subjectType === subjectType && l.subjectId === subjectId).map(l => all.find(e => e.id === l.evidenceId)).filter(Boolean) as Values[];
  const available = all.filter(e => !linked.some(l => l.id === e.id));
  async function run(name: string, evidenceId: string) { setError(''); const r = await wf.action(name, { evidenceId, subjectType, subjectId }); if (!r.ok) setError(r.error); else setPick(''); }
  return <div className="evidence-links" role="group" aria-label={label}>
    <ul className="chip-list">{linked.map(e => <li key={str(e.id)}><span>{str(e.title)}</span><EvidenceChip evidence={e} today={today} /><button className="icon-button small" aria-label={`Unlink ${str(e.title)}`} onClick={() => void run('evidence.unlink', str(e.id))}><Unlink size={13} /></button></li>)}{!linked.length && <li className="muted">No evidence linked.</li>}</ul>
    {available.length > 0 && <div className="filter-row"><select aria-label={`Link evidence to this ${subjectType}`} value={pick} onChange={e => setPick(e.target.value)}><option value="">Link evidence…</option>{available.map(e => <option key={str(e.id)} value={str(e.id)}>{str(e.title)}</option>)}</select><button className="button secondary" disabled={!pick} onClick={() => void run('evidence.link', pick)}><Link2 size={13} />Link</button></div>}
    <Alert message={error} />
  </div>;
}

// ── Pursuit workspace (opportunity detail) ──────────────────────────────────

export type PursuitTab = { id: string; label: string; render: () => ReactNode };
export function Tabs({ tabs, label }: { tabs: PursuitTab[]; label: string }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const current = tabs.find(t => t.id === active) ?? tabs[0];
  function key(e: React.KeyboardEvent, i: number) {
    const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault(); setActive(tabs[next].id); refs.current[next]?.focus();
  }
  return <>
    <div className="tab-list" role="tablist" aria-label={label}>{tabs.map((t, i) => <button key={t.id} ref={el => { refs.current[i] = el; }} role="tab" id={`${base}-${t.id}`} aria-selected={t.id === current.id} aria-controls={`${base}-${t.id}-panel`} tabIndex={t.id === current.id ? 0 : -1} className={t.id === current.id ? 'active' : ''} onClick={() => setActive(t.id)} onKeyDown={e => key(e, i)}>{t.label}</button>)}</div>
    <div role="tabpanel" id={`${base}-${current.id}-panel`} aria-labelledby={`${base}-${current.id}`} className="tab-panel">{current.render()}</div>
  </>;
}

export function PartyLink({ wf, opportunity }: { wf: Workflow; opportunity: OpportunityRecord }) {
  const [orgId, setOrgId] = useState(opportunity.organizationId ?? ''), [contactId, setContactId] = useState(opportunity.contactId ?? ''), [error, setError] = useState(''), [saved, setSaved] = useState('');
  const orgs = recs(wf, 'organization').filter(o => o.status === 'Active');
  const people = recs(wf, 'contact').filter(c => c.status === 'Active' && (!orgId || !c.organizationId || c.organizationId === orgId));
  async function save() {
    setError(''); setSaved('');
    const r = await wf.action('opportunity.link', { id: opportunity.id, version: opportunity.version, organizationId: orgId || null, contactId: contactId || null });
    if (r.ok) setSaved('Links saved.'); else setError(r.status === 409 ? 'This opportunity changed. Reload and try again.' : r.error);
  }
  return <div className="form-grid">
    <label className="field"><span>Organization</span><select value={orgId} onChange={e => { setOrgId(e.target.value); setContactId(''); }}><option value="">None</option>{orgs.map(o => <option key={str(o.id)} value={str(o.id)}>{str(o.name)}</option>)}</select></label>
    <label className="field"><span>Primary contact</span><select value={contactId} onChange={e => setContactId(e.target.value)}><option value="">None</option>{people.map(c => <option key={str(c.id)} value={str(c.id)}>{str(c.name)}{c.role ? ` · ${str(c.role)}` : ''}</option>)}</select></label>
    <div className="field wide"><button className="button secondary" onClick={() => void save()}>Save organization and contact</button><span className="muted" aria-live="polite"> {saved}</span><Alert message={error} /></div>
  </div>;
}

export function RequirementsPanel({ wf, opportunity }: { wf: Workflow; opportunity: OpportunityRecord }) {
  const [dialog, setDialog] = useState<null | { record?: Values }>(null);
  const today = wf.data?.today ?? '';
  const items = recs(wf, 'requirement').filter(r => r.opportunityId === opportunity.id);
  const evidenceById = new Map(recs(wf, 'evidence').map(e => [str(e.id), e]));
  const s = requirementSummary(items, evidenceById, links(wf), today);
  return <>
    <div className="notice"><span>{s.total ? `${s.mandatory} required · ${s.met} met · ${s.evidenceNeeded} awaiting evidence · ${s.notMet} confirmed not met · ${s.weakEvidence} with unreviewed or expired evidence.` : 'No requirements recorded yet.'} {s.notMet > 0 ? 'A required item is confirmed not met; consider the go/no-go decision. ' : ''}The go/no-go decision is always made manually in the opportunity details.</span></div>
    <div className="section-toolbar"><span /><button className="button primary" onClick={() => setDialog({})}><Plus size={14} />Add requirement</button></div>
    {items.length ? <ul className="followup-list requirement-list">{items.map(r => <li key={str(r.id)}><div>
      <strong>{str(r.description)}</strong>
      <small>{str(r.category)} · {r.mandatory ? 'Required' : 'Optional'} · {str(r.owner) || 'No owner'}</small>
      <span className="chip-row"><StatusBadge status={str(r.status)} /><DueChip due={(r.dueDate as string | null) ?? null} today={today} /></span>
      {r.reviewerNotes ? <small>Reviewer notes: {str(r.reviewerNotes)}</small> : null}
      <EvidenceLinks wf={wf} subjectType="requirement" subjectId={str(r.id)} />
    </div><div className="row-actions"><button className="button secondary" onClick={() => setDialog({ record: r })}>Edit</button></div></li>)}</ul> : <p className="muted empty-row">Add the solicitation’s eligibility, technical, management and compliance requirements.</p>}
    {dialog && <RecordDialog spec={SPECS.requirement} record={dialog.record} fixed={dialog.record ? {} : { opportunityId: opportunity.id }} hide={['opportunityId']} title={dialog.record ? 'Edit requirement' : 'Add requirement'} eyebrow={opportunity.title.toUpperCase()} onClose={() => setDialog(null)}
      onSave={v => saver(dialog.record ? wf.updateRecord('requirement', dialog.record, v) : wf.createRecord('requirement', v))} />}
  </>;
}

export function PursuitView({ wf, opportunityId, onBack, onEditDetails, extraTabs = () => [] }: { wf: Workflow; opportunityId: string; onBack: () => void; onEditDetails: (id: string) => void; extraTabs?: (o: OpportunityRecord) => PursuitTab[] }) {
  const opportunity = wf.data?.opportunities.find(o => o.id === opportunityId);
  if (!opportunity) return <Loading wf={wf} label="opportunity" />;
  const org = recs(wf, 'organization').find(o => o.id === opportunity.organizationId);
  return <div className="pursuit">
    <button className="text-button back-link" onClick={onBack}><ArrowLeft size={14} />All opportunities</button>
    <section className="panel pursuit-header"><div><span className="category">{opportunity.stage} · Decision: {opportunity.decision}</span><h2>{opportunity.title}</h2><p className="muted">{org ? str(org.name) : opportunity.agency || 'No organization linked'}{opportunity.deadline ? ` · Response due ${opportunity.deadline}` : ''}</p></div>
      <button className="button secondary" onClick={() => onEditDetails(opportunity.id)}>Edit details & decision</button></section>
    <Tabs label="Pursuit sections" tabs={[
      { id: 'overview', label: 'Overview', render: () => <section className="panel followup-section"><h3 className="section-label">Organization and contact</h3><PartyLink key={opportunity.version} wf={wf} opportunity={opportunity} /><h3 className="section-label">Opportunity evidence</h3><EvidenceLinks wf={wf} subjectType="opportunity" subjectId={opportunity.id} /></section> },
      { id: 'requirements', label: 'Requirements', render: () => <section className="panel followup-section"><RequirementsPanel wf={wf} opportunity={opportunity} /></section> },
      ...extraTabs(opportunity),
    ]} />
  </div>;
}
