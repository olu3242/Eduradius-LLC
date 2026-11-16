import { ownerWrite, type RouteParams } from '../../../../../lib/server/owner-route';
import { updateRecord } from '../../../../../lib/server/records-store';
export const dynamic = 'force-dynamic';
// Owner-only: version-checked edit. Workflow-controlled fields are rejected (use /api/actions).
export async function PATCH(request: Request, { params }: RouteParams<'type' | 'id'>) {
  const { type, id } = await params;
  return ownerWrite<{ version?: unknown; changes?: unknown; confirmDistinct?: unknown }>(request, 64000, (body, actor) => updateRecord(type, id, body.version, body.changes, actor, { confirmDistinct: body.confirmDistinct === true }));
}
