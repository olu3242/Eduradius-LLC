import { authDescriptor, authMode, clearSessionCookie, createSessionCookie, currentOwner, tokenMatches } from '../../../../lib/server/access';
import { clientAddress, crossSiteRejection, json, logEvent, readJson } from '../../../../lib/server/http';
import { consume, LIMITS } from '../../../../lib/server/rate-limit';
export const dynamic = 'force-dynamic';

// Session status: tells the workspace UI whether it is signed in and how to sign in.
export async function GET(request: Request) {
  const owner = await currentOwner(request);
  return json({ authenticated: Boolean(owner), auth: authDescriptor() });
}

// Token-mode sign-in: exchanges WORKSPACE_ACCESS_TOKEN for a signed HttpOnly session cookie.
export async function POST(request: Request) {
  const rejected = await crossSiteRejection(request); if (rejected) return rejected;
  // Read the (small, capped) body first so no early return leaves it unread.
  const body = await readJson<{ token?: unknown }>(request, 2048);
  if (authMode() !== 'token') return json({ error: 'Token sign-in is not enabled.', auth: authDescriptor() }, 404);
  try {
    const limit = await consume(LIMITS.login, clientAddress(request));
    if (!limit.allowed) return json({ error: 'Too many sign-in attempts. Please wait and try again.' }, 429, { 'Retry-After': String(limit.retryAfter) });
  } catch (e) { logEvent('ratelimit.error', { bucket: 'login', message: String(e) }); return json({ error: 'Sign-in is temporarily unavailable.' }, 503); }
  if (!body || body === 'too_large' || !(await tokenMatches(body.token))) {
    logEvent('workspace.signin.failed');
    return json({ error: 'That access key is not valid.' }, 401);
  }
  logEvent('workspace.signin.succeeded');
  return json({ authenticated: true }, 200, { 'Set-Cookie': await createSessionCookie(request) });
}

export async function DELETE(request: Request) {
  const rejected = await crossSiteRejection(request); if (rejected) return rejected;
  return json({ authenticated: false, auth: authDescriptor() }, 200, { 'Set-Cookie': clearSessionCookie(request) });
}
