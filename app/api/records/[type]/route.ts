import { ownerWrite, type RouteParams } from '../../../../lib/server/owner-route';
import { createRecord } from '../../../../lib/server/records-store';
export const dynamic = 'force-dynamic';
// Owner-only: create a spec-defined record (organizations, contacts, requirements, evidence, ...).
export async function POST(request: Request, { params }: RouteParams<'type'>) {
  const { type } = await params;
  return ownerWrite<{ record?: unknown; confirmDistinct?: unknown }>(request, 64000, (body, actor) => createRecord(type, body.record, actor, { confirmDistinct: body.confirmDistinct === true }));
}
