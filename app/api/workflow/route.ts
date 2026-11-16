import { json } from '../../../lib/server/http';
import { ownerRead } from '../../../lib/server/owner-route';
import { importLegacyWorkflow } from '../../../lib/server/workflow-store';
import { workspaceSummary } from '../../../lib/server/summary';
export const dynamic = 'force-dynamic';
// Owner-only workspace summary (schema 3): counts, unread notifications, recent activity and
// follow-up totals. Record collections are paged through /api/records/:type, detail views use
// /api/context/:type/:id, reports /api/reports and the complete download /api/export.
export async function GET(request: Request) {
  return ownerRead(request, async () => {
    await importLegacyWorkflow();
    return json(await workspaceSummary());
  });
}
