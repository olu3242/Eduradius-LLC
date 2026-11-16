import { json } from '../../../../../lib/server/http';
import { ownerRead, ownerWrite, type RouteParams } from '../../../../../lib/server/owner-route';
import { getRecord, updateRecord } from '../../../../../lib/server/records-store';
import { SPECS } from '../../../../../lib/records';
import { getInquiry, getOpportunity } from '../../../../../lib/server/workflow-store';
export const dynamic = 'force-dynamic';
// Owner-only: version-checked edit. Workflow-controlled fields are rejected (use /api/actions).
export async function PATCH(request: Request, { params }: RouteParams<'type' | 'id'>) {
  const { type, id } = await params;
  return ownerWrite<{ version?: unknown; changes?: unknown; confirmDistinct?: unknown }>(request, 64000, (body, actor) => updateRecord(type, id, body.version, body.changes, actor, { confirmDistinct: body.confirmDistinct === true }));
}
// Owner-only: one record by id (used to resolve references that are not on a loaded page).
export async function GET(request: Request, { params }: RouteParams<'type' | 'id'>) {
  const { type, id } = await params;
  return ownerRead(request, async () => {
    const record = type === 'inquiry' ? await getInquiry(id) : type === 'opportunity' ? await getOpportunity(id) : Object.hasOwn(SPECS, type) ? await getRecord(type, id) : undefined;
    if (record === undefined) return json({ error: 'Unknown record type.' }, 404);
    return record ? json({ record }) : json({ error: 'Record not found.' }, 404);
  });
}
