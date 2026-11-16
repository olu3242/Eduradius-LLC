import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { env } from './helpers/worker-env.mjs';
import { database } from './helpers/database.mjs';
import * as create from '../app/api/records/[type]/route.ts';
import * as update from '../app/api/records/[type]/[id]/route.ts';
import * as actions from '../app/api/actions/[action]/route.ts';
import * as workflowRoute from '../app/api/workflow/route.ts';
import * as exportRoute from '../app/api/export/route.ts';
import * as opportunitiesRoute from '../app/api/opportunities/route.ts';
import * as intake from '../app/api/inquiries/route.ts';
import * as site from '../app/api/site/route.ts';
import { exportBundle, businessDate } from '../lib/workflow.ts';
import { organizationKey, requirementSummary } from '../lib/records.ts';
import { initialWorkspace } from '../lib/workspace.ts';
import { writeWorkspace } from '../lib/server/workspace-store.ts';

const token = 'test-only-access-key-with-at-least-32-characters';
const origin = 'https://eduradius.test';
export const owner = { authorization: `Bearer ${token}` };
const req = (path, method, body, headers = owner) => new Request(origin + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const p = obj => ({ params: Promise.resolve(obj) });
let db;
beforeEach(() => { for (const k of Object.keys(env)) delete env[k]; db = database(); Object.assign(env, { DB: db, WORKSPACE_AUTH_MODE: 'token', WORKSPACE_ACCESS_TOKEN: token }); });
afterEach(() => db?.close());

const add = async (type, record, extra = {}, headers) => create.POST(req(`/api/records/${type}`, 'POST', { record, ...extra }, headers), p({ type }));
const added = async (type, record, extra) => { const r = await add(type, record, extra); assert.equal(r.status, 201, await r.clone().text()); return (await r.json()).record; };
const edit = async (type, rec, changes, extra = {}, headers) => update.PATCH(req(`/api/records/${type}/${rec.id}`, 'PATCH', { version: rec.version, changes, ...extra }, headers), p({ type, id: rec.id }));
const act = async (name, body, headers) => actions.POST(req(`/api/actions/${name}`, 'POST', body, headers), p({ action: name }));
const snapshot = async () => {
  const summary = await (await workflowRoute.GET(req('/api/workflow', 'GET', undefined))).json();
  return { ...summary, ...(await (await exportRoute.GET(req('/api/export', 'GET', undefined))).json()).workflow };
};
const opportunity = async (title = 'State AI policy RFP', extra = {}) => (await (await opportunitiesRoute.POST(req('/api/opportunities', 'POST', { opportunity: { title, ...extra } }))).json()).opportunity;
const rows = async sql => (await db.prepare(sql).all()).results;

// ── Authorization ───────────────────────────────────────────────────────────

test('record and action endpoints require the owner and same-origin writes', async () => {
  const org = await added('organization', { name: 'Riverside ISD' });
  for (const headers of [{}, { authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong-x' }]) {
    assert.equal((await add('organization', { name: 'X' }, {}, headers)).status, 401);
    assert.equal((await edit('organization', org, { notes: 'x' }, {}, headers)).status, 401);
    assert.equal((await act('organization.linkExisting', {}, headers)).status, 401);
  }
  assert.equal((await add('organization', { name: 'X' }, {}, { ...owner, origin: 'https://evil.test' })).status, 403);
  assert.equal((await act('nope', {})).status, 404);
  assert.equal((await act('constructor', {})).status, 404, 'prototype keys are not actions');
  assert.equal((await add('workspaces', { data: '{}' })).status, 404, 'only registered record types');
});

// ── Organizations and contacts ──────────────────────────────────────────────

test('organization duplicates are detected by normalized name and domain and never silently merged', async () => {
  assert.equal(organizationKey('Acme, Inc.'), organizationKey('ACME llc'));
  await added('organization', { name: 'Acme, Inc.', website: 'https://www.acme.example' });
  const dup = await add('organization', { name: 'ACME LLC' });
  assert.equal(dup.status, 409);
  const body = await dup.json();
  assert.equal(body.duplicates.length, 1); assert.equal(body.duplicates[0].name, 'Acme, Inc.');
  assert.equal((await add('organization', { name: 'Different Co', website: 'acme.example' })).status, 409, 'same domain');
  assert.equal((await rows('SELECT id FROM organizations')).length, 1);
  await added('organization', { name: 'ACME LLC' }, { confirmDistinct: true });
  assert.equal((await rows('SELECT id FROM organizations')).length, 2);
});

test('contacts: duplicate email detection, active organization references and validation', async () => {
  const org = await added('organization', { name: 'Riverside ISD', orgType: 'Government buyer' });
  await added('contact', { name: 'Dana Reviewer', email: 'Dana@Example.test', organizationId: org.id, role: 'Director' });
  assert.equal((await add('contact', { name: 'D. Reviewer', email: 'dana@example.test' })).status, 409);
  assert.equal((await add('contact', { name: 'X', organizationId: 'missing' })).status, 400);
  assert.equal((await add('contact', { name: 'X', email: 'not-an-email' })).status, 400);
  assert.equal((await add('contact', { name: 'X', status: 'Merged' })).status, 400, 'workflow fields are read-only');
  assert.equal((await add('contact', { name: 'X', emailKey: 'x' })).status, 400, 'derived fields are not accepted');
});

test('explicit merge moves references, reports conflicts, keeps target values and the source for reference', async () => {
  const target = await added('organization', { name: 'Riverside Independent School District', orgType: 'Government buyer', website: 'riverside.example' });
  const source = await added('organization', { name: 'Riverside ISD', orgType: 'Prospective client' });
  const contact = await added('contact', { name: 'Dana', organizationId: source.id });
  const opp = await opportunity();
  assert.equal((await act('opportunity.link', { id: opp.id, version: opp.version, organizationId: source.id, contactId: contact.id })).status, 200);
  assert.equal((await act('organization.merge', { sourceId: source.id, targetId: target.id, sourceVersion: 99 })).status, 409, 'stale version');
  const res = await act('organization.merge', { sourceId: source.id, targetId: target.id, sourceVersion: source.version });
  assert.equal(res.status, 200);
  const { conflicts } = await res.json();
  assert.deepEqual(conflicts.sort(), ['name', 'orgType']);
  const snap = await snapshot();
  const orgs = Object.fromEntries(snap.records.organization.map(o => [o.id, o]));
  assert.equal(orgs[source.id].status, 'Merged'); assert.equal(orgs[source.id].mergedIntoId, target.id);
  assert.equal(orgs[target.id].orgType, 'Government buyer', 'target values unchanged');
  assert.equal(snap.records.contact[0].organizationId, target.id);
  assert.equal(snap.opportunities[0].organizationId, target.id);
  assert.equal((await edit('organization', orgs[source.id], { notes: 'x' })).status, 409, 'merged record is read-only');
  assert.equal((await add('contact', { name: 'New', organizationId: source.id })).status, 400, 'cannot link to a merged record');
  assert.ok(snap.activity.some(a => a.type === 'organization.merged' && a.details.conflicts.includes('orgType')));
});

test('linking existing requests and opportunities is exact, bounded and safe to rerun', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await intake.POST(new Request(origin + '/api/inquiries', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': 'ip' + i }, body: JSON.stringify({ name: 'Dana', organization: i < 2 ? 'Riverside ISD' : 'Hill Country College', email: i < 2 ? 'dana@riverside.test' : 'kim@hill.test', sector: 'Education', scope: 'Workshop', kind: 'Project briefing' }) }));
    assert.equal(r.status, 201);
  }
  await opportunity('Riverside pursuit', { agency: 'riverside isd', contactEmail: 'dana@riverside.test', contactName: 'Dana' });
  const first = await (await act('organization.linkExisting', {})).json();
  assert.equal(first.processed, 4); assert.equal(first.createdOrganizations, 2); assert.equal(first.createdContacts, 2); assert.equal(first.remaining, 0);
  const again = await (await act('organization.linkExisting', {})).json();
  assert.equal(again.processed, 0);
  const snap = await snapshot();
  assert.equal(snap.records.organization.length, 2);
  const riverside = snap.records.organization.find(o => o.name === 'Riverside ISD');
  assert.equal(snap.inquiries.filter(i => i.organizationId === riverside.id).length, 2);
  assert.equal(snap.opportunities[0].organizationId, riverside.id);
});

test('linking a contact from a different organization is rejected', async () => {
  const a = await added('organization', { name: 'Org A' }), b = await added('organization', { name: 'Org B' });
  const contact = await added('contact', { name: 'Pat', organizationId: b.id });
  const opp = await opportunity();
  assert.equal((await act('opportunity.link', { id: opp.id, version: opp.version, organizationId: a.id, contactId: contact.id })).status, 400);
  assert.equal((await act('opportunity.link', { id: opp.id, version: opp.version, organizationId: 'missing' })).status, 400);
});

// ── Requirements and evidence ───────────────────────────────────────────────

test('requirements distinguish missing evidence from confirmed ineligibility', async () => {
  const opp = await opportunity();
  assert.equal((await add('requirement', { opportunityId: 'missing', description: 'x' })).status, 400);
  const reqA = await added('requirement', { opportunityId: opp.id, description: 'Active SAM registration', category: 'Eligibility', mandatory: true });
  assert.equal((await edit('requirement', reqA, { status: 'Not met' })).status, 400, 'reason required');
  const notMet = await (await edit('requirement', reqA, { status: 'Not met', reviewerNotes: 'Registration lapsed; cannot renew before deadline.' })).json();
  assert.equal(notMet.record.status, 'Not met');
  const reqB = await added('requirement', { opportunityId: opp.id, description: 'Two references', category: 'Past performance', status: 'Evidence needed' });
  assert.equal((await edit('requirement', reqB, { opportunityId: 'other' })).status, 400, 'opportunity is immutable');
  const snap = await snapshot();
  const summary = requirementSummary(snap.records.requirement, new Map(), [], snap.today);
  assert.equal(summary.notMet, 1); assert.equal(summary.evidenceNeeded, 1);
  assert.equal(snap.opportunities[0].decision, 'Undecided', 'go/no-go stays manual');
});

test('Met requires verified, unexpired linked evidence or reviewer notes; links validate both records', async () => {
  const opp = await opportunity();
  const reqA = await added('requirement', { opportunityId: opp.id, description: 'Capability statement' });
  assert.equal((await edit('requirement', reqA, { status: 'Met' })).status, 400);
  const today = businessDate();
  const expired = await added('evidence', { title: 'Old capability statement', reviewStatus: 'Verified', reviewDate: '2020-01-01' });
  const unreviewed = await added('evidence', { title: 'Draft statement' });
  for (const e of [expired, unreviewed]) assert.equal((await act('evidence.link', { evidenceId: e.id, subjectType: 'requirement', subjectId: reqA.id })).status, 200);
  assert.equal((await edit('requirement', reqA, { status: 'Met' })).status, 400, 'expired or unreviewed evidence is not enough');
  const current = await added('evidence', { title: 'Capability statement v3', reviewStatus: 'Verified', reviewDate: '2099-01-01', storageKind: 'External link', url: 'https://drive.example/cap.pdf', versionLabel: 'v3' });
  assert.equal((await act('evidence.link', { evidenceId: current.id, subjectType: 'requirement', subjectId: reqA.id })).status, 200);
  assert.equal((await edit('requirement', reqA, { status: 'Met' })).status, 200);
  assert.equal((await act('evidence.link', { evidenceId: current.id, subjectType: 'requirement', subjectId: 'missing' })).status, 404);
  assert.equal((await act('evidence.link', { evidenceId: current.id, subjectType: 'workspaces', subjectId: reqA.id })).status, 400);
  assert.equal((await act('evidence.link', { evidenceId: 'missing', subjectType: 'requirement', subjectId: reqA.id })).status, 404);
  const again = await (await act('evidence.link', { evidenceId: current.id, subjectType: 'requirement', subjectId: reqA.id })).json();
  assert.equal(again.changed, false, 'duplicate links ignored');
  const snap = await snapshot();
  assert.equal(snap.evidenceLinks.length, 3);
  const evidenceById = new Map(snap.records.evidence.map(e => [e.id, e]));
  assert.equal(requirementSummary(snap.records.requirement, evidenceById, snap.evidenceLinks, today).weakEvidence, 1);
});

test('evidence register is reference-only: links must be https and match the storage choice', async () => {
  assert.equal((await add('evidence', { title: 'x', storageKind: 'External link' })).status, 400);
  assert.equal((await add('evidence', { title: 'x', storageKind: 'External link', url: 'http://insecure.example' })).status, 400);
  assert.equal((await add('evidence', { title: 'x', storageKind: 'External link', url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await add('evidence', { title: 'x', url: 'https://ok.example' })).status, 400, 'reference-only cannot carry a link');
  assert.equal((await add('evidence', { title: 'x', file: 'base64...' })).status, 400, 'no upload fields');
  const e = await added('evidence', { title: 'SAM entity record', category: 'Registration', location: 'Drive / Registrations / SAM' });
  assert.equal(e.storageKind, 'Reference only');
  const verified = (await (await edit('evidence', e, { reviewStatus: 'Verified' })).json()).record;
  assert.equal(verified.reviewStatus, 'Verified');
  assert.equal((await edit('evidence', verified, { reviewStatus: 'Approved' })).status, 400);
});

test('stale versions conflict, and export plus public projection handle the new records', async () => {
  const org = await added('organization', { name: 'Riverside ISD', notes: 'Internal relationship note' });
  await added('contact', { name: 'Dana Private', email: 'dana.private@example.test', organizationId: org.id });
  const ev = await added('evidence', { title: 'Confidential pricing workbook', category: 'Financial' });
  assert.equal((await edit('organization', org, { notes: 'a' })).status, 200);
  assert.equal((await edit('organization', org, { notes: 'b' })).status, 409);
  await writeWorkspace(initialWorkspace(), 0);
  const text = await (await site.GET()).text();
  for (const secret of ['Riverside ISD', 'Dana Private', 'dana.private@example.test', 'Confidential pricing', 'Internal relationship note']) assert.ok(!text.includes(secret), secret);
  const bundle = exportBundle(initialWorkspace(), await snapshot());
  assert.equal(bundle.workflow.records.organization.length, 1); assert.equal(bundle.workflow.records.contact.length, 1);
  assert.equal(bundle.workflow.records.evidence[0].id, ev.id);
  const types = (await rows('SELECT type, actor FROM activity_events')).map(r => r.type);
  assert.ok(types.includes('organization.created') && types.includes('contact.created') && types.includes('evidence.created'));
  const contactEvent = (await rows("SELECT summary FROM activity_events WHERE type = 'contact.created'"))[0];
  assert.ok(!contactEvent.summary.includes('Dana'), 'contact names stay out of activity summaries');
});
