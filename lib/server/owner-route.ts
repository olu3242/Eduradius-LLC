// Shared guard for owner-only endpoints: CSRF check, owner authorization, capped JSON body.
import { requireOwner, type Owner } from './access';
import { crossSiteRejection, json, logEvent, readJson } from './http';
import type { StoreResult } from './workflow-store';

/** Server-derived actor identity. Never taken from the request body. */
export const actorFor = (owner: Owner) => `${owner.mode}:${owner.subject}`;

export type RouteParams<K extends string> = { params: Promise<Record<K, string>> };

export async function ownerRead(request: Request, handler: () => Promise<Response>) {
  const access = await requireOwner(request);
  if (!access.ok) return access.response;
  try { return await handler(); }
  catch (error) { logEvent('workflow.error', { message: String(error) }); return json({ error: 'The workspace is temporarily unavailable. Please retry.' }, 503); }
}

export async function ownerWrite<T>(request: Request, maxBytes: number, handler: (body: T, actor: string) => Promise<StoreResult<unknown>>) {
  const rejected = await crossSiteRejection(request); if (rejected) return rejected;
  const access = await requireOwner(request); if (!access.ok) return access.response;
  const body = await readJson<T>(request, maxBytes);
  if (body === 'too_large') return json({ error: 'Request is too large.' }, 413);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
  try {
    const result = await handler(body, actorFor(access.owner));
    return json(result.body, result.status);
  } catch (error) {
    logEvent('workflow.error', { message: String(error) });
    return json({ error: 'Unable to save. Your changes remain on this page; please retry.' }, 503);
  }
}
