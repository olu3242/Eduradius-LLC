import { baseHeaders, json, logEvent } from '../../../lib/server/http';
import { ownerRead } from '../../../lib/server/owner-route';
import { buildExport } from '../../../lib/server/export';
export const dynamic = 'force-dynamic';
// Owner-only: the complete workspace as one consistent snapshot, or 413 (never a partial export).
export async function GET(request: Request) {
  return ownerRead(request, async () => {
    const result = await buildExport();
    logEvent('workspace.export', { ok: result.ok, counts: result.counts });
    if (!result.ok) return json({ error: result.error, counts: result.counts, code: 'export_too_large' }, result.status);
    return new Response(result.body, { headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="eduradius-workspace.json"' } });
  });
}
