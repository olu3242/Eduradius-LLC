import { json } from '../../../lib/server/http';
import { buildCommit } from '../../../lib/server/health';
export const dynamic = 'force-dynamic';
// Public liveness: the Worker is serving requests. No dependencies are checked.
export async function GET() {
  return json({ status: 'ok', build: buildCommit() });
}
