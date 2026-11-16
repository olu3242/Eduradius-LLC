import { clientAddress, crossSiteRejection, json, logEvent, readJson } from '../../../lib/server/http';
import { consume, LIMITS } from '../../../lib/server/rate-limit';
import { createPublicInquiry } from '../../../lib/server/workflow-store';
import { isInquiryKind } from '../../../lib/inquiry';
export const dynamic = 'force-dynamic';

// Public, append-only intake into the `inquiries` table. Visitors can add one inquiry;
// they can never read records or set status, assignment or review fields.
const LIMITS_BY_FIELD = { name: 120, organization: 160, email: 254, sector: 80, scope: 4000 } as const;
const ALLOWED_KEYS = new Set([...Object.keys(LIMITS_BY_FIELD), 'kind', 'website']);
type Body = Partial<Record<keyof typeof LIMITS_BY_FIELD | 'kind' | 'website', unknown>>;

function validate(body: Body) {
  const out: Record<string, string> = {};
  for (const [field, max] of Object.entries(LIMITS_BY_FIELD)) {
    const value = typeof body[field as keyof Body] === 'string' ? (body[field as keyof Body] as string).trim() : '';
    if (!value || value.length > max) return null;
    out[field] = value;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) return null;
  const kind = isInquiryKind(body.kind) ? body.kind : null;
  return kind ? { name: out.name, organization: out.organization, email: out.email, sector: out.sector, scope: out.scope, kind } : null;
}

export async function POST(request: Request) {
  const rejected = await crossSiteRejection(request); if (rejected) return rejected;
  const body = await readJson<Body>(request, 16000);
  if (body === 'too_large') return json({ error: 'Request is too large.' }, 413);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Please complete all required fields.' }, 400);
  // Internal workflow fields (status, assignee, notes, ...) are never accepted from the public.
  if (Object.keys(body).some(key => !ALLOWED_KEYS.has(key))) return json({ error: 'The request contained unsupported fields.' }, 400);
  const fields = validate(body);
  if (!fields) return json({ error: 'Please complete all required fields with a valid email address.' }, 400);
  const accepted = { message: 'Your request has been saved to the EduRadius workspace for review. No email has been sent.' };
  // Honeypot: real visitors never see or fill `website`. Pretend success so bots learn nothing.
  if (typeof body.website === 'string' && body.website.trim()) { logEvent('inquiry.honeypot'); return json(accepted, 201); }

  try {
    const limit = await consume(LIMITS.inquiry, clientAddress(request));
    if (!limit.allowed) return json({ error: 'Too many requests. Please try again later.' }, 429, { 'Retry-After': String(limit.retryAfter) });
  } catch (e) { logEvent('ratelimit.error', { bucket: 'inquiry', message: String(e) }); return json({ error: 'Requests are temporarily unavailable. Please try again later.' }, 503); }

  try {
    const created = await createPublicInquiry(fields);
    if (!created) { logEvent('inquiry.capacity'); return json({ error: 'Requests are temporarily unavailable. Please try again later.' }, 503); }
    logEvent('inquiry.created', { id: created.id, kind: fields.kind });
    return json({ ...accepted, id: created.id }, 201);
  } catch (e) {
    logEvent('inquiry.error', { message: String(e) });
    return json({ error: 'Requests are temporarily unavailable. Please try again later.' }, 503);
  }
}
