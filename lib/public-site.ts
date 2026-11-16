// Public projection of the workspace: only the fields the company website renders.
// Anything not listed here (inquiries, opportunities, documents, receipts, notes,
// reviewers, activity) never leaves the owner API.
import type { Workspace } from './workspace';

const PROFILE_FIELDS = ['name', 'contact', 'email', 'website', 'location', 'summary', 'services', 'deliverables', 'differentiators', 'experience'] as const;

export type PublicSite = {
  profile: Partial<Pick<Workspace['profile'], (typeof PROFILE_FIELDS)[number]>>;
  primary: string;
  primaryStatus: string;
  codes: { code: string; title: string; group: string; status: string }[];
  registrations: { name: string; value: string; status: string }[];
  siteContent: Partial<Workspace['siteContent']>;
};

type Loose = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown) => (Array.isArray(v) ? (v as Loose[]) : []);

export function toPublicSite(data: Loose | null): PublicSite | null {
  if (!data) return null;
  const profile = (data.profile ?? {}) as Loose;
  const content = (data.siteContent ?? {}) as Loose;
  return {
    profile: Object.fromEntries(PROFILE_FIELDS.filter(k => k in profile).map(k => [k, k === 'services' ? arr(profile[k]).filter(s => typeof s === 'string') : str(profile[k])])),
    primary: str(data.primary),
    primaryStatus: str(data.primaryStatus),
    codes: arr(data.codes).map(c => ({ code: str(c.code), title: str(c.title), group: str(c.group), status: str(c.status) })),
    registrations: arr(data.registrations).map(r => ({ name: str(r.name), value: str(r.value), status: str(r.status) })),
    siteContent: Object.fromEntries(Object.entries(content).filter(([, v]) => typeof v === 'string')) as PublicSite['siteContent'],
  };
}
