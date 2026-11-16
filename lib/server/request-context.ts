// Request-scoped correlation ID (Workers nodejs_compat AsyncLocalStorage). Server-only.
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<{ requestId: string }>();
const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Accepts a well-formed incoming x-request-id (e.g. from a proxy) or generates one. */
export function requestIdFor(request: Request) {
  const incoming = request.headers.get('x-request-id');
  return incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
}
export function runWithRequestId<T>(requestId: string, run: () => T): T {
  return store.run({ requestId }, run);
}
export const currentRequestId = () => store.getStore()?.requestId;
