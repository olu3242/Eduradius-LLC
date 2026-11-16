import { json } from '../../../lib/server/http';
import { ownerRead } from '../../../lib/server/owner-route';
import { importLegacyWorkflow, listWorkflow } from '../../../lib/server/workflow-store';
import { listAllRecords } from '../../../lib/server/records-store';
import { BUSINESS_TIME_ZONE, businessDate } from '../../../lib/workflow';
export const dynamic = 'force-dynamic';
// Owner-only: inquiries, opportunities, recent activity and the in-app notification queue.
export async function GET(request: Request) {
  return ownerRead(request, async () => {
    await importLegacyWorkflow();
    const allActivity = new URL(request.url).searchParams.get('activity') === 'all';
    return json({ ...(await listWorkflow({ allActivity })), ...(await listAllRecords()), businessTimeZone: BUSINESS_TIME_ZONE, today: businessDate() });
  });
}
