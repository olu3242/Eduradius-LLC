import { json } from '../../../lib/server/http';
import { readWorkspace } from '../../../lib/server/workspace-store';
import { toPublicSite } from '../../../lib/public-site';
export const dynamic = 'force-dynamic';
// Public, read-only: only the fields the company website renders.
export async function GET() {
  try {
    const { data } = await readWorkspace();
    return json({ data: toPublicSite(data) });
  } catch {
    return json({ error: 'Site content could not be loaded.' }, 503);
  }
}
