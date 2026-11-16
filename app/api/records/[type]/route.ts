import { json } from '../../../../lib/server/http';
import { ListError, listPage, parseListParams } from '../../../../lib/server/listing';
import { ownerRead, ownerWrite, type RouteParams } from '../../../../lib/server/owner-route';
import { createRecord } from '../../../../lib/server/records-store';
export const dynamic = 'force-dynamic';
// Owner-only: create a spec-defined record (organizations, contacts, requirements, evidence, ...).
export async function POST(request: Request, { params }: RouteParams<'type'>) {
  const { type } = await params;
  return ownerWrite<{ record?: unknown; confirmDistinct?: unknown }>(request, 64000, (body, actor) => createRecord(type, body.record, actor, { confirmDistinct: body.confirmDistinct === true }));
}
// Owner-only: one bounded page of records (see lib/server/listing.ts for the parameter contract).
export async function GET(request: Request, { params }: RouteParams<'type'>) {
  const { type } = await params;
  return ownerRead(request, async () => {
    let parsed;
    try { parsed = parseListParams(type, new URL(request.url).searchParams); }
    catch (error) { if (error instanceof ListError) return json({ error: error.message, code: error.code }, error.code === 'unknown_type' ? 404 : 400); throw error; }
    return json(await listPage(type, parsed));
  });
}
