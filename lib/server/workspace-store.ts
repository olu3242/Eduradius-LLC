// D1 persistence for the single shared workspace document. Server-only.
import { env } from '@/lib/server/platform';

export const WORKSPACE_ID = 'eduradius';
export const MAX_WORKSPACE_BYTES = 700000;

type Row = { data: string; revision: number; updated_at: string };
export type StoredWorkspace = { data: Record<string, unknown> | null; revision: number; updatedAt?: string };

function db() {
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  return env.DB;
}

export async function readWorkspace(): Promise<StoredWorkspace> {
  const row = await db().prepare('SELECT data, revision, updated_at FROM workspaces WHERE id = ?').bind(WORKSPACE_ID).first<Row>();
  return row ? { data: JSON.parse(row.data), revision: row.revision, updatedAt: row.updated_at } : { data: null, revision: 0 };
}

/** Optimistic-concurrency write. Returns the new revision, or null when `revision` is stale. */
export async function writeWorkspace(data: unknown, revision: number) {
  const now = new Date().toISOString();
  const body = JSON.stringify(data);
  const result = revision === 0
    ? await db().prepare('INSERT OR IGNORE INTO workspaces (id,data,revision,updated_at) VALUES (?,?,1,?)').bind(WORKSPACE_ID, body, now).run()
    : await db().prepare('UPDATE workspaces SET data=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?').bind(body, now, WORKSPACE_ID, revision).run();
  return result.meta.changes ? { revision: revision + 1, updatedAt: now } : null;
}
