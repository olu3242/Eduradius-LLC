// Shared route helpers for record/action tests (owner bearer token, isolated SQLite per test).
import { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { env } from './worker-env.mjs';
import { database } from './database.mjs';
import * as create from '../../app/api/records/[type]/route.ts';
import * as update from '../../app/api/records/[type]/[id]/route.ts';
import * as actions from '../../app/api/actions/[action]/route.ts';
import * as workflowRoute from '../../app/api/workflow/route.ts';
import * as exportRoute from '../../app/api/export/route.ts';
import * as opportunitiesRoute from '../../app/api/opportunities/route.ts';

export const token = 'test-only-access-key-with-at-least-32-characters';
export const owner = { authorization: `Bearer ${token}` };
const origin = 'https://eduradius.test';
export const req = (path, method, body, headers = owner) => new Request(origin + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const p = obj => ({ params: Promise.resolve(obj) });
export const ctx = { db: null };
export function withIsolatedDatabase() {
  beforeEach(() => { for (const k of Object.keys(env)) delete env[k]; ctx.db = database(); Object.assign(env, { DB: ctx.db, WORKSPACE_AUTH_MODE: 'token', WORKSPACE_ACCESS_TOKEN: token }); });
  afterEach(() => ctx.db?.close());
}
export const add = (type, record, extra = {}, headers) => create.POST(req(`/api/records/${type}`, 'POST', { record, ...extra }, headers), p({ type }));
export async function added(type, record, extra) { const r = await add(type, record, extra); assert.equal(r.status, 201, await r.clone().text()); return (await r.json()).record; }
export const edit = (type, rec, changes, extra = {}, headers) => update.PATCH(req(`/api/records/${type}/${rec.id}`, 'PATCH', { version: rec.version, changes, ...extra }, headers), p({ type, id: rec.id }));
export async function edited(type, rec, changes) { const r = await edit(type, rec, changes); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).record; }
export const act = (name, body, headers) => actions.POST(req(`/api/actions/${name}`, 'POST', body, headers), p({ action: name }));
export async function acted(name, body, status = 200) { const r = await act(name, body); assert.equal(r.status, status, `${name}: ${await r.clone().text()}`); return r.json(); }
/** Summary merged with the complete export, i.e. every stored record. */
export const snapshot = async () => {
  const summary = await (await workflowRoute.GET(req('/api/workflow', 'GET', undefined))).json();
  const bundle = await (await exportRoute.GET(req('/api/export', 'GET', undefined))).json();
  return { ...summary, ...bundle.workflow, manifest: bundle.manifest };
};
export const opportunity = async (title = 'State AI policy RFP', extra = {}) => (await (await opportunitiesRoute.POST(req('/api/opportunities', 'POST', { opportunity: { title, ...extra } }))).json()).opportunity;
export const rows = async sql => (await ctx.db.prepare(sql).all()).results;
export const record = async (type, id) => (await snapshot()).records[type].find(r => r.id === id);

/** Drives opportunity → proposal → owner approval → submission → recorded award. */
export async function awardedSubmission({ award = true } = {}) {
  const { emptySections, SECTION_BASIS } = await import('../../lib/records.ts');
  const opp = await opportunity('Awarded pursuit');
  const org = await added('organization', { name: 'Riverside ISD ' + Math.random().toString(36).slice(2, 7), orgType: 'Government buyer' });
  let { record: proposal } = await acted('proposal.create', { opportunityId: opp.id, title: 'Riverside proposal' }, 201);
  const sections = emptySections(); sections.executiveSummary = { body: 'Summary', basis: SECTION_BASIS[0], refs: [] };
  proposal = await edited('proposal', proposal, { sections });
  proposal = (await acted('proposal.submitForReview', { id: proposal.id, version: proposal.version })).record;
  proposal = (await acted('proposal.approve', { id: proposal.id, version: proposal.version })).record;
  let { record: submission } = await acted('proposal.recordSubmission', { id: proposal.id, version: proposal.version, submittedOn: '2026-11-20', method: 'Email' }, 201);
  const notice = await added('evidence', { title: 'Notice of award', category: 'Award', reviewStatus: 'Verified' });
  if (award) submission = (await acted('submission.recordOutcome', { id: submission.id, version: submission.version, outcome: 'Awarded', outcomeDate: '2026-12-01', awardEvidenceId: notice.id, confirmAward: true })).record;
  return { opp, org, proposal, submission, notice };
}
export const projectInput = (submission, extra = {}) => ({ submissionId: submission.id, confirm: true, title: 'Riverside AI governance', scope: 'Governance framework and staff training.', owner: 'Olu', startDate: '2026-12-01', plannedEndDate: '2027-03-31', deliverables: [{ title: 'Governance framework' }, { title: 'Training workshop', dueDate: '2027-02-15' }], ...extra });
