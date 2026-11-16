// New isolated PostgreSQL only. Requires explicit confirmation of the credential's hostname.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';
const url = new URL(process.env.DATABASE_URL || 'postgresql://missing');
if (!process.env.DATABASE_URL || process.env.DATABASE_CONFIRM_HOST !== url.hostname) throw new Error('Set DATABASE_URL and DATABASE_CONFIRM_HOST to the exact isolated database hostname.');
const schema = readFileSync(new URL('../../postgres/0000_baseline.sql', import.meta.url), 'utf8');
const checksum = createHash('sha256').update(schema).digest('hex');
const client = new pg.Client({ connectionString: url.href });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(73628914)');
  const ledger = await client.query("SELECT to_regclass('public.eduradius_migrations') AS ledger");
  if (ledger.rows[0].ledger) {
    const applied = await client.query("SELECT checksum FROM eduradius_migrations WHERE id = '0000_baseline'");
    if (applied.rows[0]?.checksum !== checksum) throw new Error('Migration baseline differs from the recorded schema. Review a forward migration.');
  } else {
    const existing = await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'");
    if (existing.rows[0].n) throw new Error('Refusing baseline installation: database is not empty.');
    await client.query(schema);
    await client.query('CREATE TABLE eduradius_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now() NOT NULL)');
    await client.query('INSERT INTO eduradius_migrations(id, checksum) VALUES ($1, $2)', ['0000_baseline', checksum]);
  }
  await client.query('COMMIT');
  console.log('PostgreSQL baseline verified.');
} catch {
  await client.query('ROLLBACK');
  console.error('Migration failed; no partial schema was committed.');
  throw new Error('Review database migration configuration.', { cause: undefined });
} finally { await client.end(); }
