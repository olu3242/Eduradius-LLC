// Liveness/readiness checks. Responses expose only ok/not-ok states and the build commit:
// no table names, configuration values, modes, record counts or secrets.
import { env } from '@/lib/server/platform';
import { SPECS } from '../records';
import { authMode } from './access';

declare const __EDURADIUS_BUILD__: string | undefined;
export const buildCommit = () => (typeof __EDURADIUS_BUILD__ === 'string' && __EDURADIUS_BUILD__) || process.env.BUILD_COMMIT?.slice(0, 12) || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || 'unknown';

/** Every table the current code reads (migrations 0000–0006). */
export const REQUIRED_TABLES = [...new Set(['workspaces', 'rate_limits', 'inquiries', 'opportunities', 'activity_events', 'notifications', 'workspace_snapshots', 'evidence_links', 'import_conflicts', ...Object.values(SPECS).map(s => s.table)])];

export async function readiness() {
  const checks = { database: 'unavailable', schema: 'unknown', access: authMode() === 'unconfigured' ? 'not_configured' : 'configured' } as Record<string, string>;
  try {
    if (!env.DB) throw new Error('no binding');
    const rows = (await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map(() => '?').join(', ')})`).bind(...REQUIRED_TABLES).all<{ name: string }>()).results;
    checks.database = 'ok';
    checks.schema = rows.length === REQUIRED_TABLES.length ? 'ok' : 'incomplete';
  } catch { /* database stays unavailable */ }
  const ready = checks.database === 'ok' && checks.schema === 'ok' && checks.access === 'configured';
  return { ready, body: { status: ready ? 'ready' : 'not_ready', checks, build: buildCommit() } };
}
