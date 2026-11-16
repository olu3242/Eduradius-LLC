import { json } from '../../../lib/server/http';
import { ownerRead } from '../../../lib/server/owner-route';
import { serverReport } from '../../../lib/server/report-store';
export const dynamic = 'force-dynamic';
// Owner-only: operational metrics over the full dataset (counts are complete; item lists are capped).
export async function GET(request: Request) {
  return ownerRead(request, async () => json(await serverReport()));
}
