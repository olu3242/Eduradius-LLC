// Bounded, keyset-paginated listing for workspace records. Server-only.
//
// Contract (GET /api/records/:type):
//   limit   1..MAX_LIMIT (default DEFAULT_LIMIT)
//   sort    one of the type's allowlisted sorts (default "created": newest first)
//   q       up to 5 whitespace-separated terms (each must match one allowlisted text column)
//   cursor  opaque token from the previous page; bound to the type, sort, q and filters
//   ids     comma-separated ids (≤ MAX_IDS) for resolving references; ignores cursor/limit
//   <filter>=<value>  allowlisted equality filters (enum values are validated)
// Every value is bound as a parameter; only allowlisted column names reach the SQL text.
import { SPECS, type Values } from '../records';
import { businessDate, INQUIRY_STATUSES, OPPORTUNITY_STAGES, OPPORTUNITY_DECISIONS, OPPORTUNITY_STATUSES, CLOSED_INQUIRY_STATUSES } from '../workflow';
import { db, toRecord } from './records-store';
import { INQUIRY_SELECT, OPPORTUNITY_SELECT, toInquiry, toOpportunity } from './workflow-store';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
export const MAX_IDS = 100;
export const MAX_QUERY_LENGTH = 100;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

type Row = Record<string, unknown>;
type Filter = { sql: (bind: (v: unknown) => string, value: string) => string; values?: readonly string[]; id?: boolean };
type Sort = { expr: string; dir: 'ASC' | 'DESC' };
type ListType = {
  table: string; select: string; map: (row: Row) => Values; search: string[];
  filters: Record<string, Filter>; sorts: Record<string, Sort>; annotate?: string[];
};
export type ListParams = { limit: number; sort: string; q: string; terms: string[]; filters: Record<string, string>; cursor: Cursor | null; ids: string[] | null };
type Cursor = { k: [string | number, string] };
export type ListResult = { items: Values[]; page: { limit: number; total: number; hasMore: boolean; nextCursor: string | null; sort: string } };
export type ListErrorCode = 'invalid_parameter' | 'invalid_cursor' | 'stale_cursor' | 'unknown_type';
export class ListError extends Error {
  code: ListErrorCode;
  constructor(message: string, code: ListErrorCode) { super(message); this.code = code; }
}

const eq = (column: string, values?: readonly string[]): Filter => ({ sql: (bind, v) => `t.${column} = ${bind(v)}`, values });
const refEq = (column: string): Filter => ({ sql: (bind, v) => (v === 'none' ? `t.${column} IS NULL` : `t.${column} = ${bind(v)}`), id: true });
const person = (column: string): Filter => ({ sql: (bind, v) => (v === 'none' ? `t.${column} = ''` : `t.${column} = ${bind(v)}`) });
const bool = (column: string): Filter => ({ sql: (_bind, v) => `t.${column} = ${v === 'true' ? 1 : 0}`, values: ['true', 'false'] });
const BASE_SORTS = (titleExpr: string | null, dueColumn: string | null): Record<string, Sort> => ({
  created: { expr: 't.created_at', dir: 'DESC' },
  oldest: { expr: 't.created_at', dir: 'ASC' },
  updated: { expr: 't.updated_at', dir: 'DESC' },
  ...(titleExpr ? { title: { expr: titleExpr, dir: 'ASC' as const } } : {}),
  ...(dueColumn ? { due: { expr: `COALESCE(t.${dueColumn}, '9999-12-31')`, dir: 'ASC' as const } } : {}),
});

/** Explicit per-type configuration: search columns, sorts and computed annotations. */
const SEARCH: Record<string, string[]> = {
  organization: ['name', 'website', 'relationship_owner', 'org_type'], contact: ['name', 'email', 'role'], requirement: ['description', 'owner'],
  evidence: ['title', 'category', 'owner', 'location'], proposalTemplate: ['name'], proposal: ['title', 'owner'], submission: ['reference'],
  teamingPartner: ['work_package', 'relationship_owner'], project: ['title', 'owner'], milestone: ['title', 'owner'], deliverable: ['title', 'owner'],
  projectLog: ['title', 'owner'], changeRequest: ['title'], experience: ['title', 'client_label'],
};
const DUE: Record<string, string> = { requirement: 'due_date', evidence: 'review_date', teamingPartner: 'next_action_due', project: 'planned_end_date', milestone: 'planned_date', deliverable: 'due_date', projectLog: 'due_date' };
const ANNOTATE: Record<string, string[]> = {
  organization: [
    "(SELECT COUNT(*) FROM contacts c WHERE c.organization_id = t.id AND c.status = 'Active') AS _contacts",
    '((SELECT COUNT(*) FROM inquiries i WHERE i.organization_id = t.id) + (SELECT COUNT(*) FROM opportunities o WHERE o.organization_id = t.id)) AS _related',
  ],
  contact: ['(SELECT name FROM organizations o WHERE o.id = t.organization_id) AS _organizationName'],
  evidence: ['(SELECT group_concat(DISTINCT subject_type) FROM evidence_links l WHERE l.evidence_id = t.id) AS _linkedTypes'],
  project: [
    '(SELECT name FROM organizations o WHERE o.id = t.client_organization_id) AS _clientName',
    '(SELECT COUNT(*) FROM milestones m WHERE m.project_id = t.id) AS _milestones',
    "(SELECT COUNT(*) FROM milestones m WHERE m.project_id = t.id AND m.status = 'Complete') AS _milestonesComplete",
    '(SELECT COUNT(*) FROM deliverables d WHERE d.project_id = t.id) AS _deliverables',
    "(SELECT COUNT(*) FROM deliverables d WHERE d.project_id = t.id AND d.status = 'Accepted') AS _deliverablesAccepted",
  ],
};

function specType(type: string): ListType {
  const spec = SPECS[type];
  const filters: Record<string, Filter> = {};
  for (const field of spec.fields) {
    if (field.kind === 'enum') filters[field.key] = eq(field.column, field.options);
    else if (field.kind === 'ref') filters[field.key] = refEq(field.column);
    else if (field.kind === 'bool') filters[field.key] = bool(field.column);
  }
  const titleField = spec.fields.find(f => f.key === spec.titleKey);
  const titleExpr = titleField ? (titleField.kind === 'int' ? `t.${titleField.column}` : `lower(t.${titleField.column})`) : null;
  return { table: spec.table, select: 't.*', map: row => toRecord(spec, row), search: SEARCH[type] ?? [], filters, sorts: BASE_SORTS(titleExpr, DUE[type] ?? null), annotate: ANNOTATE[type] };
}

const LIST_TYPES: Record<string, ListType> = Object.fromEntries(Object.keys(SPECS).map(type => [type, specType(type)]));
const prefixed = (columns: string) => columns.split(', ').map(c => `t.${c}`).join(', ');
LIST_TYPES.inquiry = {
  table: 'inquiries', select: prefixed(INQUIRY_SELECT), map: toInquiry as (row: Row) => Values, search: ['organization', 'name', 'email', 'scope', 'assignee'],
  filters: {
    status: eq('status', INQUIRY_STATUSES), kind: eq('kind'), organizationId: refEq('organization_id'), assignee: person('assignee'),
    open: { sql: (_b, v) => `t.status ${v === 'true' ? 'NOT IN' : 'IN'} (${CLOSED_INQUIRY_STATUSES.map(s => `'${s}'`).join(', ')})`, values: ['true', 'false'] },
  },
  sorts: BASE_SORTS('lower(t.organization)', 'next_action_due'),
};
LIST_TYPES.opportunity = {
  table: 'opportunities', select: prefixed(OPPORTUNITY_SELECT), map: toOpportunity as (row: Row) => Values, search: ['title', 'agency', 'naics', 'psc', 'owner'],
  filters: {
    stage: eq('stage', OPPORTUNITY_STAGES), decision: eq('decision', OPPORTUNITY_DECISIONS), status: eq('status', OPPORTUNITY_STATUSES), organizationId: refEq('organization_id'), owner: person('owner'),
    open: { sql: (_b, v) => `t.stage ${v === 'true' ? '<>' : '='} 'Closed'`, values: ['true', 'false'] },
  },
  sorts: BASE_SORTS('lower(t.title)', 'next_action_due'),
};
LIST_TYPES.project.filters.open = { sql: (_b, v) => `t.status ${v === 'true' ? 'NOT IN' : 'IN'} ('Closed', 'Cancelled')`, values: ['true', 'false'] };
// Evidence state is computed against the business date, mirroring evidenceState() in lib/records.ts.
LIST_TYPES.evidence.filters.state = {
  values: ['current', 'unreviewed', 'expired', 'rejected', 'usable'],
  sql: (bind, v) => {
    // Bind the date only for the states that use it: every bound value must have a placeholder.
    const rejected = "t.review_status IN ('Rejected', 'Superseded')";
    if (v === 'rejected') return rejected;
    if (v === 'usable') return `NOT ${rejected}`;
    const expired = `(t.review_date IS NOT NULL AND t.review_date < ${bind(businessDate())})`;
    return { expired: `NOT ${rejected} AND ${expired}`, current: `NOT ${rejected} AND NOT ${expired} AND t.review_status = 'Verified'`, unreviewed: `NOT ${rejected} AND NOT ${expired} AND t.review_status <> 'Verified'` }[v]!;
  },
};

export const listTypes = () => Object.keys(LIST_TYPES);
const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
const fingerprint = (type: string, p: Pick<ListParams, 'sort' | 'q' | 'filters'>) => fnv(JSON.stringify([type, p.sort, p.q, Object.entries(p.filters).sort()]));
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)));

/** Validates query parameters against the type's allowlists. Throws ListError (→ 400). */
export function parseListParams(type: string, search: URLSearchParams): ListParams {
  if (!Object.hasOwn(LIST_TYPES, type)) throw new ListError('Unknown record type.', 'unknown_type');
  const config = LIST_TYPES[type];
  const filters: Record<string, string> = {};
  let limit = DEFAULT_LIMIT, sort = 'created', q = '', cursorToken: string | null = null, ids: string[] | null = null;
  for (const [key, value] of search) {
    if (key === 'limit') {
      if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > MAX_LIMIT) throw new ListError(`limit must be a whole number from 1 to ${MAX_LIMIT}.`, 'invalid_parameter');
      limit = Number(value);
    } else if (key === 'sort') {
      if (!Object.hasOwn(config.sorts, value)) throw new ListError(`sort must be one of: ${Object.keys(config.sorts).join(', ')}.`, 'invalid_parameter');
      sort = value;
    } else if (key === 'q') {
      if (value.length > MAX_QUERY_LENGTH) throw new ListError(`Search text is limited to ${MAX_QUERY_LENGTH} characters.`, 'invalid_parameter');
      if (!config.search.length && value.trim()) throw new ListError('This list does not support search.', 'invalid_parameter');
      q = value.trim().replace(/\s+/g, ' ');
    } else if (key === 'cursor') cursorToken = value;
    else if (key === 'ids') {
      const list = value.split(',').filter(Boolean);
      if (list.length > MAX_IDS || !list.every(id => ID_PATTERN.test(id))) throw new ListError(`ids must be up to ${MAX_IDS} valid identifiers.`, 'invalid_parameter');
      ids = [...new Set(list)];
    } else if (Object.hasOwn(config.filters, key)) {
      const filter = config.filters[key];
      if (key in filters) throw new ListError(`${key} may be given once.`, 'invalid_parameter');
      if (filter.values && !filter.values.includes(value)) throw new ListError(`${key} has an unsupported value.`, 'invalid_parameter');
      if (filter.id && value !== 'none' && !ID_PATTERN.test(value)) throw new ListError(`${key} must be a record id or "none".`, 'invalid_parameter');
      if (!filter.values && !filter.id && value.length > 100) throw new ListError(`${key} is too long.`, 'invalid_parameter');
      filters[key] = value;
    } else throw new ListError(`Unsupported parameter: ${key.slice(0, 40)}.`, 'invalid_parameter');
  }
  const terms = q ? q.split(' ').slice(0, 5) : [];
  let cursor: Cursor | null = null;
  if (cursorToken !== null) {
    let parsed: unknown;
    try { parsed = JSON.parse(unb64(cursorToken)); } catch { throw new ListError('The page cursor is invalid. Reload the list.', 'invalid_cursor'); }
    const c = parsed as { k?: unknown; s?: unknown; h?: unknown };
    if (!c || !Array.isArray(c.k) || c.k.length !== 2 || !['string', 'number'].includes(typeof c.k[0]) || typeof c.k[1] !== 'string' || typeof c.h !== 'string') throw new ListError('The page cursor is invalid. Reload the list.', 'invalid_cursor');
    if (c.s !== sort || c.h !== fingerprint(type, { sort, q, filters })) throw new ListError('The search, filters or sort changed since this page was loaded. Reload the list.', 'stale_cursor');
    cursor = { k: c.k as [string | number, string] };
  }
  return { limit, sort, q, terms, filters, cursor, ids };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => '\\' + m);

/** One page plus the total match count, read in a single D1 batch (one consistent snapshot). */
export async function listPage(type: string, params: ListParams): Promise<ListResult> {
  const config = LIST_TYPES[type];
  const args: unknown[] = [];
  const bind = (v: unknown) => { args.push(v); return '?'; };
  const where: string[] = [];
  for (const [key, value] of Object.entries(params.filters)) where.push(config.filters[key].sql(bind, value));
  for (const term of params.terms) where.push(`(${config.search.map(c => `t.${c} LIKE ${bind(`%${escapeLike(term)}%`)} ESCAPE '\\'`).join(' OR ')})`);
  if (params.ids) where.push(`t.id IN (${params.ids.map(id => bind(id)).join(', ')})`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countArgs = [...args];
  const sort = config.sorts[params.sort];
  const op = sort.dir === 'DESC' ? '<' : '>';
  const pageWhere = params.cursor && !params.ids ? `${whereSql ? `${whereSql} AND` : 'WHERE'} (${sort.expr}, t.id) ${op} (${bind(params.cursor.k[0])}, ${bind(params.cursor.k[1])})` : whereSql;
  const limit = params.ids ? params.ids.length : params.limit;
  const columns = [config.select, `${sort.expr} AS _sortKey`, ...(config.annotate ?? [])].join(', ');
  const pageSql = `SELECT ${columns} FROM ${config.table} t ${pageWhere} ORDER BY ${sort.expr} ${sort.dir}, t.id ${sort.dir} LIMIT ${limit + 1}`;
  const [page, count] = await db().batch([
    db().prepare(pageSql).bind(...args),
    db().prepare(`SELECT COUNT(*) AS n FROM ${config.table} t ${whereSql}`).bind(...countArgs),
  ]);
  const rows = (page.results as Row[]);
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const items = visible.map(row => {
    const item = config.map(row);
    for (const [k, v] of Object.entries(row)) if (k.startsWith('_') && k !== '_sortKey') item[k] = k === '_linkedTypes' ? (v ? String(v).split(',') : []) : v;
    return item;
  });
  const last = visible[visible.length - 1];
  const nextCursor = hasMore && last ? b64(JSON.stringify({ k: [last._sortKey as string | number, String(last.id)], s: params.sort, h: fingerprint(type, params) })) : null;
  return { items, page: { limit, total: Number((count.results as Row[])[0].n), hasMore, nextCursor, sort: params.sort } };
}

/** The allowlisted sorts and filters per type (used by tests and documentation). */
export function listCapabilities() {
  return Object.fromEntries(Object.entries(LIST_TYPES).map(([type, c]) => [type, {
    search: c.search, sorts: Object.keys(c.sorts),
    filters: Object.fromEntries(Object.entries(c.filters).map(([k, f]) => [k, f.values ?? (f.id ? 'id' : 'text')])),
  }]));
}
