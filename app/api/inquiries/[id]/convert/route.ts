import { ownerWrite, type RouteParams } from '../../../../../lib/server/owner-route';
import { convertInquiry } from '../../../../../lib/server/workflow-store';
export const dynamic = 'force-dynamic';
// Owner-only: converts a qualified inquiry into exactly one opportunity (idempotent on retry).
export async function POST(request: Request, { params }: RouteParams<'id'>) {
  const { id } = await params;
  return ownerWrite<{ version?: unknown; opportunity?: unknown }>(request, 32000, (body, actor) => convertInquiry(id, body.version, body.opportunity, actor));
}
