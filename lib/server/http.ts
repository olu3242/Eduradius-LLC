// Shared HTTP helpers for API routes. Server-only.
import { currentRequestId } from './request-context';

const baseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...baseHeaders, ...headers } });
}

/** Drains an unread request body (capped) before an early response. Responding with the body
 *  unread made the local Wrangler proxy fail the next request on that connection with
 *  "Your worker restarted mid-request" (503); cancel() alone did not prevent it. */
export async function discardBody(request: Request, maxBytes = 1_000_000) {
  if (!request.body || request.bodyUsed) return;
  const reader = request.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return; }
    }
  } catch { /* client went away */ }
}

/** Rejects state-changing requests that do not come from this origin (CSRF defense in depth). */
export async function crossSiteRejection(request: Request): Promise<Response | null> {
  const origin = request.headers.get('origin');
  const crossSite = request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(request.url).origin);
  if (!crossSite) return null;
  await discardBody(request);
  return json({ error: 'Cross-site request rejected.' }, 403);
}

/** Client address as reported by the Cloudflare edge (or Miniflare locally). */
export function clientAddress(request: Request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

/** Keys whose values may contain personal data, credentials or document content. */
const SENSITIVE_KEY = /(email|e-mail|token|password|secret|authorization|cookie|phone|name|scope|notes|body|content|summary)/i;
const MAX_LOG_STRING = 300;
/** Redacts sensitive keys and truncates long values before anything is logged. */
export function redactLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const clean = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') return value.length > MAX_LOG_STRING ? value.slice(0, MAX_LOG_STRING) + '…' : value;
    if (value === null || typeof value !== 'object') return value;
    if (depth > 2) return '[nested]';
    if (Array.isArray(value)) return value.slice(0, 20).map(v => clean(v, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : clean(v, depth + 1)]));
  };
  return clean(fields, 0) as Record<string, unknown>;
}

/** Structured, redacted log line with the request correlation ID when available. */
export function logEvent(event: string, fields: Record<string, unknown> = {}) {
  const requestId = currentRequestId();
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...(requestId ? { requestId } : {}), ...redactLogFields(fields) }));
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Reads a JSON body with a hard size cap. Returns null for oversize or malformed bodies. */
export async function readJson<T>(request: Request, maxBytes: number): Promise<T | null | 'too_large'> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return 'too_large';
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch { return null; }
  finally { reader.releaseLock(); }
}
