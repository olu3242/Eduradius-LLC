// Native Next.js/Vercel runtime. No connection is opened during build/prerender.
import { Pool, types } from 'pg';
import { postgresDatabase } from './postgres';

types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds safe range.');
  return number;
});
let database: ReturnType<typeof postgresDatabase> | undefined;
export const env = new Proxy({} as Cloudflare.Env, {
  get(_target, key) {
    if (key === 'DB') {
      if (!process.env.DATABASE_URL) return undefined;
      if (!database) database = postgresDatabase(new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 3, idleTimeoutMillis: 5000, connectionTimeoutMillis: 10000,
      }));
      return database;
    }
    // Sites identity headers are not trusted on Vercel. Only token auth is portable.
    if (key === 'WORKSPACE_AUTH_MODE' && process.env.WORKSPACE_AUTH_MODE === 'sites') return 'unconfigured';
    return typeof key === 'string' ? process.env[key] : undefined;
  },
});
