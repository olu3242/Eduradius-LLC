import { ownerWrite, type RouteParams } from '../../../../lib/server/owner-route';
import { updateInquiry } from '../../../../lib/server/workflow-store';
export const dynamic = 'force-dynamic';
// Owner-only: review, assign, schedule follow-up, change status, record notes and reasons.
export async function PATCH(request: Request, { params }: RouteParams<'id'>) {
  const { id } = await params;
  return ownerWrite<{ version?: unknown; changes?: unknown }>(request, 16000, (body, actor) => updateInquiry(id, body.version, body.changes, actor));
}
