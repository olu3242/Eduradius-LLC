import { json } from '../../../lib/server/http';
import { ownerRead } from '../../../lib/server/owner-route';
import { listImportConflicts } from '../../../lib/server/import-conflicts';
export const dynamic = 'force-dynamic';
// Owner-only: legacy re-import conflicts awaiting a decision (?status=all includes decided ones). ≤ 100 items.
export async function GET(request: Request) {
  return ownerRead(request, async () => {
    const status = new URL(request.url).searchParams.get('status') ?? 'Open';
    if (!['Open', 'all'].includes(status)) return json({ error: 'status must be Open or all.', code: 'invalid_parameter' }, 400);
    return json(await listImportConflicts(status as 'Open' | 'all'));
  });
}
