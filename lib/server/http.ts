// Shared HTTP helpers for API routes. Server-only.

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

export function logEvent(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Reads a JSON body with a hard size cap. Returns null for oversize or malformed bodies. */
export async function readJson<T>(request: Request, maxBytes: number): Promise<T | null | 'too_large'> {
  const raw = await request.text();
  if (raw.length > maxBytes) return 'too_large';
  try { return JSON.parse(raw) as T; } catch { return null; }
}
