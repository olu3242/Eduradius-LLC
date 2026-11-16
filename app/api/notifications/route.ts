import { ownerWrite } from '../../../lib/server/owner-route';
import { markNotificationsRead } from '../../../lib/server/workflow-store';
export const dynamic = 'force-dynamic';
// Owner-only: mark in-app notifications as read ({ all: true } or { ids: [...] }).
export async function POST(request: Request) {
  return ownerWrite<{ ids?: unknown; all?: unknown }>(request, 16000, async body => {
    if (body.all === true) return { status: 200, body: { updated: await markNotificationsRead('all') } };
    const ids = body.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every(id => typeof id === 'string' && id.length <= 100)) return { status: 400, body: { error: 'Provide notification ids or all: true.' } };
    return { status: 200, body: { updated: await markNotificationsRead(ids as string[]) } };
  });
}
