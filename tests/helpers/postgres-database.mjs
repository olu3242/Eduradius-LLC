import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { postgresDatabase } from '../../lib/server/postgres.ts';
const schema = readFileSync(new URL('../../postgres/0000_baseline.sql', import.meta.url), 'utf8');
export const migrationFiles = () => [];
export function database() {
  const pg = new PGlite();
  const ready = pg.exec(schema);
  // One PGlite session: serialize individual queries and whole transactions.
  let tail = ready;
  const locked = async fn => { const before = tail; let unlock; tail = new Promise(r => { unlock = r; }); await before; try { return await fn(); } finally { unlock(); } };
  const query = async (sql, values = []) => {
    const r = await pg.query(sql, values);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  const db = postgresDatabase({ query: (sql, values) => locked(() => query(sql, values)), async connect() {
    const before = tail; let unlock; tail = new Promise(r => { unlock = r; }); await before;
    return { query, release: () => unlock() };
  } });
  return { ...db, async close() { await tail; await pg.close(); }, exec(sql) { return locked(() => pg.exec(sql)); } };
}
