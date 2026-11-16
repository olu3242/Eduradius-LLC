import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = new URL('../../drizzle/', import.meta.url);
export const migrationFiles = () => readdirSync(MIGRATIONS).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();

// Executes the production migrations and SQL against real in-memory SQLite.
// Only the D1 transport shape is adapted; no query results are fabricated.
// `upTo` applies migrations through the given prefix (e.g. '0001') for upgrade tests.
// `file` opens an existing SQLite database (e.g. a local Miniflare D1 file) without migrating it.
export function database({ upTo, file } = {}) {
  const sqlite = new DatabaseSync(file ?? ':memory:');
  const applyMigration = file => sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  if (!file) for (const name of migrationFiles()) { if (upTo && name.slice(0, 4) > upTo) break; applyMigration(name); }
  const statement = (sql, args = []) => ({
    bind(...values) { return statement(sql, values); },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { return this._exec(); },
    _exec() {
      const s = sqlite.prepare(sql);
      if (/\breturning\b/i.test(sql) || /^\s*select/i.test(sql)) { const rows = s.all(...args); return { results: rows, meta: { changes: rows.length } }; }
      return { results: [], meta: { changes: Number(s.run(...args).changes) } };
    },
  });
  return {
    close() { sqlite.close(); },
    exec(sql) { sqlite.exec(sql); },
    applyMigration,
    prepare(sql) { return statement(sql); },
    // D1 batches are transactions: any failing statement rolls back the whole batch.
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(s => s._exec()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
