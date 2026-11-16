'use client';
// Connected intake → opportunity workflow UI for the owner workspace.
import { useEffect, useId, useRef, useState } from 'react';
import NextLink from 'next/link';
import { ArrowUpRight, BellRing, Check, CheckCircle2, Clock3, MessagesSquare, RefreshCw, Search, X } from 'lucide-react';
import {
  actorLabel, allowedTransitions, conversionDraft, dueState, INQUIRY_STATUSES, OPPORTUNITY_STAGES, REASON_REQUIRED,
  type ActivityRecord, type FollowUpItem, type InquiryRecord, type InquiryStatus, type OpportunityInput, type OpportunityRecord,
} from '../../lib/workflow';
import { serviceNames } from '../../lib/workspace';

export { useWorkflow, type AuthInfo, type Workflow } from './data';
import { useEnsureRecords, usePagedList, useRecordContext, type Workflow, type Summary } from './data';
import { ListFooter, ListGate } from './list-ui';
type Conversion = { inquiry: InquiryRecord; opportunity: OpportunityRecord; alreadyConverted: boolean };

// ── Shared pieces ───────────────────────────────────────────────────────────

const statusClass = (s: string) => 'badge ' + s.toLowerCase().replaceAll(' ', '-');
export function StatusBadge({ status }: { status: string }) { return <span className={statusClass(status)}><i />{status}</span>; }
const formatDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(); };
const formatDue = (due: string) => new Date(due + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function DueChip({ due, today }: { due: string | null; today: string }) {
  const state = dueState(due, today);
  if (state === 'none' || !due) return null;
  const label = state === 'overdue' ? `Overdue · ${formatDue(due)}` : state === 'today' ? 'Due today' : `Due ${formatDue(due)}`;
  return <span className={'due-chip ' + state}>{label}</span>;
}

/** Focus trap, Escape to close and focus restoration for workflow dialogs. */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]') ?? []).filter(el => !el.hasAttribute('disabled'));
    (dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0])?.focus();
    function key(e: KeyboardEvent) {
      if (document.querySelector('.auth-modal')) return; // the sign-in dialog owns focus while open
      if (e.key === 'Escape') { e.preventDefault(); close.current(); }
      if (e.key !== 'Tab') return;
      const nodes = focusable(), first = nodes[0], last = nodes[nodes.length - 1];
      if (!dialog?.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, []);
  return ref;
}

export function Alert({ message }: { message: string }) { return <div aria-live="assertive">{message && <p className="error" role="alert">{message}</p>}</div>; }
function TextField({ label, value, onChange, type = 'text', area = false, required = false, hint, disabled = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; area?: boolean; required?: boolean; hint?: string; disabled?: boolean }) {
  const hintId = useId();
  return <label className={'field ' + (area ? 'wide' : '')}><span>{label}{required ? ' *' : ''}</span>
    {area ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} required={required} aria-describedby={hint ? hintId : undefined} disabled={disabled} />
      : <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required} aria-describedby={hint ? hintId : undefined} disabled={disabled} />}
    {hint && <small id={hintId} className="field-hint" aria-hidden="true">{hint}</small>}</label>;
}
export function ActivityList({ items, empty }: { items: ActivityRecord[]; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return <ol className="activity-list">{items.map(a => <li key={a.id}><span>{a.summary}</span><small>{actorLabel(a.actor)} · <time dateTime={a.occurredAt}>{new Date(a.occurredAt).toLocaleString()}</time></small></li>)}</ol>;
}

// ── Client requests (inquiry management) ────────────────────────────────────

export function InquiryBoard({ wf, onReview, onConvert, onOpenOpportunity }: { wf: Workflow; onReview: (id: string) => void; onConvert: (id: string) => void; onOpenOpportunity: (id: string) => void }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState('Open requests'), [assignee, setAssignee] = useState('Anyone');
  const filters = { open: status === 'Open requests' ? 'true' : undefined, status: !['Open requests', 'All statuses'].includes(status) ? status : undefined, assignee: assignee === 'Anyone' ? undefined : assignee === 'Unassigned' ? 'none' : assignee };
  const list = usePagedList(wf, 'inquiry', { q: query, filters });
  const inquiries = list.items as unknown as InquiryRecord[];
  const today = wf.data?.today ?? '';
  const filtered = Boolean(query.trim()) || status !== 'Open requests' || assignee !== 'Anyone';
  const empty = <section className="panel large-empty"><MessagesSquare size={28} /><h2>No briefing requests yet.</h2><p>The company page includes a form for project and teaming inquiries.</p><NextLink className="button secondary" href="/#contact">View briefing form <ArrowUpRight size={14} /></NextLink></section>;
  return <>
    <div className="table-tools workflow-tools">
      <label className="search"><Search size={16} /><input type="search" aria-label="Search requests" placeholder="Search requests" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="filter-row">
        <select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}>{['Open requests', 'All statuses', ...INQUIRY_STATUSES].map(s => <option key={s}>{s}</option>)}</select>
        <select aria-label="Filter by assigned owner" value={assignee} onChange={e => setAssignee(e.target.value)}>{['Anyone', 'Unassigned', ...(wf.data?.owners ?? [])].map(s => <option key={s}>{s}</option>)}</select>
      </div>
    </div>
    <ListGate list={list} noun="requests" empty={empty} filtered={filtered} onClear={() => { setQuery(''); setStatus('All statuses'); setAssignee('Anyone'); }}>
      <div className="opportunity-grid">{inquiries.map(i => <section className="panel opportunity-card inquiry-card" key={i.id} aria-labelledby={`inq-${i.id}`}>
        <div className="panel-heading"><span className="category">{i.kind}</span><StatusBadge status={i.status} /></div>
        <h2 id={`inq-${i.id}`}>{i.organization || i.name}</h2>
        <p>{i.name} · {i.email}</p>
        <p className="muted">{i.sector} · Received {formatDate(i.createdAt)}</p>
        <p className="inquiry-scope">{i.scope}</p>
        <div className="opportunity-meta"><span>Assigned<strong>{i.assignee || 'Unassigned'}</strong></span><span>Next action<strong>{i.nextAction || 'None scheduled'}</strong></span></div>
        <DueChip due={i.nextActionDue} today={today} />
        <div className="card-buttons">
          <button className="button secondary" onClick={() => onReview(i.id)}>Review request <ArrowUpRight size={14} /></button>
          {i.status === 'Qualified' && !i.opportunityId && <button className="button primary" onClick={() => onConvert(i.id)}>Convert to opportunity</button>}
          {i.opportunityId && <button className="text-button" onClick={() => onOpenOpportunity(i.opportunityId!)}>Open opportunity</button>}
        </div>
      </section>)}</div>
    </ListGate>
    {list.state !== 'loading' && (list.items.length > 0 || filtered) && <ListFooter list={list} noun="requests" />}
  </>;
}

export function InquiryDialog({ wf, inquiry, onClose, onConvert, onOpenOpportunity }: { wf: Workflow; inquiry: InquiryRecord; onClose: () => void; onConvert: (id: string) => void; onOpenOpportunity: (id: string) => void }) {
  const ref = useDialog(onClose);
  const titleId = useId();
  // Edits are diffed against, and versioned by, the record as it was when opened (or last saved
  // here). A change made elsewhere meanwhile returns 409 instead of being silently overwritten.
  const [base, setBase] = useState(inquiry);
  const converted = base.status === 'Converted';
  const [form, setForm] = useState({ status: inquiry.status as string, reason: '', assignee: inquiry.assignee, nextAction: inquiry.nextAction, nextActionDue: inquiry.nextActionDue ?? '', notes: inquiry.notes });
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [saved, setSaved] = useState('');
  const set = (k: keyof typeof form) => (v: string) => { setForm(f => ({ ...f, [k]: v })); setSaved(''); };
  const statusChanged = form.status !== base.status;
  const needsReason = statusChanged && REASON_REQUIRED.includes(form.status as InquiryStatus);
  const history = useRecordContext(wf, 'inquiry', inquiry.id).activity.slice(0, 8);
  async function submit(e: React.FormEvent, extra?: Record<string, unknown>) {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    if (!converted) {
      if (statusChanged) changes.status = form.status;
      if (needsReason || (form.reason.trim() && !statusChanged)) changes.reason = form.reason;
      if (form.assignee.trim() !== base.assignee) changes.assignee = form.assignee;
      if (form.nextAction.trim() !== base.nextAction) changes.nextAction = form.nextAction;
      if ((form.nextActionDue || null) !== base.nextActionDue) changes.nextActionDue = form.nextActionDue || null;
    }
    if (form.notes.trim() !== base.notes) changes.notes = form.notes;
    Object.assign(changes, extra);
    if (!Object.keys(changes).length) { setSaved('No changes to save.'); return; }
    setSaving(true); setError('');
    const result = await wf.patchInquiry(base, changes);
    setSaving(false);
    if (!result.ok) { setError(result.status === 409 ? 'This request changed in another window. Close and reopen it to load the latest version.' : result.error); return; }
    const next = result.data.inquiry;
    setBase(next);
    setForm({ status: next.status, reason: '', assignee: next.assignee, nextAction: next.nextAction, nextActionDue: next.nextActionDue ?? '', notes: next.notes });
    setSaved('Changes saved.');
  }
  const statusOptions = converted ? ['Converted'] : [base.status, ...allowedTransitions(base.status)];
  return <div className="modal-backdrop" onClick={onClose}><section ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()}>
    <div className="modal-heading"><div><span className="eyebrow">REQUEST REVIEW</span><h2 id={titleId}>{inquiry.organization || inquiry.name}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></div>
    <dl className="inquiry-facts">
      <div><dt>Contact</dt><dd>{inquiry.name} · {inquiry.email}</dd></div>
      <div><dt>Request</dt><dd>{inquiry.kind} · {inquiry.sector}</dd></div>
      <div><dt>Received</dt><dd>{formatDate(inquiry.createdAt)}{inquiry.legacyStatus ? ` · migrated (was “${inquiry.legacyStatus}”)` : ''}</dd></div>
      <div className="wide"><dt>Scope</dt><dd className="inquiry-scope full">{inquiry.scope}</dd></div>
      {inquiry.reason && <div className="wide"><dt>Recorded reason</dt><dd>{inquiry.reason}</dd></div>}
    </dl>
    <form onSubmit={e => void submit(e)}>
      <div className="form-grid">
        <label className="field"><span>Status</span><select value={form.status} onChange={e => set('status')(e.target.value)} disabled={converted}>{statusOptions.map(s => <option key={s}>{s}</option>)}</select></label>
        <TextField label="Assigned owner" value={form.assignee} onChange={set('assignee')} disabled={converted} />
        {(needsReason || (!converted && base.status !== 'New' && !statusChanged)) && <TextField area required={needsReason} label={needsReason ? `Reason for marking ${form.status}` : 'Update recorded reason (optional)'} value={form.reason} onChange={set('reason')} />}
        <TextField label="Next action" value={form.nextAction} onChange={set('nextAction')} disabled={converted} />
        <TextField label="Next-action due date" type="date" value={form.nextActionDue} onChange={set('nextActionDue')} disabled={converted} hint="Due dates use Central Time (America/Chicago)." />
        <TextField area label="Internal notes" value={form.notes} onChange={set('notes')} hint="Visible only in this workspace." />
      </div>
      <Alert message={error} />
      <p className="muted" aria-live="polite">{saved || (converted ? 'This request was converted and is kept for reference. Only internal notes can change.' : 'Changes are saved to the shared workspace when you select Save.')}</p>
      <div className="modal-footer">
        {base.nextAction && !converted && <button type="button" className="button secondary" disabled={saving} onClick={e => void submit(e, { nextAction: '', nextActionDue: null })}><Check size={14} />Mark follow-up complete</button>}
        {inquiry.status === 'Qualified' && !inquiry.opportunityId && <button type="button" className="button secondary" onClick={() => onConvert(inquiry.id)}>Convert to opportunity</button>}
        {inquiry.opportunityId && <button type="button" className="button secondary" onClick={() => onOpenOpportunity(inquiry.opportunityId!)}>Open opportunity</button>}
        <button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
    <h3 className="section-label">History</h3>
    <ActivityList items={history} empty="No recorded activity yet." />
  </section></div>;
}

export function ConvertDialog({ wf, inquiry, onClose, onOpenOpportunity }: { wf: Workflow; inquiry: InquiryRecord; onClose: () => void; onOpenOpportunity: (id: string) => void }) {
  const ref = useDialog(onClose);
  const titleId = useId();
  const [draft, setDraft] = useState<OpportunityInput>(() => conversionDraft(inquiry));
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [done, setDone] = useState<Conversion | null>(null);
  const set = (k: keyof OpportunityInput) => (v: string) => setDraft(d => ({ ...d, [k]: k === 'nextActionDue' ? v || null : v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    const result = await wf.convert(inquiry, draft);
    setSaving(false);
    if (result.ok) setDone(result.data);
    else setError(result.status === 409 ? `${result.error} Close this dialog to see the latest status.` : result.error);
  }
  return <div className="modal-backdrop" onClick={onClose}><section ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()}>
    {done ? <div className="success-state" role="status">
      <CheckCircle2 size={34} aria-hidden="true" />
      <h2 id={titleId} tabIndex={-1} data-autofocus>{done.alreadyConverted ? 'Already converted' : 'Opportunity created'}</h2>
      <p>{done.alreadyConverted ? 'This request had already been converted, so no duplicate was created.' : `“${done.opportunity.title}” is now in your opportunity pipeline.`} The original request remains available for reference.</p>
      <div className="modal-footer"><button className="button secondary" onClick={onClose}>Back to requests</button><button className="button primary" onClick={() => onOpenOpportunity(done.opportunity.id)}>Open opportunity <ArrowUpRight size={14} /></button></div>
    </div> : <>
      <div className="modal-heading"><div><span className="eyebrow">CONVERT REQUEST</span><h2 id={titleId}>Review the new opportunity</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></div>
      <p className="muted">Details are carried over from {inquiry.organization}’s request. Edit anything before creating the opportunity; the request stays linked for reference.</p>
      <form onSubmit={e => void submit(e)}>
        <div className="form-grid">
          <TextField required label="Opportunity title" value={draft.title} onChange={set('title')} />
          <TextField label="Agency / customer" value={draft.agency} onChange={set('agency')} />
          <TextField label="Contact name" value={draft.contactName} onChange={set('contactName')} />
          <TextField label="Contact email" type="email" value={draft.contactEmail} onChange={set('contactEmail')} />
          <TextField label="Sector" value={draft.sector} onChange={set('sector')} />
          <label className="field"><span>Service</span><select value={draft.service} onChange={e => set('service')(e.target.value)}><option value="">Not specified</option>{serviceNames.map(s => <option key={s}>{s}</option>)}</select></label>
          <label className="field"><span>Workflow stage</span><select value={draft.stage} onChange={e => set('stage')(e.target.value)}>{OPPORTUNITY_STAGES.map(s => <option key={s}>{s}</option>)}</select></label>
          <TextField label="Owner" value={draft.owner} onChange={set('owner')} />
          <TextField label="Estimated value (USD)" type="number" value={draft.value} onChange={set('value')} />
          <TextField label="Response deadline" type="date" value={draft.deadline} onChange={set('deadline')} />
          <TextField label="Next action" value={draft.nextAction} onChange={set('nextAction')} />
          <TextField label="Next-action due date" type="date" value={draft.nextActionDue ?? ''} onChange={set('nextActionDue')} />
          <TextField area label="Scope and notes" value={draft.notes} onChange={set('notes')} />
        </div>
        <Alert message={error} />
        <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Creating…' : 'Create opportunity'}</button></div>
      </form>
    </>}
  </section></div>;
}

// ── Follow-ups ──────────────────────────────────────────────────────────────

type Bucket = { items: FollowUpItem[]; total: number };
type FollowUpBuckets = { overdue: Bucket; dueToday: Bucket; unassigned: Bucket; awaitingConversion: Bucket; opportunitiesNeedingAction: Bucket };
export function FollowUpsView({ wf, onOpenInquiry, onOpenOpportunity, onConvert }: { wf: Workflow; onOpenInquiry: (id: string) => void; onOpenOpportunity: (id: string) => void; onConvert: (id: string) => void }) {
  const [show, setShow] = useState('Everything'), [owner, setOwner] = useState('Anyone'), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [queue, setQueue] = useState<FollowUpBuckets | null>(null), [loadError, setLoadError] = useState('');
  const data = wf.data;
  const { call, revision } = wf;
  const seq = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const params = new URLSearchParams({ kind: show === 'Requests' ? 'inquiry' : show === 'Opportunities' ? 'opportunity' : 'all', ...(owner === 'Anyone' ? {} : { owner: owner === 'Unassigned' ? 'none' : owner }) }).toString();
  useEffect(() => {
    const mine = ++seq.current;
    void call<FollowUpBuckets>(`/api/followups?${params}`).then(r => {
      if (mine !== seq.current) return; // a newer filter selection superseded this response
      if (r.ok) { setQueue(r.data); setLoadError(''); } else setLoadError(r.error);
    });
  }, [call, params, revision, attempt]);
  const load = () => setAttempt(a => a + 1);
  if (wf.state === 'loading' || wf.state === 'idle' || (!queue && !loadError)) return <section className="panel large-empty" aria-busy="true"><p className="muted">Loading follow-ups…</p></section>;
  if (wf.state === 'error' || !data || !queue) return <section className="panel large-empty"><Alert message={loadError || wf.error || 'Follow-ups could not be loaded.'} /><button className="button secondary" onClick={() => { void wf.reload(); void load(); }}><RefreshCw size={14} />Retry</button></section>;
  const owners = data.owners;
  const sections: [string, string, Bucket, string][] = [
    ['overdue', 'Overdue follow-ups', queue.overdue, 'Nothing is overdue.'],
    ['today', 'Due today', queue.dueToday, 'Nothing is due today.'],
    ['unassigned', 'Unassigned requests', queue.unassigned, 'Every open request has an owner.'],
    ['convert', 'Qualified — ready to convert', queue.awaitingConversion, 'No qualified requests are waiting.'],
    ['opportunities', 'Opportunities needing a next action', queue.opportunitiesNeedingAction, 'Every open opportunity has a current next action.'],
  ];
  const unread = data.notifications;
  async function complete(item: FollowUpItem) {
    setNotice(''); setError('');
    if (item.kind === 'inquiry') {
      const inquiry = await wf.fetchRecord('inquiry', item.id) as unknown as InquiryRecord | null;
      if (!inquiry) { setError('This request could not be loaded. Refresh and try again.'); return; }
      const r = await wf.patchInquiry(inquiry, { nextAction: '', nextActionDue: null });
      if (r.ok) setNotice(`Follow-up completed for ${item.title}.`); else setError(r.error);
    } else onOpenOpportunity(item.id);
  }
  return <div className="followups">
    <div className="notice"><Clock3 size={16} aria-hidden="true" /><span>Dates use Central Time ({data.businessTimeZone}). Today is {formatDue(data.today)}. Follow-ups appear here in the workspace only; no email reminders are sent.</span></div>
    <div>
    <div className="table-tools workflow-tools">
      <div className="filter-row">
        <select aria-label="Show" value={show} onChange={e => setShow(e.target.value)}>{['Everything', 'Requests', 'Opportunities'].map(s => <option key={s}>{s}</option>)}</select>
        <select aria-label="Filter by owner" value={owner} onChange={e => setOwner(e.target.value)}>{['Anyone', 'Unassigned', ...owners].map(s => <option key={s}>{s}</option>)}</select>
      </div>
      <button className="button secondary" onClick={() => void wf.reload()}><RefreshCw size={14} />Refresh</button>
    </div>
    <div aria-live="polite">{notice && <p className="success-line"><Check size={13} />{notice}</p>}</div>
    <Alert message={error || loadError} />
    </div>
    {data.openImportConflicts > 0 && <ImportConflictsPanel wf={wf} />}
    {unread.length > 0 && <section className="panel followup-section" aria-labelledby="fu-new">
      <div className="panel-heading"><h2 id="fu-new"><BellRing size={16} aria-hidden="true" /> New requests <span className="nav-count">{data.unreadNotifications}</span></h2><button className="text-button" onClick={() => void wf.markRead({ all: true })}>Mark all as read</button></div>
      <ul className="followup-list">{unread.map(n => <li key={n.id}><div><strong>{n.title}</strong><small>{new Date(n.createdAt).toLocaleString()} · in-app only (email {n.emailStatus})</small></div>
        <div className="row-actions">{n.subjectId && <button className="button secondary" onClick={() => { void wf.markRead({ ids: [n.id] }); onOpenInquiry(n.subjectId!); }}>Review</button>}</div></li>)}</ul>
      {data.unreadNotifications > unread.length && <p className="muted empty-row">Showing the newest {unread.length} of {data.unreadNotifications} unread notifications.</p>}
    </section>}
    {sections.map(([key, title, bucket, empty]) => { const list = bucket.items; return <section className="panel followup-section" key={key} aria-labelledby={`fu-${key}`}>
      <div className="panel-heading"><h2 id={`fu-${key}`}>{title} <span className="nav-count">{bucket.total}</span></h2></div>
      {list.length ? <ul className="followup-list">{list.map(item => <li key={item.kind + item.id}>
        <div><strong>{item.title}</strong><small>{item.kind === 'inquiry' ? 'Request' : 'Opportunity'} · {item.status} · {item.assignee || 'Unassigned'}</small>{item.nextAction && <span className="followup-action">{item.nextAction}</span>}<DueChip due={item.due} today={data.today} /></div>
        <div className="row-actions">
          {key === 'convert' ? <button className="button primary" onClick={() => onConvert(item.id)}>Convert</button>
            : <button className="button secondary" onClick={() => (item.kind === 'inquiry' ? onOpenInquiry(item.id) : onOpenOpportunity(item.id))}>Open</button>}
          {item.nextAction && item.kind === 'inquiry' && <button className="text-button" onClick={() => void complete(item)}><Check size={13} />Done</button>}
        </div></li>)}</ul> : <p className="muted empty-row">{empty}</p>}
      {bucket.total > list.length && <p className="muted empty-row">Showing the first {list.length} of {bucket.total}. Use the filters above, or the Client requests and Opportunities views, to see the rest.</p>}
    </section>; })}
    <section className="panel followup-section" aria-labelledby="fu-activity"><div className="panel-heading"><h2 id="fu-activity">Recent activity</h2></div><ActivityList items={data.activity.slice(0, 15)} empty="No activity recorded yet." /></section>
  </div>;
}

/** Count shown in navigation: overdue plus due-today follow-ups and rollback conflicts (server-computed). */
export function followUpCount(data: Summary | null) {
  return (data?.followUpsDue ?? 0) + (data?.openImportConflicts ?? 0);
}

type ImportConflict = { id: string; subjectType: string; subjectId: string; fields: string[]; legacyItem: Record<string, unknown>; current: Record<string, unknown>; version: number; createdAt: string };
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
/** Records edited in the legacy document during a rollback window. Nothing is applied without a decision. */
function ImportConflictsPanel({ wf }: { wf: Workflow }) {
  const [items, setItems] = useState<ImportConflict[]>([]), [total, setTotal] = useState(0), [reasons, setReasons] = useState<Record<string, string>>({}), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const { call, revision } = wf;
  useEffect(() => { void call<{ items: ImportConflict[]; total: number }>('/api/import-conflicts').then(r => { if (r.ok) { setItems(r.data.items); setTotal(r.data.total); } else setError(r.error); }); }, [call, revision]);
  async function decide(c: ImportConflict, decision: 'keep-current' | 'apply-legacy') {
    setError(''); setNotice('');
    const r = await wf.action('importConflict.resolve', { id: c.id, version: c.version, decision, reason: reasons[c.id] ?? '' });
    if (r.ok) setNotice(decision === 'apply-legacy' ? 'Legacy edit applied and recorded.' : 'Current record kept; the decision is recorded.'); else setError(r.error);
  }
  return <section className="panel followup-section" aria-labelledby="fu-conflicts">
    <div className="panel-heading"><h2 id="fu-conflicts">Rollback conflicts — decision required <span className="nav-count">{total}</span></h2></div>
    <p className="muted">These records were changed in the legacy workspace after they had moved to workflow records. The current values are kept until you decide. Each decision needs a reason and is recorded in activity.</p>
    <div aria-live="polite">{notice && <p className="success-line"><Check size={13} />{notice}</p>}</div>
    <Alert message={error} />
    <ul className="followup-list">{items.map(c => <li key={c.id}><div>
      <strong>{c.subjectType === 'inquiry' ? 'Request' : 'Opportunity'}: {show(c.current.organization ?? c.current.title ?? c.subjectId)}</strong>
      <table className="conflict-table"><thead><tr><th scope="col">Field</th><th scope="col">Current (kept)</th><th scope="col">Legacy edit</th></tr></thead>
        <tbody>{c.fields.map(f => <tr key={f}><th scope="row">{f}</th><td>{show(c.current[f])}</td><td>{show(c.legacyItem[f])}</td></tr>)}</tbody></table>
      <label className="field wide"><span>Reason for your decision *</span><textarea rows={2} maxLength={1000} value={reasons[c.id] ?? ''} onChange={e => setReasons(r => ({ ...r, [c.id]: e.target.value }))} /></label>
    </div><div className="row-actions">
      <button className="button secondary" disabled={!(reasons[c.id] ?? '').trim()} onClick={() => void decide(c, 'keep-current')}>Keep current</button>
      <button className="button primary" disabled={!(reasons[c.id] ?? '').trim()} onClick={() => void decide(c, 'apply-legacy')}>Apply legacy edit</button>
    </div></li>)}</ul>
    {total > items.length && <p className="muted empty-row">Showing {items.length} of {total}; decide these to see the rest.</p>}
  </section>;
}

/** Renders children once the inquiry is in the cache (fetching it by id when needed). */
export function WithInquiry({ wf, id, children }: { wf: Workflow; id: string; children: (inquiry: InquiryRecord) => React.ReactNode }) {
  const inquiry = wf.data?.inquiries.find(i => i.id === id);
  useEnsureRecords(wf, 'inquiry', [id]);
  return inquiry ? <>{children(inquiry)}</> : null;
}
