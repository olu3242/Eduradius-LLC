import { clientAddress, crossSiteRejection, json, logEvent, readJson } from '../../../lib/server/http';
import { consume, LIMITS } from '../../../lib/server/rate-limit';
import { MAX_WORKSPACE_BYTES, readWorkspace, writeWorkspace } from '../../../lib/server/workspace-store';
import { initialWorkspace } from '../../../lib/workspace';
export const dynamic = 'force-dynamic';

// Public, append-only intake. Visitors can add one inquiry; they can never read or
// replace the workspace.
const INQUIRY_KINDS = ['Project briefing', 'Teaming inquiry', 'AI consulting briefing', 'AI governance briefing', 'AI adoption briefing', 'Training and education briefing'];
const MAX_INQUIRIES = 500;
const LIMITS_BY_FIELD = { name: 120, organization: 160, email: 254, sector: 80, scope: 4000 } as const;
type Body = Partial<Record<keyof typeof LIMITS_BY_FIELD | 'kind' | 'website', unknown>>;

function validate(body: Body) {
  const out: Record<string, string> = {};
  for (const [field, max] of Object.entries(LIMITS_BY_FIELD)) {
    const value = typeof body[field as keyof Body] === 'string' ? (body[field as keyof Body] as string).trim() : '';
    if (!value || value.length > max) return null;
    out[field] = value;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) return null;
  const kind = typeof body.kind === 'string' && INQUIRY_KINDS.includes(body.kind) ? body.kind : null;
  return kind ? { ...out, kind } : null;
}

export async function POST(request: Request) {
  const rejected = await crossSiteRejection(request); if (rejected) return rejected;
  const body = await readJson<Body>(request, 16000);
  if (body === 'too_large') return json({ error: 'Request is too large.' }, 413);
  if (!body || typeof body !== 'object') return json({ error: 'Please complete all required fields.' }, 400);
  const fields = validate(body);
  if (!fields) return json({ error: 'Please complete all required fields with a valid email address.' }, 400);
  const accepted = { message: 'Your request has been saved to the EduRadius workspace for review. No email has been sent.' };
  // Honeypot: real visitors never see or fill `website`. Pretend success so bots learn nothing.
  if (typeof body.website === 'string' && body.website.trim()) { logEvent('inquiry.honeypot'); return json(accepted, 201); }

  try {
    const limit = await consume(LIMITS.inquiry, clientAddress(request));
    if (!limit.allowed) return json({ error: 'Too many requests. Please try again later.' }, 429, { 'Retry-After': String(limit.retryAfter) });
  } catch (e) { logEvent('ratelimit.error', { bucket: 'inquiry', message: String(e) }); return json({ error: 'Requests are temporarily unavailable. Please try again later.' }, 503); }

  const inquiry = { id: crypto.randomUUID(), ...fields, createdAt: new Date().toISOString(), status: 'Awaiting review', notes: '' };
  try {
    // Append with optimistic concurrency; retry if the owner saved in between.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, revision } = await readWorkspace();
      const next = { ...initialWorkspace(), ...(data || {}) } as Record<string, unknown> & { inquiries: unknown[] };
      const existing = Array.isArray(next.inquiries) ? next.inquiries : [];
      if (existing.length >= MAX_INQUIRIES) { logEvent('inquiry.capacity', { count: existing.length }); throw new Error('capacity'); }
      next.inquiries = [inquiry, ...existing];
      if (JSON.stringify(next).length > MAX_WORKSPACE_BYTES) { logEvent('inquiry.capacity', { reason: 'size' }); throw new Error('capacity'); }
      const saved = await writeWorkspace(next, revision);
      if (saved) { logEvent('inquiry.created', { id: inquiry.id, kind: inquiry.kind, revision: saved.revision }); return json({ ...accepted, id: inquiry.id }, 201); }
    }
    return json({ error: 'The workspace is busy. Please try again.' }, 503);
  } catch (e) {
    if (String(e) !== 'Error: capacity') logEvent('inquiry.error', { message: String(e) });
    return json({ error: 'Requests are temporarily unavailable. Please try again later.' }, 503);
  }
}
