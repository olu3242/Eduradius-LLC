import { json } from '../../../lib/server/http';
import { ownerRead } from '../../../lib/server/owner-route';
import { followUps } from '../../../lib/server/summary';
export const dynamic = 'force-dynamic';
// Owner-only: follow-up buckets computed in SQL. ?kind=all|inquiry|opportunity&owner=<name>|none
export async function GET(request: Request) {
  return ownerRead(request, async () => {
    const params = new URL(request.url).searchParams;
    const kind = params.get('kind') ?? 'all', owner = params.get('owner');
    if (!['all', 'inquiry', 'opportunity'].includes(kind)) return json({ error: 'kind must be all, inquiry or opportunity.', code: 'invalid_parameter' }, 400);
    if (owner !== null && (!owner.trim() || owner.length > 100)) return json({ error: 'owner must be a name (up to 100 characters) or none.', code: 'invalid_parameter' }, 400);
    for (const key of params.keys()) if (!['kind', 'owner'].includes(key)) return json({ error: `Unsupported parameter: ${key.slice(0, 40)}.`, code: 'invalid_parameter' }, 400);
    return json(await followUps({ kind: kind as 'all', owner }));
  });
}
