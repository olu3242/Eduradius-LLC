'use client';
// Shared UI for server-paginated lists and bounded, searchable reference pickers.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import type { Values } from '../../lib/records';
import { usePagedList, useEnsureRecords, type PagedList, type Workflow } from './data';

const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
export const recordLabel = (r: Values | undefined | null) => (r ? str(r.name ?? r.title ?? r.description ?? r.id) : '');
export function cached(wf: Workflow, type: string, id: unknown): Values | undefined {
  if (!id) return undefined;
  const list = type === 'inquiry' ? wf.data?.inquiries : type === 'opportunity' ? wf.data?.opportunities : wf.data?.records[type];
  return (list as unknown as Values[] | undefined)?.find(r => r.id === id);
}

/** Result count, errors with retry, and "Load more" for a paged list. */
export function ListFooter({ list, noun }: { list: PagedList; noun: string }) {
  const countRef = useRef<HTMLParagraphElement>(null);
  const hadMore = useRef(list.hasMore);
  useEffect(() => {
    // The "Load more" button disappears after the last page; keep keyboard focus nearby.
    if (hadMore.current && !list.hasMore && document.activeElement === document.body) countRef.current?.focus();
    hadMore.current = list.hasMore;
  }, [list.hasMore]);
  return <div className="list-footer">
    <p ref={countRef} tabIndex={-1} className="muted result-count" aria-live="polite">
      {list.state === 'loading' ? `Loading ${noun}…` : `Showing ${list.items.length} of ${list.total} ${noun}`}{list.searching && list.state !== 'loading' ? ' · updating…' : ''}
    </p>
    {list.error && <div className="list-error" role="alert"><p className="error">{list.error}</p><button className="button secondary" onClick={list.retry}><RefreshCw size={14} />Retry</button></div>}
    {list.hasMore && <button className="button secondary load-more" disabled={list.loadingMore} onClick={() => void list.loadMore()}>{list.loadingMore ? 'Loading…' : `Load more ${noun}`}</button>}
  </div>;
}

/** First-load, error and empty states shared by paged list views. */
export function ListGate({ list, noun, empty, filtered, onClear, children }: { list: PagedList; noun: string; empty: ReactNode; filtered: boolean; onClear?: () => void; children: ReactNode }) {
  if (list.state === 'loading') return <section className="panel large-empty" aria-busy="true"><p className="muted">Loading {noun}…</p></section>;
  if (list.state === 'error' && !list.items.length) return <section className="panel large-empty"><p className="error" role="alert">{list.error}</p><button className="button secondary" onClick={list.retry}><RefreshCw size={14} />Retry</button></section>;
  if (!list.items.length && !filtered) return <>{empty}</>;
  if (!list.items.length) return <section className="panel large-empty"><h2>No {noun} match these filters.</h2>{onClear && <button className="button secondary" onClick={onClear}>Clear filters</button>}</section>;
  return <div aria-busy={list.state === 'refreshing'}>{children}</div>;
}

/**
 * Searchable reference picker: a search box plus a native select holding at most 20 matches
 * (and the current value), so relationships can be chosen beyond the first loaded page
 * without loading every record. Keyboard and screen-reader behaviour is the native select's.
 */
export function RefPicker({ wf, type, value, onChange, label, filters, exclude = [], labelOf = recordLabel, placeholder = 'None', required, hint, wide, ariaLabel }: {
  wf: Workflow; type: string; value: string | null | undefined; onChange: (id: string | null) => void; label: string; filters?: Record<string, string | undefined>;
  exclude?: string[]; labelOf?: (r: Values) => string; placeholder?: string; required?: boolean; hint?: string; wide?: boolean; ariaLabel?: string;
}) {
  const [q, setQ] = useState(''), [active, setActive] = useState(false);
  // Choices load only once the picker is used, so a view with many pickers makes no requests up front.
  const list = usePagedList(wf, type, { q, filters, sort: 'title', limit: 20 }, active);
  useEnsureRecords(wf, type, [value]);
  const current = value ? cached(wf, type, value) : undefined;
  const options = list.items.filter(o => o.id !== value && !exclude.includes(str(o.id)));
  const labelId = useId(), statusId = useId(), hintId = useId();
  const status = !active ? 'Focus or type to search choices.' : list.state === 'loading' ? 'Loading choices…' : list.error ? list.error : list.total > list.items.length ? `Showing ${list.items.length} of ${list.total}; type to narrow.` : list.total ? `${list.total} ${list.total === 1 ? 'choice' : 'choices'}` : q ? 'No matches.' : 'Nothing to choose yet.';
  return <div className={'field ref-picker' + (wide ? ' wide' : '')} onFocus={() => setActive(true)} onPointerDown={() => setActive(true)}>
    <span id={labelId}>{label}{required ? ' *' : ''}</span>
    <input type="search" className="ref-search" aria-label="Search choices" aria-describedby={`${labelId} ${statusId}`} placeholder="Type to search…" value={q} onChange={e => setQ(e.target.value)} />
    <select aria-label={ariaLabel ?? label} aria-describedby={[statusId, hint ? hintId : ''].filter(Boolean).join(' ')} value={value ?? ''} required={required} onChange={e => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {value && <option value={value}>{current ? labelOf(current) : 'Loading…'}</option>}
      {active && options.map(o => <option key={str(o.id)} value={str(o.id)}>{labelOf(o)}</option>)}
    </select>
    <small id={statusId} className="field-hint" aria-live="polite">{status}</small>
    {hint && <small id={hintId} className="field-hint" aria-hidden="true">{hint}</small>}
  </div>;
}
