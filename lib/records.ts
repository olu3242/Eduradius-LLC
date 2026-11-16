// Declarative record specifications shared by the workspace UI and the server.
// Each record type has its own table (authoritative source). Fields marked `readOnly`
// are changed only by explicit workflow actions (lib/server/actions.ts), never by edits.
import { isIsoDate } from './workflow';

export type FieldKind = 'text' | 'longtext' | 'date' | 'enum' | 'bool' | 'ref' | 'refs' | 'url' | 'email' | 'json' | 'int';
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
  /** Created only by a workflow action (generic create is rejected). */
  createViaAction?: boolean;
  /** Created and changed only by workflow actions (generic create and edit are rejected). */
  actionOnly?: boolean;
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

// ── Increment 2: proposals, owner review, submissions, teaming ─────────────

export const PROPOSAL_SECTIONS = [
  { key: 'executiveSummary', label: 'Executive summary' },
  { key: 'understanding', label: 'Understanding of the requirement' },
  { key: 'approach', label: 'Proposed approach' },
  { key: 'deliverables', label: 'Deliverables and milestones' },
  { key: 'team', label: 'Team and responsibilities' },
  { key: 'experience', label: 'Relevant experience' },
  { key: 'assumptions', label: 'Assumptions and exclusions' },
  { key: 'pricing', label: 'Pricing reference' },
  { key: 'attachments', label: 'Required attachments' },
] as const;
/** Every section states its basis so illustrative text is never mistaken for a verified claim. */
export const SECTION_BASIS = ['Draft text', 'Illustrative — not a verified claim', 'Verified — supported by evidence'] as const;
/** Owner review (single-owner workspace: not an independent second reviewer). */
export const PROPOSAL_STATUSES = ['Draft', 'Internal review', 'Changes requested', 'Approved', 'Submitted'] as const;
export const VERSION_STATUSES = ['Internal review', 'Changes requested', 'Approved', 'Superseded', 'Submitted'] as const;
export const SUBMISSION_METHODS = ['Procurement portal', 'Email', 'Hand delivery', 'Mail / courier', 'Other'] as const;
export const SUBMISSION_OUTCOMES = ['Pending', 'Awarded', 'Not awarded', 'Withdrawn', 'Cancelled'] as const;
export const PARTNER_ROLES = ['Prime', 'Subcontractor', 'Teaming partner', 'Consultant', 'Mentor'] as const;
/** Only 'Agreement signed' (with a reference) indicates agreed participation. */
export const DISCUSSION_STATUSES = ['Identified', 'Contacted', 'In discussion', 'Interested', 'Declined', 'Agreement drafted', 'Agreement signed'] as const;
export type Section = { body: string; basis: string; refs: string[] };
export type Sections = Record<string, Section>;

/** Validates proposal/template section content. */
export function validateSections(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Sections are invalid.';
  const keys = new Set<string>(PROPOSAL_SECTIONS.map(x => x.key));
  for (const [key, section] of Object.entries(value as Record<string, unknown>)) {
    if (!keys.has(key)) return `Unknown proposal section: ${key}.`;
    const sec = section as Partial<Section>;
    if (!sec || typeof sec !== 'object' || typeof sec.body !== 'string' || sec.body.length > 20000) return 'Each section needs text of 20,000 characters or fewer.';
    if (!(SECTION_BASIS as readonly string[]).includes(String(sec.basis))) return 'Each section needs a stated basis.';
    if (!Array.isArray(sec.refs) || sec.refs.length > 20 || !sec.refs.every(r => typeof r === 'string')) return 'Section evidence references are invalid.';
    if (sec.basis === SECTION_BASIS[2] && !sec.refs.length) return `Link evidence for the verified section “${PROPOSAL_SECTIONS.find(x => x.key === key)?.label}”, or mark it illustrative.`;
  }
  return null;
}
export const emptySections = (): Sections => Object.fromEntries(PROPOSAL_SECTIONS.map(x => [x.key, { body: '', basis: SECTION_BASIS[0], refs: [] }]));

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
  proposalTemplate: {
    type: 'proposalTemplate', table: 'proposal_templates', label: 'Proposal template', plural: 'Proposal templates', titleKey: 'name',
    fields: [
      f('name', 'Template name', 'text', { max: 160, required: true }),
      f('description', 'Description', 'longtext', { max: 2000 }),
      f('sections', 'Sections', 'json', { readOnly: true }),
    ],
  },
  proposal: {
    type: 'proposal', table: 'proposals', label: 'Proposal', plural: 'Proposals', titleKey: 'title', createViaAction: true,
    fields: [
      f('opportunityId', 'Opportunity', 'ref', { ref: 'opportunity', required: true, immutable: true }),
      f('title', 'Proposal title', 'text', { max: 200, required: true }),
      f('owner', 'Proposal owner', 'text', { max: 120 }),
      f('sections', 'Sections', 'json'),
      f('status', 'Status', 'enum', { options: PROPOSAL_STATUSES, default: 'Draft', readOnly: true }),
      f('templateId', 'Template', 'ref', { ref: 'proposalTemplate', readOnly: true }),
      f('latestVersionId', 'Latest version', 'ref', { ref: 'proposalVersion', readOnly: true }),
      f('approvedVersionId', 'Approved version', 'ref', { ref: 'proposalVersion', readOnly: true }),
    ],
  },
  proposalVersion: {
    type: 'proposalVersion', table: 'proposal_versions', label: 'Proposal version', plural: 'Proposal versions', titleKey: 'number', actionOnly: true,
    fields: [
      f('proposalId', 'Proposal', 'ref', { ref: 'proposal', readOnly: true }),
      f('number', 'Version', 'int', { readOnly: true }),
      f('title', 'Title', 'text', { readOnly: true }),
      f('sections', 'Sections', 'json', { readOnly: true }),
      f('status', 'Status', 'enum', { options: VERSION_STATUSES, readOnly: true }),
      f('submittedBy', 'Sent for review by', 'text', { readOnly: true }),
      f('submittedAt', 'Sent for review at', 'text', { readOnly: true }),
      f('reviewReason', 'Review notes', 'longtext', { readOnly: true }),
      f('reviewedBy', 'Reviewed by', 'text', { readOnly: true }),
      f('reviewedAt', 'Reviewed at', 'text', { readOnly: true }),
    ],
  },
  submission: {
    type: 'submission', table: 'submissions', label: 'Submission record', plural: 'Submission records', titleKey: 'reference', createViaAction: true,
    fields: [
      f('proposalId', 'Proposal', 'ref', { ref: 'proposal', readOnly: true }),
      f('proposalVersionId', 'Approved version', 'ref', { ref: 'proposalVersion', readOnly: true }),
      f('opportunityId', 'Opportunity', 'ref', { ref: 'opportunity', readOnly: true }),
      f('submittedOn', 'Submission date', 'date', { required: true }),
      f('method', 'Method', 'enum', { options: SUBMISSION_METHODS, default: 'Procurement portal' }),
      f('reference', 'Confirmation / reference', 'text', { max: 200 }),
      f('notes', 'Notes', 'longtext', { max: 4000 }),
      f('outcome', 'Outcome', 'enum', { options: SUBMISSION_OUTCOMES, default: 'Pending', readOnly: true }),
      f('outcomeDate', 'Outcome date', 'date', { readOnly: true }),
      f('outcomeNotes', 'Outcome notes', 'longtext', { readOnly: true }),
      f('awardEvidenceId', 'Award evidence', 'ref', { ref: 'evidence', readOnly: true }),
    ],
  },
  teamingPartner: {
    type: 'teamingPartner', table: 'teaming_partners', label: 'Teaming partner', plural: 'Teaming partners', titleKey: 'proposedRole',
    fields: [
      f('opportunityId', 'Opportunity', 'ref', { ref: 'opportunity', required: true, immutable: true }),
      f('organizationId', 'Partner organization', 'ref', { ref: 'organization', required: true }),
      f('contactId', 'Partner contact', 'ref', { ref: 'contact', sameParent: 'organizationId' }),
      f('proposedRole', 'Proposed role', 'enum', { options: PARTNER_ROLES, default: 'Subcontractor' }),
      f('workPackage', 'Work package', 'longtext', { max: 2000 }),
      f('capabilityFit', 'Capability fit', 'longtext', { max: 2000 }),
      f('relationshipOwner', 'Relationship owner', 'text', { max: 120 }),
      f('discussionStatus', 'Discussion status', 'enum', { options: DISCUSSION_STATUSES, default: 'Identified', hint: 'A proposed partner has not agreed to participate until an agreement is signed and referenced.' }),
      f('nextAction', 'Next action', 'text', { max: 300 }),
      f('nextActionDue', 'Next-action due date', 'date'),
      f('agreementReference', 'Agreement reference', 'text', { max: 200, hint: 'e.g. signed teaming agreement or NDA reference. Required for Agreement signed.' }),
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
      : field.kind === 'bool' ? false : field.kind === 'refs' ? [] : field.kind === 'json' ? {} : field.kind === 'int' ? 0 : ['date', 'ref'].includes(field.kind) ? null : '';
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
    case 'json': return raw && typeof raw === 'object' && JSON.stringify(raw).length <= 200000 ? { ok: true, value: raw } : fail(`${field.label} is invalid.`);
    case 'int': return Number.isInteger(raw) ? { ok: true, value: raw } : fail(`${field.label} must be a whole number.`);
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

// ── Proposal export (Markdown; the UI also offers printable HTML) ───────────

export type ProposalDocumentInput = {
  title: string; opportunityTitle: string; organization?: string; sections: Sections;
  /** Exporting the exact approved/submitted version, or the working draft. */
  version?: { number: number; status: string; reviewedAt?: string } | null;
  evidenceTitles?: Record<string, string>;
};
export function proposalDocument(input: ProposalDocumentInput): string {
  const approved = input.version && ['Approved', 'Submitted'].includes(input.version.status);
  const lines = [`# ${input.title}`, '', `Opportunity: ${input.opportunityTitle}${input.organization ? ` — ${input.organization}` : ''}`, ''];
  lines.push(approved
    ? `> Version ${input.version!.number} — ${input.version!.status}. Approved by the workspace owner (owner review; not an independent second review)${input.version!.reviewedAt ? ` on ${input.version!.reviewedAt.slice(0, 10)}` : ''}.`
    : `> **DRAFT — not approved for submission.**${input.version ? ` Version ${input.version.number} (${input.version.status}).` : ' Working copy.'}`);
  lines.push('', '> Sections marked “Illustrative” describe intended work and are not verified claims of qualifications, registrations, certifications or past performance.', '');
  for (const { key, label } of PROPOSAL_SECTIONS) {
    const section = input.sections[key] ?? { body: '', basis: SECTION_BASIS[0], refs: [] };
    lines.push(`## ${label}`, '', `_Basis: ${section.basis}_`, '', section.body.trim() || '_[Not yet written]_', '');
    if (section.refs.length) lines.push('Supporting evidence: ' + section.refs.map(r => input.evidenceTitles?.[r] ?? r).join('; '), '');
  }
  lines.push('---', 'Prepared in the EduRadius workspace. Recording a submission in the workspace does not submit anything externally.');
  return lines.join('\n');
}
