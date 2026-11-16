import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Executes the production migrations and SQL against real in-memory SQLite.
// Only the D1 transport shape is adapted; no query results are fabricated.
export function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0000_wonderful_exiles.sql', '0001_access_protection.sql']) {
    sqlite.exec(readFileSync(new URL('../../drizzle/' + migration, import.meta.url), 'utf8'));
  }
  return {
    close() { sqlite.close(); },
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = (args) => ({
        bind(...values) { return bound(values); },
        async first() { return statement.get(...args) ?? null; },
        async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
      });
      return bound([]);
    },
  };
}
