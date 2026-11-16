'use client';
// Workspace data layer. The server never sends the whole dataset on load:
//   • /api/workflow      small summary (counts, unread notifications, recent activity)
//   • /api/records/:type bounded, keyset-paginated pages (usePagedList)
//   • /api/context/...   one record plus the related records its detail view needs
// Loaded records are kept in a client cache keyed by id so detail views, dialogs and
// pickers can reuse them. After a change, the summary and the mounted views refetch.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityRecord, InquiryRecord, NotificationRecord, OpportunityRecord } from '../../lib/workflow';
import type { EvidenceLink, Values } from '../../lib/records';

export type AuthInfo = { mode: string; signInUrl?: string; signOutUrl?: string };
export type CallResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; body: Values };
export type Summary = {
  schema: 3; businessTimeZone: string; today: string; notifications: NotificationRecord[]; unreadNotifications: number; activity: ActivityRecord[];
  owners: string[]; opportunityStatusCounts: Record<string, number>; recentOpportunities: Pick<OpportunityRecord, 'id' | 'title' | 'agency' | 'stage' | 'status' | 'decision' | 'updatedAt'>[]; counts: Record<string, number>; followUpsDue: number; openImportConflicts: number;
};
type Store = { records: Record<string, Values[]>; inquiries: InquiryRecord[]; opportunities: OpportunityRecord[]; evidenceLinks: EvidenceLink[] };
export type WorkspaceData = Summary & Store;
export type Scope = { type: string; key: string; ids: string[] };
export type ContextPayload = {
  record: Values; records: Record<string, Values[]>; evidenceLinks: EvidenceLink[]; linkScopes: { subjectType: string; ids: string[] }[]; scopes: Scope[];
  totals: Record<string, number>; inquiries?: InquiryRecord[]; opportunities?: OpportunityRecord[]; activity?: ActivityRecord[];
};
export type Page = { items: Values[]; page: { limit: number; total: number; hasMore: boolean; nextCursor: string | null; sort: string } };
type Conversion = { inquiry: InquiryRecord; opportunity: OpportunityRecord; alreadyConverted: boolean };

const EMPTY: Store = { records: {}, inquiries: [], opportunities: [], evidenceLinks: [] };
const idOf = (x: object) => (x as { id?: unknown }).id;
function upsert<T extends object>(list: T[], items: T[]) {
  if (!Array.isArray(items) || !items.length) return list;
  const map = new Map(list.map(x => [idOf(x), x]));
  for (const item of items) map.set(idOf(item), item);
  return [...map.values()];
}
function mergeInto(store: Store, type: string, items: Values[]): Store {
  if (type === 'inquiry') return { ...store, inquiries: upsert(store.inquiries, items as unknown as InquiryRecord[]) };
  if (type === 'opportunity') return { ...store, opportunities: upsert(store.opportunities, items as unknown as OpportunityRecord[]) };
  return { ...store, records: { ...store.records, [type]: upsert(store.records[type] ?? [], items) } };
}
export const query = (params: Record<string, string | number | undefined | null>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();

export function useWorkflow(onAuthRequired: (auth: AuthInfo, message: string) => void) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [store, setStore] = useState<Store>(EMPTY);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; }, [store]);

  const call = useCallback(async <T,>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<CallResult<T>> => {
    let response: Response;
    try {
      response = await fetch(url, { method, signal, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { ok: false, status: -1, error: 'aborted', body: {} };
      return { ok: false, status: 0, error: 'Network error. Check your connection and try again.', body: {} };
    }
    // A body that cannot be read (aborted mid-body, or not JSON) is never reported as success:
    // an aborted read used to surface as { ok: true, data: {} } and crash the cache merge.
    let parsed: unknown = undefined, unreadable = false;
    try { parsed = await response.json(); } catch (e) { if ((e as Error)?.name === 'AbortError' || signal?.aborted) return { ok: false, status: -1, error: 'aborted', body: {} }; unreadable = true; }
    if (signal?.aborted) return { ok: false, status: -1, error: 'aborted', body: {} };
    const json = (parsed && typeof parsed === 'object' ? parsed : {}) as { error?: string; auth?: AuthInfo };
    if (response.ok && unreadable) return { ok: false, status: response.status, error: 'The server response could not be read. Please retry.', body: {} };
    if (json.auth && [401, 403].includes(response.status)) onAuthRequired(json.auth, response.status === 401 ? 'Your session has ended. Sign in again to continue; open dialogs keep your changes.' : json.error || 'This account cannot access the workspace.');
    return response.ok ? { ok: true, status: response.status, data: json as T } : { ok: false, status: response.status, error: json.error || 'Request failed. Please try again.', body: json as Values };
  }, [onAuthRequired]);

  const merge = useCallback((type: string, items: Values[]) => setStore(s => mergeInto(s, type, items)), []);
  const mergeContext = useCallback((type: string, ctx: ContextPayload) => setStore(s => {
    let next: Store = { ...s, records: { ...s.records } };
    for (const scope of ctx.scopes) next.records[scope.type] = (next.records[scope.type] ?? []).filter(r => !scope.ids.includes(String(r[scope.key])));
    for (const [t, items] of Object.entries(ctx.records)) next = mergeInto(next, t, items);
    if (ctx.inquiries) next = mergeInto(next, 'inquiry', ctx.inquiries as unknown as Values[]);
    if (ctx.opportunities) next = mergeInto(next, 'opportunity', ctx.opportunities as unknown as Values[]);
    next = mergeInto(next, type, [ctx.record]);
    const replaced = (l: EvidenceLink) => ctx.linkScopes.some(sc => sc.subjectType === l.subjectType && sc.ids.includes(l.subjectId));
    return { ...next, evidenceLinks: upsert(next.evidenceLinks.filter(l => !replaced(l)), ctx.evidenceLinks) };
  }), []);

  const mergeLinks = useCallback((links: EvidenceLink[], evidence: Values[], linkScopes: { subjectType: string; ids: string[] }[]) => setStore(s => {
    const next = mergeInto(s, 'evidence', evidence);
    const replaced = (l: EvidenceLink) => linkScopes.some(sc => sc.subjectType === l.subjectType && sc.ids.includes(l.subjectId));
    return { ...next, evidenceLinks: upsert(next.evidenceLinks.filter(l => !replaced(l)), links) };
  }), []);

  const reload = useCallback(async () => {
    setState(s => (s === 'ready' ? 'ready' : 'loading'));
    const result = await call<Summary>('/api/workflow');
    if (result.ok) { setSummary(result.data); setState('ready'); setError(''); setRevision(r => r + 1); }
    else if (![401, 403].includes(result.status)) { setError(result.error); setState(s => (s === 'ready' ? 'ready' : 'error')); }
    return result;
  }, [call]);

  /** Writes; on success (or a 409 conflict) the summary and every mounted view refetch. */
  const mutate = useCallback(async <T,>(url: string, method: string, body: unknown, type?: string) => {
    const result = await call<T>(url, method, body);
    if (result.ok && type) {
      const data = result.data as Record<string, unknown>;
      const record = (data.record ?? data[type]) as Values | undefined;
      if (record && typeof record === 'object' && 'id' in record) merge(type, [record]);
    }
    if (result.ok || result.status === 409) void reload();
    return result;
  }, [call, merge, reload]);

  const fetchRecord = useCallback(async (type: string, id: string): Promise<Values | null> => {
    const cached = type === 'inquiry' ? storeRef.current.inquiries.find(i => i.id === id) : type === 'opportunity' ? storeRef.current.opportunities.find(o => o.id === id) : storeRef.current.records[type]?.find(r => r.id === id);
    if (cached) return cached as unknown as Values;
    const r = await call<{ record: Values }>(`/api/records/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    merge(type, [r.data.record]);
    return r.data.record;
  }, [call, merge]);

  const data: WorkspaceData | null = useMemo(() => (summary ? { ...summary, ...store } : null), [summary, store]);
  return {
    data, state, error, revision, reload, call, merge, mergeContext, mergeLinks, fetchRecord,
    patchInquiry: (inquiry: InquiryRecord, changes: Record<string, unknown>) => mutate<{ inquiry: InquiryRecord }>(`/api/inquiries/${encodeURIComponent(inquiry.id)}`, 'PATCH', { version: inquiry.version, changes }, 'inquiry'),
    convert: (inquiry: InquiryRecord, opportunity: Record<string, unknown>) => mutate<Conversion>(`/api/inquiries/${encodeURIComponent(inquiry.id)}/convert`, 'POST', { version: inquiry.version, opportunity }, 'opportunity'),
    createOpportunity: (opportunity: Record<string, unknown>) => mutate<{ opportunity: OpportunityRecord }>('/api/opportunities', 'POST', { opportunity }, 'opportunity'),
    updateOpportunity: (id: string, version: number, changes: Record<string, unknown>) => mutate<{ opportunity: OpportunityRecord }>(`/api/opportunities/${encodeURIComponent(id)}`, 'PATCH', { version, changes }, 'opportunity'),
    markRead: (body: { ids: string[] } | { all: true }) => mutate<{ updated: number }>('/api/notifications', 'POST', body),
    createRecord: (type: string, record: Values, confirmDistinct = false) => mutate<{ record: Values; duplicates?: Values[] }>(`/api/records/${encodeURIComponent(type)}`, 'POST', { record, confirmDistinct }, type),
    updateRecord: (type: string, current: Values, changes: Values, confirmDistinct = false) => mutate<{ record: Values }>(`/api/records/${encodeURIComponent(type)}/${encodeURIComponent(String(current.id))}`, 'PATCH', { version: current.version, changes, confirmDistinct }, type),
    action: <T = Values,>(name: string, body: Values) => mutate<T>(`/api/actions/${encodeURIComponent(name)}`, 'POST', body),
  };
}
export type Workflow = ReturnType<typeof useWorkflow>;

/** Debounced copy of a value (search boxes). */
export function useDebounced<T>(value: T, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return debounced;
}

export type ListState = 'loading' | 'refreshing' | 'ready' | 'error';
/**
 * One server-paginated list. Search/filter/sort changes restart from the first page; responses
 * to superseded requests are discarded (sequence check + abort), so a slow earlier search can
 * never overwrite a newer one. After a workspace change the loaded window is refetched.
 */
export function usePagedList(wf: Workflow, type: string, params: { q?: string; filters?: Record<string, string | undefined>; sort?: string; limit?: number }, enabled = true) {
  const { call, merge, revision } = wf;
  const q = useDebounced(params.q?.trim() ?? '');
  const key = query({ q, sort: params.sort, limit: params.limit, ...(params.filters ?? {}) });
  const [ids, setIds] = useState<unknown[]>([]);
  const [meta, setMeta] = useState<{ total: number; hasMore: boolean; cursor: string | null; forKey: string }>({ total: 0, hasMore: false, cursor: null, forKey: '' });
  const [state, setState] = useState<ListState>('loading');
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0), loaded = useRef(0), abort = useRef<AbortController | null>(null), lastKey = useRef('');
  const fetchFirst = useCallback(async (keepWindow: boolean) => {
    const mine = ++seq.current;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setState(s => (s === 'ready' || s === 'refreshing' ? 'refreshing' : 'loading')); setError('');
    const base = new URLSearchParams(key);
    const limit = Number(base.get('limit') ?? 25);
    if (keepWindow && loaded.current > limit) base.set('limit', String(Math.min(100, loaded.current)));
    const r = await call<Page>(`/api/records/${encodeURIComponent(type)}?${base.toString()}`, 'GET', undefined, controller.signal);
    if (mine !== seq.current || r.status === -1) return;
    if (r.ok && !Array.isArray(r.data?.items)) { setError('The list response was incomplete. Please retry.'); setState('error'); return; }
    if (!r.ok) { setError(r.error); setState('error'); return; }
    merge(type, r.data.items);
    loaded.current = r.data.items.length;
    setIds(r.data.items.map(i => i.id));
    setMeta({ total: r.data.page.total, hasMore: r.data.page.hasMore, cursor: r.data.page.nextCursor, forKey: key });
    setState('ready');
  }, [call, merge, type, key]);
  useEffect(() => {
    if (!enabled) return;
    const sameQuery = lastKey.current === key; lastKey.current = key;
    void fetchFirst(sameQuery);
  }, [fetchFirst, key, revision, enabled]);
  // On unmount: invalidate in-flight responses, then abort them.
  useEffect(() => () => { seq.current++; abort.current?.abort(); }, []);
  const loadMore = useCallback(async () => {
    if (!meta.cursor || loadingMore) return;
    const mine = seq.current;
    setLoadingMore(true); setError('');
    const r = await call<Page>(`/api/records/${encodeURIComponent(type)}?${key}${key ? '&' : ''}cursor=${encodeURIComponent(meta.cursor)}`);
    setLoadingMore(false);
    if (mine !== seq.current || r.status === -1) return;
    if (r.ok && !Array.isArray(r.data?.items)) { setError('The list response was incomplete. Please retry.'); return; }
    if (!r.ok) {
      if (['stale_cursor', 'invalid_cursor'].includes(String(r.body.code))) { void fetchFirst(false); return; }
      setError(r.error); return;
    }
    merge(type, r.data.items);
    setIds(prev => { const next = [...prev, ...r.data.items.map(i => i.id).filter(id => !prev.includes(id))]; loaded.current = next.length; return next; });
    setMeta(m => ({ ...m, total: r.data.page.total, hasMore: r.data.page.hasMore, cursor: r.data.page.nextCursor }));
  }, [call, merge, type, key, meta.cursor, loadingMore, fetchFirst]);
  const source = type === 'inquiry' ? wf.data?.inquiries : type === 'opportunity' ? wf.data?.opportunities : wf.data?.records[type];
  const items = useMemo(() => { const byId = new Map((source as unknown as Values[] | undefined ?? []).map(r => [r.id, r])); return ids.map(id => byId.get(id)).filter(Boolean) as Values[]; }, [ids, source]);
  return { items, total: meta.total, hasMore: meta.hasMore, state, error, loadingMore, loadMore, retry: () => void fetchFirst(false), searching: q !== (params.q?.trim() ?? '') || state === 'refreshing' };
}
export type PagedList = ReturnType<typeof usePagedList>;

/** Loads a detail view's context (record + related records) and refreshes it after changes. */
export function useRecordContext(wf: Workflow, type: string, id: string | null) {
  const { call, mergeContext, revision } = wf;
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<ContextPayload | null>(null);
  const seq = useRef(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id) return;
    const mine = ++seq.current;
    void call<ContextPayload>(`/api/context/${encodeURIComponent(type)}/${encodeURIComponent(id)}`).then(r => {
      if (mine !== seq.current) return; // superseded by a newer request
      if (r.ok) { mergeContext(type, r.data); setPayload(r.data); setState('ready'); setError(''); }
      else if (r.status === 404) setState('missing');
      else { setError(r.error); setState(s => (s === 'ready' ? 'ready' : 'error')); }
    });
  }, [call, mergeContext, type, id, revision, attempt]);
  return { state, error, totals: payload?.totals ?? {}, activity: payload?.activity ?? [], retry: () => setAttempt(a => a + 1) };
}

/** Ensures the given ids of a type are in the cache (one bounded request per 100 missing ids). */
export function useEnsureRecords(wf: Workflow, type: string, ids: unknown[]) {
  const { call, merge } = wf;
  const requested = useRef(new Set<string>());
  const source = type === 'inquiry' ? wf.data?.inquiries : type === 'opportunity' ? wf.data?.opportunities : wf.data?.records[type];
  const have = useMemo(() => new Set((source as unknown as Values[] | undefined ?? []).map(r => String(r.id))), [source]);
  const wanted = [...new Set(ids.filter((v): v is string => typeof v === 'string' && v.length > 0))].filter(id => !have.has(id)).join(',');
  useEffect(() => {
    const list = wanted.split(',').filter(id => id && !requested.current.has(id)); // never re-request an id
    if (!list.length) return;
    list.forEach(id => requested.current.add(id));
    for (let i = 0; i < list.length; i += 100) {
      void call<Page>(`/api/records/${encodeURIComponent(type)}?ids=${encodeURIComponent(list.slice(i, i + 100).join(','))}`).then(r => { if (r.ok && Array.isArray(r.data?.items)) merge(type, r.data.items); });
    }
  }, [wanted, type, call, merge]);
}

/** Loads evidence links for the records on a list page (one request per page, ≤ 100 ids). */
export function useSubjectLinks(wf: Workflow, subjectType: string, ids: unknown[]) {
  const { call, mergeLinks, revision } = wf;
  const key = ids.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, 100).join(',');
  useEffect(() => {
    if (!key) return;
    void call<{ links: EvidenceLink[]; evidence: Values[]; linkScopes: { subjectType: string; ids: string[] }[] }>(`/api/evidence-links?${query({ subjectType, ids: key })}`)
      .then(r => { if (r.ok) mergeLinks(r.data.links, r.data.evidence, r.data.linkScopes); });
  }, [call, mergeLinks, subjectType, key, revision]);
}
