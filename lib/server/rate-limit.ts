// Fixed-window rate limiter backed by D1 (`rate_limits`, migration 0001). Server-only.
// Fails closed: callers treat a thrown error as "unavailable", never as "allowed".
import { env } from '@/lib/server/platform';
import { sha256Hex } from './http';

export type Limit = { bucket: string; max: number; windowSeconds: number };
export const LIMITS = {
  inquiry: { bucket: 'inquiry', max: 5, windowSeconds: 600 },
  login: { bucket: 'login', max: 10, windowSeconds: 600 },
} satisfies Record<string, Limit>;

export async function consume(limit: Limit, subject: string): Promise<{ allowed: boolean; retryAfter: number }> {
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - (nowSec % limit.windowSeconds);
  // Hash the subject so raw client addresses are never stored.
  const key = `${limit.bucket}:${await sha256Hex(subject)}`;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`,
  ).bind(key, windowStart).first<{ count: number }>();
  // Opportunistic cleanup of stale windows (~2% of calls).
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(nowSec - 86400).run();
  const count = row?.count ?? Infinity;
  return { allowed: count <= limit.max, retryAfter: windowStart + limit.windowSeconds - nowSec };
}
