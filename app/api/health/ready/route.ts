import { json } from '../../../../lib/server/http';
import { readiness } from '../../../../lib/server/health';
export const dynamic = 'force-dynamic';
// Public readiness: database reachable, schema complete, access configured (ok/not-ok only).
export async function GET() {
  const { ready, body } = await readiness();
  return json(body, ready ? 200 : 503);
}
