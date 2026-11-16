// Server-side access control for the owner workspace API. Server-only.
//
// WORKSPACE_AUTH_MODE selects how the workspace owner is identified:
//   sites — trust `oai-authenticated-user-*` headers. ONLY safe behind the Sites
//           dispatch (or the local dev mock), which strips client-supplied copies.
//           Requires WORKSPACE_OWNER_IDS and/or WORKSPACE_OWNER_EMAILS outside dev.
//   token — portable: WORKSPACE_ACCESS_TOKEN (>= 32 chars) unlocks an HMAC-signed,
//           HttpOnly session cookie; `Authorization: Bearer <token>` also works.
// Unset: the Vite dev server uses `sites` (loopback mock sign-in); every built
// Worker fails closed until a mode is configured.
import { env } from 'cloudflare:workers';
import { discardBody, json, logEvent, sha256Hex } from './http';

export type AuthMode = 'sites' | 'token' | 'unconfigured';
export type Owner = { mode: 'sites' | 'token'; subject: string };
export type AccessResult = { ok: true; owner: Owner } | { ok: false; response: Response };

export const SESSION_COOKIE = 'eduradius_ws';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MIN_TOKEN_LENGTH = 32;
const SITES_SIGN_IN = '/signin-with-chatgpt?return_to=%2Fworkspace';
const SITES_SIGN_OUT = '/signout-with-chatgpt?return_to=%2F';

type AccessEnv = {
  WORKSPACE_AUTH_MODE?: string;
  WORKSPACE_ACCESS_TOKEN?: string;
  WORKSPACE_OWNER_IDS?: string;
  WORKSPACE_OWNER_EMAILS?: string;
};
const config = () => env as unknown as AccessEnv;
const isDev = () => Boolean(import.meta.env?.DEV);
const list = (value?: string) => (value || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);

export function authMode(): AuthMode {
  const mode = config().WORKSPACE_AUTH_MODE?.trim().toLowerCase();
  if (mode === 'sites') return 'sites';
  if (mode === 'token') return accessToken() ? 'token' : 'unconfigured';
  if (mode) return 'unconfigured';
  return isDev() ? 'sites' : 'unconfigured';
}

function accessToken() {
  const token = config().WORKSPACE_ACCESS_TOKEN || '';
  return token.length >= MIN_TOKEN_LENGTH ? token : null;
}

/** Describes how a client can authenticate; safe to return to anonymous callers. */
export function authDescriptor() {
  const mode = authMode();
  if (mode === 'sites') return { mode, signInUrl: SITES_SIGN_IN, signOutUrl: SITES_SIGN_OUT };
  return { mode };
}

async function deny(status: 401 | 403 | 503, error: string, reason: string, request: Request): Promise<AccessResult> {
  await discardBody(request);
  logEvent('workspace.access.denied', { reason, mode: authMode(), method: request.method, path: new URL(request.url).pathname });
  return { ok: false, response: json({ error, auth: authDescriptor() }, status) };
}

export async function requireOwner(request: Request): Promise<AccessResult> {
  const mode = authMode();
  if (mode === 'unconfigured') return deny(503, 'Workspace access is not configured on this server.', 'unconfigured', request);
  if (mode === 'token') {
    const subject = await tokenSubject(request);
    return subject ? { ok: true, owner: { mode, subject } } : deny(401, 'Sign in to open the workspace.', 'no_session', request);
  }
  const result = sitesOwner(request);
  if ('owner' in result) return { ok: true, owner: result.owner };
  if (result.reason === 'anonymous') return deny(401, 'Sign in to open the workspace.', result.reason, request);
  if (result.reason === 'not_owner') return deny(403, 'This account does not have access to the workspace.', result.reason, request);
  return deny(503, 'Workspace owner allowlist is not configured on this server.', result.reason, request);
}

function sitesOwner(request: Request): { owner: Owner } | { reason: 'anonymous' | 'not_owner' | 'no_allowlist' } {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (!id) return { reason: 'anonymous' };
  const ids = list(config().WORKSPACE_OWNER_IDS), emails = list(config().WORKSPACE_OWNER_EMAILS);
  if (!ids.length && !emails.length) {
    // Outside dev, an empty allowlist would admit any signed-in user if the Site ever became public.
    if (!isDev()) return { reason: 'no_allowlist' };
  } else if (!ids.includes(id.toLowerCase()) && !(email && emails.includes(email.toLowerCase()))) {
    return { reason: 'not_owner' };
  }
  return { owner: { mode: 'sites', subject: id } };
}

// ── token mode ──────────────────────────────────────────────────────────────

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function signingKey(token: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const sessionMessage = (exp: string, nonce: string) => new TextEncoder().encode(`eduradius-session-v1.${exp}.${nonce}`);

/** Constant-time token comparison (digests have equal length regardless of input). */
export async function tokenMatches(candidate: unknown) {
  const token = accessToken();
  if (!token || typeof candidate !== 'string' || !candidate) return false;
  const [a, b] = await Promise.all([sha256Hex(candidate), sha256Hex(token)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionCookie(request: Request) {
  const token = accessToken();
  if (!token) throw new Error('Token mode is not configured.');
  const exp = String(Date.now() + SESSION_TTL_SECONDS * 1000);
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const sig = b64url(await crypto.subtle.sign('HMAC', await signingKey(token), sessionMessage(exp, nonce)));
  return cookie(request, `v1.${exp}.${nonce}.${sig}`, SESSION_TTL_SECONDS);
}

export function clearSessionCookie(request: Request) {
  return cookie(request, '', 0);
}

function cookie(request: Request, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

async function tokenSubject(request: Request): Promise<string | null> {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return (await tokenMatches(bearer)) ? 'bearer' : null;
  const token = accessToken();
  const parts = readCookie(request, SESSION_COOKIE)?.split('.');
  if (!token || !parts || parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, exp, nonce, sig] = parts;
  // Strict format: 13-digit expiry, canonical 43-char base64url HMAC-SHA256 (rejects malleable encodings).
  if (!/^\d{13}$/.test(exp) || Number(exp) <= Date.now() || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  try {
    const bytes = fromB64url(sig);
    if (b64url(bytes) !== sig) return null;
    const valid = await crypto.subtle.verify('HMAC', await signingKey(token), bytes, sessionMessage(exp, nonce));
    return valid ? 'session' : null;
  } catch { return null; }
}

/** Non-throwing session probe for the auth status endpoint. */
export async function currentOwner(request: Request): Promise<Owner | null> {
  const mode = authMode();
  if (mode === 'unconfigured') return null;
  if (mode === 'token') { const s = await tokenSubject(request); return s ? { mode, subject: s } : null; }
  const result = sitesOwner(request);
  return 'owner' in result ? result.owner : null;
}
