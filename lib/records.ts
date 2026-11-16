// Declarative record specifications shared by the workspace UI and the server.
// Each record type has its own table (authoritative source). Fields marked `readOnly`
// are changed only by explicit workflow actions (lib/server/actions.ts), never by edits.
import { isIsoDate } from './workflow';

export type FieldKind = 'text' | 'longtext' | 'date' | 'enum' | 'bool' | 'ref' | 'refs' | 'url' | 'email' | 'json';
export type FieldSpec = {
  key: string; column: string; label: string; kind: FieldKind;
  max?: number; options?: readonly string[]; required?: boolean; default?: unknown;
  /** Referenced record type (ref/refs). */
  ref?: string;
  /** Referenced record must share this parent field value (e.g. same projectId). */
  sameParent?: string;
  /** Changed only by workflow actions. */
  readOnly?: boolean;
  /** Set at creation and never changed afterwards. */
  immutable?: boolean;
  /** Hidden from editors (server-derived). */
  derived?: boolean;
  hint?: string;
};
export type TypeSpec = {
  type: string; table: string; label: string; plural: string; titleKey: string;
  fields: FieldSpec[];
  /** Activity summaries omit the title (e.g. contact names). */
  privateTitle?: boolean;
};

const f = (key: string, label: string, kind: FieldKind, extra: Partial<FieldSpec> = {}): FieldSpec => ({ key, label, kind, column: key.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), ...extra });

// ── Increment 1: organizations, contacts, requirements, evidence ────────────

export const ORGANIZATION_TYPES = ['Prospective client', 'Government buyer', 'Prime contractor', 'Delivery partner', 'Teaming partner', 'Other'] as const;
export const REQUIREMENT_CATEGORIES = ['Eligibility', 'Technical', 'Management', 'Past performance', 'Personnel', 'Pricing', 'Compliance', 'Administrative', 'Other'] as const;
/** "Evidence needed" = not yet shown; "Not met" = confirmed ineligibility/gap (requires a reason). */
export const REQUIREMENT_STATUSES = ['Not started', 'In progress', 'Evidence needed', 'Met', 'Not met', 'Not applicable'] as const;
export const EVIDENCE_CATEGORIES = ['Registration', 'Certification', 'Past performance', 'Capability', 'Personnel', 'Financial', 'Legal', 'Technical', 'Award', 'Acceptance', 'Permission', 'Other'] as const;
export const EVIDENCE_REVIEW_STATUSES = ['Unreviewed', 'In review', 'Verified', 'Rejected', 'Superseded'] as const;
export const EVIDENCE_STORAGE = ['Reference only', 'External link'] as const;
/** Record types evidence can be linked to. */
export const EVIDENCE_SUBJECTS = ['opportunity', 'requirement', 'proposal', 'project', 'deliverable', 'experience'] as const;

export const SPECS: Record<string, TypeSpec> = {
  organization: {
    type: 'organization', table: 'organizations', label: 'Organization', plural: 'Organizations', titleKey: 'name',
    fields: [
      f('name', 'Organization name', 'text', { max: 200, required: true }),
      f('orgType', 'Organization type', 'enum', { options: ORGANIZATION_TYPES, default: 'Prospective client' }),
      f('website', 'Website', 'text', { max: 300 }),
      f('relationshipOwner', 'Relationship owner', 'text', { max: 120 }),
      f('source', 'Source', 'text', { max: 200, hint: 'Where this organization came from (event, referral, solicitation).' }),
      f('notes', 'Notes', 'longtext', { max: 8000 }),
      f('status', 'Record status', 'enum', { options: ['Active', 'Merged'], default: 'Active', readOnly: true }),
      f('mergedIntoId', 'Merged into', 'ref', { ref: 'organization', readOnly: true }),
      f('nameKey', 'Name key', 'text', { derived: true }),
      f('domain', 'Domain', 'text', { derived: true }),
    ],
  },
  contact: {
    type: 'contact', table: 'contacts', label: 'Contact', plural: 'Contacts', titleKey: 'name', privateTitle: true,
    fields: [
      f('organizationId', 'Organization', 'ref', { ref: 'organization' }),
      f('name', 'Name', 'text', { max: 120, required: true }),
      f('role', 'Role / title', 'text', { max: 120 }),
      f('email', 'Email', 'email', { max: 254 }),
      f('phone', 'Phone', 'text', { max: 40 }),
      f('relationshipOwner', 'Relationship owner', 'text', { max: 120 }),
      f('source', 'Source', 'text', { max: 200 }),
      f('notes', 'Notes', 'longtext', { max: 8000 }),
      f('status', 'Record status', 'enum', { options: ['Active', 'Merged'], default: 'Active', readOnly: true }),
      f('mergedIntoId', 'Merged into', 'ref', { ref: 'contact', readOnly: true }),
      f('emailKey', 'Email key', 'text', { derived: true }),
    ],
  },
  requirement: {
    type: 'requirement', table: 'requirements', label: 'Requirement', plural: 'Requirements', titleKey: 'description',
    fields: [
      f('opportunityId', 'Opportunity', 'ref', { ref: 'opportunity', required: true, immutable: true }),
      f('description', 'Requirement', 'longtext', { max: 2000, required: true }),
      f('category', 'Category', 'enum', { options: REQUIREMENT_CATEGORIES, default: 'Eligibility' }),
      f('mandatory', 'Required (not optional)', 'bool', { default: true }),
      f('owner', 'Responsible owner', 'text', { max: 120 }),
      f('dueDate', 'Due date', 'date'),
      f('status', 'Status', 'enum', { options: REQUIREMENT_STATUSES, default: 'Not started' }),
      f('reviewerNotes', 'Reviewer notes', 'longtext', { max: 4000, hint: 'Required when marking Not met or Not applicable, or Met without verified evidence.' }),
    ],
  },
  evidence: {
    type: 'evidence', table: 'evidence', label: 'Evidence', plural: 'Evidence', titleKey: 'title',
    fields: [
      f('title', 'Document title', 'text', { max: 200, required: true }),
      f('category', 'Category', 'enum', { options: EVIDENCE_CATEGORIES, default: 'Capability' }),
      f('versionLabel', 'Version', 'text', { max: 40 }),
      f('owner', 'Owner', 'text', { max: 120 }),
      f('reviewStatus', 'Review status', 'enum', { options: EVIDENCE_REVIEW_STATUSES, default: 'Unreviewed' }),
      f('reviewDate', 'Expiration / next review date', 'date'),
      f('storageKind', 'Storage', 'enum', { options: EVIDENCE_STORAGE, default: 'Reference only', hint: 'Files are not uploaded to this workspace.' }),
      f('location', 'Where the document is kept', 'text', { max: 500, hint: 'Private location reference, e.g. a folder path. Do not paste document contents.' }),
      f('url', 'Approved external link (https)', 'url', { max: 500 }),
      f('notes', 'Notes', 'longtext', { max: 4000 }),
    ],
  },
};

// ── Validation (shared) ─────────────────────────────────────────────────────

export type Values = Record<string, unknown>;
type Result = { ok: true; value: Values; changed: string[] } | { ok: false; error: string };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function defaults(spec: TypeSpec): Values {
  const out: Values = {};
  for (const field of spec.fields) {
    out[field.key] = field.default !== undefined ? field.default
      : field.kind === 'bool' ? false : field.kind === 'refs' ? [] : field.kind === 'json' ? {} : ['date', 'ref'].includes(field.kind) ? null : '';
  }
  return out;
}

/** Validates user input against a spec. `base` is the current record (update) or defaults (create). */
export function validateRecord(spec: TypeSpec, input: unknown, base: Values, mode: 'create' | 'update'): Result {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: `Invalid ${spec.label.toLowerCase()}.` };
  const byKey = new Map(spec.fields.map(field => [field.key, field]));
  const out: Values = { ...base };
  const changed: string[] = [];
  for (const [key, raw] of Object.entries(input as Values)) {
    const field = byKey.get(key);
    if (!field || field.derived) return { ok: false, error: `Unsupported field: ${key}.` };
    if (field.readOnly) return { ok: false, error: `${field.label} is changed only through its workflow action.` };
    if (field.immutable && mode === 'update' && JSON.stringify(raw) !== JSON.stringify(base[key])) return { ok: false, error: `${field.label} cannot be changed after creation.` };
    const parsed = parseValue(field, raw);
    if (!parsed.ok) return parsed;
    if (JSON.stringify(parsed.value) !== JSON.stringify(base[key])) changed.push(key);
    out[key] = parsed.value;
  }
  for (const field of spec.fields) {
    if (field.required && (out[field.key] === null || out[field.key] === '' || out[field.key] === undefined)) return { ok: false, error: `${field.label} is required.` };
  }
  return { ok: true, value: out, changed };
}

function parseValue(field: FieldSpec, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const text = () => {
    if (raw === null || raw === undefined) return { ok: true as const, value: '' };
    if (typeof raw !== 'string') return fail(`${field.label} must be text.`);
    const value = raw.trim();
    return field.max && value.length > field.max ? fail(`${field.label} must be ${field.max} characters or fewer.`) : { ok: true as const, value };
  };
  switch (field.kind) {
    case 'text': case 'longtext': return text();
    case 'email': { const r = text(); return r.ok && r.value && !EMAIL.test(r.value) ? fail(`${field.label} must be a valid email address.`) : r; }
    case 'url': {
      const r = text(); if (!r.ok || !r.value) return r;
      try { const u = new URL(r.value); return u.protocol === 'https:' ? r : fail(`${field.label} must start with https://.`); } catch { return fail(`${field.label} must be a valid https link.`); }
    }
    case 'date': return raw === null || raw === undefined || raw === '' ? { ok: true, value: null } : isIsoDate(raw) ? { ok: true, value: raw } : fail(`${field.label} must be a valid date.`);
    case 'enum': return (field.options ?? []).includes(raw as string) ? { ok: true, value: raw } : fail(`${field.label} has an unsupported value.`);
    case 'bool': return typeof raw === 'boolean' ? { ok: true, value: raw } : fail(`${field.label} must be true or false.`);
    case 'ref': return raw === null || raw === '' || raw === undefined ? { ok: true, value: null } : typeof raw === 'string' && raw.length <= 100 ? { ok: true, value: raw } : fail(`${field.label} is invalid.`);
    case 'refs': return Array.isArray(raw) && raw.length <= 50 && raw.every(v => typeof v === 'string' && v.length <= 100) ? { ok: true, value: [...new Set(raw as string[])] } : fail(`${field.label} is invalid.`);
    case 'json': return raw && typeof raw === 'object' && JSON.stringify(raw).length <= 60000 ? { ok: true, value: raw } : fail(`${field.label} is invalid.`);
  }
}

// ── Duplicate keys ──────────────────────────────────────────────────────────

const SUFFIXES = new Set(['inc', 'llc', 'l', 'c', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'the', 'pllc', 'lp', 'llp', 'pc']);
export function organizationKey(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w && !SUFFIXES.has(w)).join(' ');
}
export function websiteDomain(website: string) {
  if (!website.trim()) return '';
  try { return new URL(website.includes('://') ? website : 'https://' + website).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}
export const emailKey = (email: string) => email.trim().toLowerCase();

// ── Evidence and requirement status helpers ─────────────────────────────────

export type EvidenceLink = { id: string; evidenceId: string; subjectType: string; subjectId: string; createdAt: string };
export type EvidenceState = 'current' | 'unreviewed' | 'expired' | 'rejected';
export function evidenceState(evidence: Values, today: string): EvidenceState {
  if (evidence.reviewStatus === 'Rejected' || evidence.reviewStatus === 'Superseded') return 'rejected';
  if (typeof evidence.reviewDate === 'string' && evidence.reviewDate < today) return 'expired';
  return evidence.reviewStatus === 'Verified' ? 'current' : 'unreviewed';
}

/** Advisory summary for an opportunity's checklist. The go/no-go decision stays manual. */
export function requirementSummary(requirements: Values[], evidenceById: Map<string, Values>, links: EvidenceLink[], today: string) {
  const mandatory = requirements.filter(r => r.mandatory);
  const linked = (id: string) => links.filter(l => l.subjectType === 'requirement' && l.subjectId === id).map(l => evidenceById.get(l.evidenceId)).filter(Boolean) as Values[];
  return {
    total: requirements.length,
    mandatory: mandatory.length,
    met: requirements.filter(r => r.status === 'Met').length,
    notMet: mandatory.filter(r => r.status === 'Not met').length,
    evidenceNeeded: requirements.filter(r => r.status === 'Evidence needed').length,
    open: mandatory.filter(r => !['Met', 'Not met', 'Not applicable'].includes(r.status as string)).length,
    weakEvidence: requirements.filter(r => linked(r.id as string).some(e => evidenceState(e, today) !== 'current')).length,
  };
}
