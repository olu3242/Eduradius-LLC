import { ownerWrite, type RouteParams } from '../../../../lib/server/owner-route';
import { updateOpportunity } from '../../../../lib/server/workflow-store';
export const dynamic = 'force-dynamic';
// Owner-only: update an opportunity with optimistic version checks.
export async function PATCH(request: Request, { params }: RouteParams<'id'>) {
  const { id } = await params;
  return ownerWrite<{ version?: unknown; changes?: unknown }>(request, 32000, (body, actor) => updateOpportunity(id, body.version, body.changes, actor));
}
