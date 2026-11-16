import { json } from '../../../../lib/server/http';
import { ownerWrite, type RouteParams } from '../../../../lib/server/owner-route';
import { ACTIONS } from '../../../../lib/server/actions';
export const dynamic = 'force-dynamic';
// Owner-only: explicit workflow actions (merge, review, approve, submit, award, accept, ...).
export async function POST(request: Request, { params }: RouteParams<'action'>) {
  const { action } = await params;
  const handler = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!handler) return json({ error: 'Unknown action.' }, 404);
  return ownerWrite<Record<string, unknown>>(request, 64000, (body, actor) => handler(body, actor));
}
