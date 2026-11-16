import { json } from '../../../lib/server/http';
import { ownerRead } from '../../../lib/server/owner-route';
import { db, getRecords } from '../../../lib/server/records-store';
import { EVIDENCE_SUBJECTS } from '../../../lib/records';
export const dynamic = 'force-dynamic';
// Owner-only: evidence links (and the linked evidence) for up to 100 records of one type,
// so a list page can show its links with one bounded request.
export async function GET(request: Request) {
  return ownerRead(request, async () => {
    const params = new URL(request.url).searchParams;
    const subjectType = params.get('subjectType') ?? '', ids = (params.get('ids') ?? '').split(',').filter(Boolean);
    if (!(EVIDENCE_SUBJECTS as readonly string[]).includes(subjectType)) return json({ error: 'Unsupported subjectType.', code: 'invalid_parameter' }, 400);
    if (!ids.length || ids.length > 100 || !ids.every(id => /^[A-Za-z0-9_-]{1,100}$/.test(id))) return json({ error: 'ids must be 1 to 100 valid identifiers.', code: 'invalid_parameter' }, 400);
    const rows = (await db().prepare(`SELECT id, evidence_id, subject_type, subject_id, created_at FROM evidence_links WHERE subject_type = ? AND subject_id IN (${ids.map(() => '?').join(', ')}) ORDER BY created_at, rowid`).bind(subjectType, ...ids).all<Record<string, unknown>>()).results;
    const links = rows.map(r => ({ id: String(r.id), evidenceId: String(r.evidence_id), subjectType: String(r.subject_type), subjectId: String(r.subject_id), createdAt: String(r.created_at) }));
    return json({ links, evidence: await getRecords('evidence', links.map(l => l.evidenceId)), linkScopes: [{ subjectType, ids }] });
  });
}
