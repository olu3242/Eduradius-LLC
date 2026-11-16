import { json } from '../../../../../lib/server/http';
import { ownerRead, type RouteParams } from '../../../../../lib/server/owner-route';
import { CONTEXTS } from '../../../../../lib/server/context';
export const dynamic = 'force-dynamic';
// Owner-only: a record and the related records its detail view needs (bounded; see lib/server/context.ts).
export async function GET(request: Request, { params }: RouteParams<'type' | 'id'>) {
  const { type, id } = await params;
  return ownerRead(request, async () => {
    if (!Object.hasOwn(CONTEXTS, type)) return json({ error: 'Unknown record type.' }, 404);
    const context = await CONTEXTS[type](id);
    return context ? json(context) : json({ error: 'Record not found.' }, 404);
  });
}
