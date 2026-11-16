import { json } from '../../../../lib/server/http';
import { ownerRead } from '../../../../lib/server/owner-route';
import { db } from '../../../../lib/server/records-store';
export const dynamic = 'force-dynamic';
// Owner-only: groups of active organizations sharing a normalized name or website domain (≤ 50 groups).
export async function GET(request: Request) {
  return ownerRead(request, async () => {
    const rows = (await db().prepare(`SELECT key, json_group_array(json_object('id', id, 'name', name)) AS members FROM (
      SELECT 'n:' || name_key AS key, id, name, created_at FROM organizations WHERE status = 'Active' AND name_key <> ''
      UNION ALL SELECT 'd:' || domain, id, name, created_at FROM organizations WHERE status = 'Active' AND domain <> '' ORDER BY created_at, id
    ) GROUP BY key HAVING COUNT(*) > 1 ORDER BY key LIMIT 50`).all<{ key: string; members: string }>()).results;
    return json({ groups: rows.map(r => ({ key: r.key, members: JSON.parse(r.members) as { id: string; name: string }[] })) });
  });
}
