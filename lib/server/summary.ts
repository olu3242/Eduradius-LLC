// Workspace summary (GET /api/workflow) and follow-up queue (GET /api/followups). Server-only.
// Both are bounded: counts come from SQL aggregates; lists are capped and report their totals.
import { SPECS } from '../records';
import { BUSINESS_TIME_ZONE, businessDate, CLOSED_INQUIRY_STATUSES, dueState, OPPORTUNITY_STATUSES, type FollowUpItem } from '../workflow';
import { db } from './records-store';

type Row = Record<string, unknown>;
export const FOLLOW_UP_LIMIT = 100;
const CLOSED = CLOSED_INQUIRY_STATUSES.map(s => `'${s}'`).join(', ');
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export type FollowUpFilter = { kind: 'all' | 'inquiry' | 'opportunity'; owner: string | null };
export type Bucket = { items: FollowUpItem[]; total: number };
export type FollowUps = { overdue: Bucket; dueToday: Bucket; unassigned: Bucket; awaitingConversion: Bucket; opportunitiesNeedingAction: Bucket };

const INQ = `SELECT 'inquiry' AS kind, id, CASE WHEN organization <> '' THEN organization ELSE name END AS title, status, assignee, next_action, next_action_due, created_at FROM inquiries`;
const OPP = `SELECT 'opportunity' AS kind, id, title, stage AS status, owner AS assignee, next_action, next_action_due, created_at FROM opportunities`;
const BY_DUE = "ORDER BY COALESCE(next_action_due, '9999-12-31'), lower(title), id";

/** Follow-up buckets (same rules as followUpQueue in lib/workflow.ts), computed in SQL. */
export async function followUps(filter: FollowUpFilter, today = businessDate(), limit = FOLLOW_UP_LIMIT): Promise<FollowUps> {
  const owner = (column: string) => (filter.owner === null ? { sql: '', args: [] as unknown[] } : filter.owner === 'none' ? { sql: ` AND ${column} = ''`, args: [] } : { sql: ` AND ${column} = ?`, args: [filter.owner] });
  const inqOwner = owner('assignee'), oppOwner = owner('owner');
  const parts = (inqWhere: string, inqArgs: unknown[], oppWhere: string | null, oppArgs: unknown[], order: string) => {
    const pieces: string[] = [], args: unknown[] = [];
    if (filter.kind !== 'opportunity' && inqWhere) { pieces.push(`${INQ} WHERE status NOT IN (${CLOSED}) AND ${inqWhere}${inqOwner.sql}`); args.push(...inqArgs, ...inqOwner.args); }
    if (filter.kind !== 'inquiry' && oppWhere) { pieces.push(`${OPP} WHERE stage <> 'Closed' AND ${oppWhere}${oppOwner.sql}`); args.push(...oppArgs, ...oppOwner.args); }
    if (!pieces.length) return null;
    const union = pieces.join(' UNION ALL ');
    return [db().prepare(`SELECT * FROM (${union}) ${order} LIMIT ${limit}`).bind(...args), db().prepare(`SELECT COUNT(*) AS n FROM (${union})`).bind(...args)];
  };
  const specs: [keyof FollowUps, ReturnType<typeof parts>][] = [
    ['overdue', parts("next_action <> '' AND next_action_due IS NOT NULL AND next_action_due < ?", [today], "next_action <> '' AND next_action_due IS NOT NULL AND next_action_due < ?", [today], BY_DUE)],
    ['dueToday', parts("next_action <> '' AND next_action_due = ?", [today], "next_action <> '' AND next_action_due = ?", [today], BY_DUE)],
    ['unassigned', filter.owner && filter.owner !== 'none' ? null : parts("assignee = ''", [], null, [], 'ORDER BY created_at DESC, id DESC')],
    ['awaitingConversion', parts("status = 'Qualified' AND opportunity_id IS NULL", [], null, [], 'ORDER BY created_at DESC, id DESC')],
    ['opportunitiesNeedingAction', parts('', [], "(next_action = '' OR (next_action_due IS NOT NULL AND next_action_due < ?))", [today], BY_DUE)],
  ];
  const statements = specs.flatMap(([, st]) => st ?? []);
  const results = statements.length ? await db().batch(statements) : [];
  const out = {} as FollowUps;
  let i = 0;
  for (const [key, st] of specs) {
    if (!st) { out[key] = { items: [], total: 0 }; continue; }
    const rows = results[i++].results as Row[], total = Number((results[i++].results as Row[])[0].n);
    out[key] = {
      total,
      items: rows.map(r => ({ kind: s(r.kind) as FollowUpItem['kind'], id: s(r.id), title: s(r.title), status: s(r.status), assignee: s(r.assignee), nextAction: s(r.next_action), due: (r.next_action_due as string | null) ?? null, dueState: dueState((r.next_action_due as string | null) ?? null, today) })),
    };
  }
  return out;
}

const toNotification = (r: Row) => ({ id: s(r.id), kind: s(r.kind), subjectType: s(r.subject_type), subjectId: (r.subject_id as string | null) ?? null, title: s(r.title), createdAt: s(r.created_at), readAt: (r.read_at as string | null) ?? null, emailStatus: s(r.email_status) });
const toActivity = (r: Row) => {
  let details: Record<string, unknown> = {};
  try { details = JSON.parse(s(r.details)); } catch { /* keep empty */ }
  return { id: s(r.id), occurredAt: s(r.occurred_at), actor: s(r.actor), type: s(r.type), subjectType: s(r.subject_type), subjectId: (r.subject_id as string | null) ?? null, summary: s(r.summary), details };
};

/** Small, bounded payload loaded on every workspace view. Contains no record collections. */
export async function workspaceSummary() {
  const today = businessDate();
  const tables: [string, string][] = [['inquiry', 'inquiries'], ['opportunity', 'opportunities'], ...Object.entries(SPECS).map(([type, spec]) => [type, spec.table] as [string, string])];
  const statements = [
    db().prepare('SELECT id, kind, subject_type, subject_id, title, created_at, read_at, email_status FROM notifications WHERE read_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 50'),
    db().prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL'),
    db().prepare('SELECT id, occurred_at, actor, type, subject_type, subject_id, summary, details FROM activity_events ORDER BY occurred_at DESC, rowid DESC LIMIT 20'),
    db().prepare("SELECT owner FROM (SELECT assignee AS owner FROM inquiries WHERE assignee <> '' UNION SELECT owner FROM opportunities WHERE owner <> '') ORDER BY lower(owner) LIMIT 100"),
    db().prepare('SELECT status, COUNT(*) AS n FROM opportunities GROUP BY status'),
    db().prepare('SELECT id, title, agency, stage, status, decision, updated_at FROM opportunities ORDER BY updated_at DESC, id DESC LIMIT 5'),
    db().prepare(`SELECT ${tables.map(([type, table]) => `(SELECT COUNT(*) FROM ${table}) AS "${type}"`).join(', ')}`),
  ];
  const [notifications, unread, activity, owners, oppStatus, recent, counts] = await db().batch(statements);
  const queue = await followUps({ kind: 'all', owner: null }, today, 1);
  return {
    schema: 3 as const,
    businessTimeZone: BUSINESS_TIME_ZONE,
    today,
    notifications: (notifications.results as Row[]).map(toNotification),
    unreadNotifications: Number((unread.results as Row[])[0].n),
    activity: (activity.results as Row[]).map(toActivity),
    owners: (owners.results as Row[]).map(r => s(r.owner)),
    opportunityStatusCounts: Object.fromEntries(OPPORTUNITY_STATUSES.map(st => [st, Number((oppStatus.results as Row[]).find(r => r.status === st)?.n ?? 0)])),
    // Card fields only: the summary never carries notes, contacts or other record content.
    recentOpportunities: (recent.results as Row[]).map(r => ({ id: s(r.id), title: s(r.title), agency: s(r.agency), stage: s(r.stage), status: s(r.status), decision: s(r.decision), updatedAt: s(r.updated_at) })),
    counts: Object.fromEntries(Object.entries((counts.results as Row[])[0]).map(([k, v]) => [k, Number(v)])) as Record<string, number>,
    followUpsDue: queue.overdue.total + queue.dueToday.total,
  };
}
export type WorkspaceSummary = Awaited<ReturnType<typeof workspaceSummary>>;
