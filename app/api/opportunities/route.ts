import { ownerWrite } from '../../../lib/server/owner-route';
import { createOpportunity } from '../../../lib/server/workflow-store';
export const dynamic = 'force-dynamic';
// Owner-only: create an opportunity that did not come from an inquiry.
export async function POST(request: Request) {
  return ownerWrite<{ opportunity?: unknown }>(request, 32000, (body, actor) => createOpportunity(body.opportunity, actor));
}
