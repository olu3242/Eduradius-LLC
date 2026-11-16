import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { env } from './helpers/worker-env.mjs';
import { database, migrationFiles } from './helpers/database.mjs';
import * as workspace from '../app/api/workspace/route.ts';
import * as site from '../app/api/site/route.ts';
import * as intake from '../app/api/inquiries/route.ts';
import * as inquiryRoute from '../app/api/inquiries/[id]/route.ts';
import * as convertRoute from '../app/api/inquiries/[id]/convert/route.ts';
import * as opportunitiesRoute from '../app/api/opportunities/route.ts';
import * as opportunityRoute from '../app/api/opportunities/[id]/route.ts';
import * as notificationsRoute from '../app/api/notifications/route.ts';
import * as workflowRoute from '../app/api/workflow/route.ts';
import { importLegacyWorkflow } from '../lib/server/workflow-store.ts';
import { readWorkspace, writeWorkspace } from '../lib/server/workspace-store.ts';
import { initialWorkspace } from '../lib/workspace.ts';
import { applyInquiryPatch, businessDate, conversionDraft, dueState, exportBundle, followUpQueue, mapLegacyInquiryStatus } from '../lib/workflow.ts';

const token = 'test-only-access-key-with-at-least-32-characters';
const origin = 'https://eduradius.test';
const owner = { authorization: `Bearer ${token}` };
const req = (path, method = 'GET', body, headers = {}) => new Request(origin + path, {
  method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const params = id => ({ params: Promise.resolve({ id }) });
const publicInquiry = { name: 'Dana Reviewer', organization: 'Riverside ISD', email: 'dana@example.test', sector: 'Education & learning', scope: 'Staff AI literacy workshops for 40 teachers.', kind: 'Training and education briefing' };

let db;
beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  db = database();
  Object.assign(env, { DB: db, WORKSPACE_AUTH_MODE: 'token', WORKSPACE_ACCESS_TOKEN: token });
});
afterEach(() => db?.close());

const submit = async (body = publicInquiry, headers = {}) => intake.POST(req('/api/inquiries', 'POST', body, { 'cf-connecting-ip': crypto.randomUUID(), ...headers }));
const workflow = async (headers = owner) => (await workflowRoute.GET(req('/api/workflow', 'GET', undefined, headers))).json();
const patch = (id, version, changes, headers = owner, extra = {}) => inquiryRoute.PATCH(req(`/api/inquiries/${id}`, 'PATCH', { version, changes, ...extra }, headers), params(id));
const convert = (id, version, opportunity, headers = owner) => convertRoute.POST(req(`/api/inquiries/${id}/convert`, 'POST', { version, opportunity }, headers), params(id));
const rows = async sql => (await db.prepare(sql).all()).results;
async function qualifiedInquiry() {
  await submit();
  let [inq] = (await workflow()).inquiries;
  inq = (await (await patch(inq.id, inq.version, { assignee: 'Olu', nextAction: 'Call to confirm scope', nextActionDue: '2026-12-01' })).json()).inquiry;
  inq = (await (await patch(inq.id, inq.version, { status: 'Qualified', reason: 'Budget and timeline confirmed' })).json()).inquiry;
  return inq;
}

// ── Authorization ───────────────────────────────────────────────────────────

test('every private workflow endpoint denies anonymous, wrong-token and cross-site callers', async () => {
  await submit();
  const id = (await workflow()).inquiries[0].id;
  const calls = headers => [
    () => workflowRoute.GET(req('/api/workflow', 'GET', undefined, headers)),
    () => inquiryRoute.PATCH(req(`/api/inquiries/${id}`, 'PATCH', { version: 1, changes: { assignee: 'x' } }, headers), params(id)),
    () => convertRoute.POST(req(`/api/inquiries/${id}/convert`, 'POST', { version: 1, opportunity: { title: 'x' } }, headers), params(id)),
    () => opportunitiesRoute.POST(req('/api/opportunities', 'POST', { opportunity: { title: 'x' } }, headers)),
    () => opportunityRoute.PATCH(req('/api/opportunities/x', 'PATCH', { version: 1, changes: { title: 'y' } }, headers), params('x')),
    () => notificationsRoute.POST(req('/api/notifications', 'POST', { all: true }, headers)),
  ];
  for (const call of calls({})) assert.equal((await call()).status, 401);
  for (const call of calls({ authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong' })) assert.equal((await call()).status, 401);
  for (const call of calls({ ...owner, origin: 'https://evil.test' }).slice(1)) assert.equal((await call()).status, 403);
  const [stored] = await rows('SELECT assignee, version FROM inquiries');
  assert.equal(stored.assignee, ''); assert.equal(stored.version, 1);
  assert.equal((await rows('SELECT id FROM opportunities')).length, 0);
});

test('Sites mode denies authenticated non-owners and fails closed without an allowlist', async () => {
  env.WORKSPACE_AUTH_MODE = 'sites';
  const outsider = { 'oai-authenticated-user-id': 'someone-else' };
  assert.equal((await workflowRoute.GET(req('/api/workflow', 'GET', undefined, outsider))).status, 503);
  env.WORKSPACE_OWNER_IDS = 'owner-123';
  assert.equal((await workflowRoute.GET(req('/api/workflow', 'GET', undefined, outsider))).status, 403);
  assert.equal((await workflowRoute.GET(req('/api/workflow', 'GET', undefined, { 'oai-authenticated-user-id': 'owner-123' }))).status, 200);
});

// ── Public intake ───────────────────────────────────────────────────────────

test('public submission cannot set internal workflow fields', async () => {
  for (const extra of [{ status: 'Qualified' }, { assignee: 'Attacker' }, { notes: 'x' }, { nextAction: 'x' }, { reason: 'x' }, { opportunityId: 'x' }, { version: 9 }, { id: 'chosen-id' }]) {
    assert.equal((await submit({ ...publicInquiry, ...extra })).status, 400, JSON.stringify(extra));
  }
  assert.equal((await rows('SELECT id FROM inquiries')).length, 0);
  assert.equal((await submit()).status, 201);
  const [stored] = await rows('SELECT * FROM inquiries');
  assert.equal(stored.status, 'New'); assert.equal(stored.assignee, ''); assert.equal(stored.notes, ''); assert.equal(stored.source, 'public');
});

test('intake queues an in-app notification, records no email delivery and never calls the network', async () => {
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network disabled in tests'); };
  try {
    const response = await submit();
    assert.equal(response.status, 201);
    assert.match((await response.json()).message, /No email has been sent/);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls, 0);
  const [note] = await rows('SELECT * FROM notifications');
  assert.equal(note.email_status, 'disabled'); assert.equal(note.read_at, null); assert.equal(note.kind, 'inquiry.created');
  // Duplicate-delivery protection: the dedupe key is unique.
  db.exec(`INSERT OR IGNORE INTO notifications (id, dedupe_key, kind, subject_type, subject_id, title, created_at) VALUES ('dup', '${note.dedupe_key}', 'inquiry.created', 'inquiry', '${note.subject_id}', 't', 'now')`);
  assert.equal((await rows('SELECT id FROM notifications')).length, 1);
  const read = await notificationsRoute.POST(req('/api/notifications', 'POST', { ids: [note.id] }, owner));
  assert.equal((await read.json()).updated, 1);
  assert.ok((await rows('SELECT read_at FROM notifications'))[0].read_at);
});

// ── Legacy data migration ───────────────────────────────────────────────────

function legacyDocument() {
  const data = initialWorkspace();
  data.profile.owner = 'Keep me';
  data.inquiries = [
    { id: 'inq-awaiting', name: 'A', organization: 'Org A', email: 'a@example.test', sector: 'Education & learning', scope: 'Scope A', kind: 'Project briefing', createdAt: '2026-10-01T15:00:00.000Z', status: 'Awaiting review', notes: 'note A' },
    { id: 'inq-tentative', name: 'B', organization: 'Org B', email: 'b@example.test', sector: 'Other / to discuss', scope: 'Scope B', kind: 'Teaming inquiry', createdAt: '2026-10-02T15:00:00.000Z', status: 'Tentative', notes: '' },
    { id: 'inq-missing', name: 'C', organization: 'Org C', email: 'c@example.test', sector: 'S', scope: 'Scope C', kind: 'Project briefing', createdAt: '2026-10-03T15:00:00.000Z', status: 'Missing' },
    { id: 'inq-complete', name: 'D', organization: 'Org D', email: 'd@example.test', sector: 'S', scope: 'Scope D', kind: 'Project briefing', createdAt: 'not-a-date', status: 'Complete' },
    { name: 'No id', organization: 'Org E', email: 'e@example.test', sector: 'S', scope: 'Scope E', kind: 'Project briefing', status: 'Unexpected' },
  ];
  data.opportunities = [{ id: 'opp-legacy', title: 'Legacy pursuit', agency: 'Agency', url: '', deadline: '2026-12-15', value: '25000', naics: '541512', psc: '', stage: 'Prepare', decision: 'Go', owner: 'Olu', notes: 'Bid notes', checks: { scope: 'Yes', eligibility: 'Bogus' }, status: 'Tentative' }];
  data.activity = [{ text: 'Updated opportunity: Legacy pursuit', date: '2026-10-05T12:00:00.000Z' }];
  return data;
}

test('existing workspace data from migration 0001 upgrades through every later migration without loss', async () => {
  db.close(); db = database({ upTo: '0001' }); env.DB = db;
  const original = legacyDocument();
  await writeWorkspace(original, 0);
  // Upgrade exactly as an environment would: apply every later migration in order.
  const pending = migrationFiles().filter(f => f.slice(0, 4) > '0001');
  assert.equal(pending[0], '0002_connected_workflow.sql');
  for (const file of pending) db.applyMigration(file);

  const result = await workflow();
  const byId = Object.fromEntries(result.inquiries.map(i => [i.id, i]));
  assert.equal(result.inquiries.length, 5);
  assert.deepEqual(['inq-awaiting', 'inq-tentative', 'inq-missing', 'inq-complete'].map(id => byId[id].status), ['New', 'Reviewing', 'Awaiting information', 'Closed']);
  assert.equal(byId['inq-complete'].legacyStatus, 'Complete'); assert.match(byId['inq-complete'].reason, /before the workflow migration/);
  assert.equal(byId['inq-awaiting'].notes, 'note A'); assert.equal(byId['inq-awaiting'].createdAt, '2026-10-01T15:00:00.000Z');
  const generated = result.inquiries.find(i => i.organization === 'Org E');
  assert.match(generated.id, /^legacy-inquiry-/); assert.equal(generated.status, 'New'); assert.equal(generated.legacyStatus, 'Unexpected');
  const [opp] = result.opportunities;
  assert.equal(opp.id, 'opp-legacy'); assert.equal(opp.stage, 'Prepare'); assert.equal(opp.decision, 'Go'); assert.equal(opp.value, '25000');
  assert.deepEqual(opp.checks, { scope: 'Yes', eligibility: 'Unknown', capacity: 'Unknown', evidence: 'Unknown', deadline: 'Unknown' });
  assert.ok(result.activity.some(a => a.type === 'legacy.entry' && a.occurredAt === '2026-10-05T12:00:00.000Z'));
  assert.ok(result.activity.some(a => a.type === 'workflow.imported'));

  const stored = await readWorkspace();
  for (const key of ['inquiries', 'opportunities', 'activity']) assert.ok(!(key in stored.data), `${key} removed from document`);
  assert.equal(stored.data.profile.owner, 'Keep me'); assert.equal(stored.revision, 2);
  const [snapshot] = await rows('SELECT * FROM workspace_snapshots');
  assert.deepEqual(JSON.parse(snapshot.data), JSON.parse(JSON.stringify(original)), 'pre-migration document archived verbatim');
});

test('legacy import is safe to rerun and picks up records written by an outdated client', async () => {
  await writeWorkspace(legacyDocument(), 0);
  assert.equal((await importLegacyWorkflow()).imported, true);
  assert.equal((await importLegacyWorkflow()).imported, false);
  const stored = await readWorkspace();
  // An outdated client writes the arrays back (one duplicate, one new record).
  await writeWorkspace({ ...stored.data, inquiries: [legacyDocument().inquiries[0], { id: 'inq-late', name: 'L', organization: 'Late Org', email: 'l@example.test', sector: 'S', scope: 'late', kind: 'Project briefing', status: 'Awaiting review' }] }, stored.revision);
  assert.equal((await importLegacyWorkflow()).imported, true);
  const ids = (await rows('SELECT id FROM inquiries')).map(r => r.id);
  assert.equal(ids.length, 6); assert.ok(ids.includes('inq-late'));
  assert.equal(ids.filter(id => id === 'inq-awaiting').length, 1);
  assert.equal((await rows('SELECT id FROM workspace_snapshots')).length, 2);
});

test('owner document saves never recreate workflow copies in JSON', async () => {
  const data = initialWorkspace();
  const response = await workspace.PUT(req('/api/workspace', 'PUT', { data: { ...data, inquiries: [{ id: 'x' }], opportunities: [{ id: 'y' }], activity: [] }, revision: 0 }, owner));
  assert.equal(response.status, 200);
  const stored = await readWorkspace();
  for (const key of ['inquiries', 'opportunities', 'activity']) assert.ok(!(key in stored.data));
});

// ── Inquiry editing and transitions ─────────────────────────────────────────

test('inquiry edits validate transitions, reasons, dates and versions', async () => {
  await submit();
  let inq = (await workflow()).inquiries[0];
  const bad = async (changes, status = 400) => assert.equal((await patch(inq.id, inq.version, changes)).status, status, JSON.stringify(changes));
  await bad({ status: 'Qualified' });                    // reason required
  await bad({ status: 'Converted' });                    // conversion endpoint only
  await bad({ status: 'Archived' });                     // unknown
  await bad({ nextActionDue: '2026-02-30', nextAction: 'x' });
  await bad({ nextActionDue: '2026-12-01' });            // due without action
  await bad({ actor: 'spoofed' });                       // unsupported field
  await bad({ assignee: 'x'.repeat(121) });
  inq = (await (await patch(inq.id, inq.version, { status: 'Reviewing', assignee: 'Olu' })).json()).inquiry;
  assert.equal(inq.status, 'Reviewing'); assert.equal(inq.version, 2);
  assert.equal((await patch(inq.id, 1, { notes: 'stale' })).status, 409);
  inq = (await (await patch(inq.id, inq.version, { status: 'Closed', reason: 'Out of scope' })).json()).inquiry;
  await bad({ status: 'Qualified', reason: 'x' });       // Closed can only reopen to Reviewing
  inq = (await (await patch(inq.id, inq.version, { status: 'Reviewing' })).json()).inquiry;
  assert.equal(inq.status, 'Reviewing');
  const types = (await rows(`SELECT type FROM activity_events WHERE subject_id = '${inq.id}' ORDER BY occurred_at, rowid`)).map(r => r.type);
  for (const t of ['inquiry.received', 'inquiry.reviewed', 'inquiry.status_changed', 'inquiry.assigned']) assert.ok(types.includes(t), t);
});

test('follow-up scheduling and completion are recorded', async () => {
  await submit();
  let inq = (await workflow()).inquiries[0];
  inq = (await (await patch(inq.id, inq.version, { nextAction: 'Send capability statement', nextActionDue: '2026-11-20' })).json()).inquiry;
  inq = (await (await patch(inq.id, inq.version, { nextAction: '', nextActionDue: null })).json()).inquiry;
  assert.equal(inq.nextAction, ''); assert.equal(inq.nextActionDue, null);
  const types = (await rows("SELECT type FROM activity_events WHERE type LIKE 'followup.%'")).map(r => r.type);
  assert.deepEqual(types.sort(), ['followup.completed', 'followup.created']);
});

test('activity actor and time come from the server, never the request body', async () => {
  await submit();
  const inq = (await workflow()).inquiries[0];
  const before = new Date().toISOString();
  const res = await patch(inq.id, inq.version, { assignee: 'Olu' }, owner, { actor: 'spoofed-actor', occurredAt: '1999-01-01T00:00:00Z' });
  assert.equal(res.status, 200);
  const [event] = await rows("SELECT actor, occurred_at FROM activity_events WHERE type = 'inquiry.assigned'");
  assert.equal(event.actor, 'token:bearer'); assert.ok(event.occurred_at >= before);
  env.WORKSPACE_AUTH_MODE = 'sites'; env.WORKSPACE_OWNER_IDS = 'owner-123';
  const current = (await workflow({ 'oai-authenticated-user-id': 'owner-123' })).inquiries[0];
  await patch(inq.id, current.version, { assignee: 'Sam' }, { 'oai-authenticated-user-id': 'owner-123' });
  const actors = (await rows("SELECT actor FROM activity_events WHERE type = 'inquiry.assigned'")).map(r => r.actor);
  assert.deepEqual(actors.sort(), ['sites:owner-123', 'token:bearer']);
  const publicEvent = (await rows("SELECT actor, summary, details FROM activity_events WHERE type = 'inquiry.received'"))[0];
  assert.equal(publicEvent.actor, 'public');
  assert.ok(!JSON.stringify(publicEvent).includes(publicInquiry.email), 'no contact details in activity');
});

// ── Conversion ──────────────────────────────────────────────────────────────

test('conversion maps inquiry fields, links both records and records activity', async () => {
  const inq = await qualifiedInquiry();
  const draft = conversionDraft(inq);
  assert.equal(draft.agency, 'Riverside ISD'); assert.equal(draft.contactEmail, publicInquiry.email); assert.equal(draft.service, 'Training and education');
  assert.equal(draft.sector, 'Education & learning'); assert.match(draft.notes, /40 teachers/); assert.equal(draft.owner, 'Olu');
  assert.equal(draft.nextAction, 'Call to confirm scope'); assert.equal(draft.stage, 'Qualify');
  const response = await convert(inq.id, inq.version, { ...draft, title: 'Riverside ISD AI literacy', value: '18000' });
  assert.equal(response.status, 201);
  const { opportunity, inquiry } = await response.json();
  assert.equal(opportunity.sourceInquiryId, inq.id); assert.equal(inquiry.opportunityId, opportunity.id);
  assert.equal(inquiry.status, 'Converted'); assert.equal(opportunity.title, 'Riverside ISD AI literacy'); assert.equal(opportunity.value, '18000');
  assert.equal(opportunity.contactName, 'Dana Reviewer'); assert.equal(opportunity.nextActionDue, '2026-12-01');
  const types = (await rows('SELECT type FROM activity_events')).map(r => r.type);
  assert.ok(types.includes('inquiry.converted') && types.includes('opportunity.created'));
  // The source inquiry stays available, and only notes can change afterwards.
  assert.equal((await workflow()).inquiries[0].scope, publicInquiry.scope);
  assert.equal((await patch(inq.id, inquiry.version, { status: 'Reviewing' })).status, 400);
  assert.equal((await patch(inq.id, inquiry.version, { notes: 'Kick-off booked' })).status, 200);
});

test('conversion requires a qualified inquiry and a valid draft', async () => {
  await submit();
  const inq = (await workflow()).inquiries[0];
  assert.equal((await convert(inq.id, inq.version, conversionDraft(inq))).status, 409);
  const qualified = await qualifiedInquiry();
  assert.equal((await convert(qualified.id, qualified.version, { ...conversionDraft(qualified), title: '' })).status, 400);
  assert.equal((await convert(qualified.id, qualified.version, { ...conversionDraft(qualified), stage: 'Won' })).status, 400);
  assert.equal((await rows('SELECT id FROM opportunities')).length, 0);
});

test('duplicate and concurrent conversions create exactly one opportunity', async () => {
  const inq = await qualifiedInquiry();
  const draft = conversionDraft(inq);
  const [a, b] = await Promise.all([convert(inq.id, inq.version, draft), convert(inq.id, inq.version, draft)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 201]);
  const bodies = [await a.json(), await b.json()];
  assert.equal(bodies[0].opportunity.id, bodies[1].opportunity.id);
  assert.ok(bodies.some(x => x.alreadyConverted === true));
  const retry = await convert(inq.id, inq.version, draft);
  assert.equal(retry.status, 200); assert.equal((await retry.json()).alreadyConverted, true);
  assert.equal((await rows('SELECT id FROM opportunities')).length, 1);
  assert.equal((await rows("SELECT id FROM activity_events WHERE type = 'inquiry.converted'")).length, 1);
  // Database backstop: a second opportunity for the same inquiry violates the unique index.
  assert.throws(() => db.exec(`INSERT INTO opportunities (id, source_inquiry_id, title, checks, created_at, updated_at) VALUES ('dup', '${inq.id}', 't', '{}', 'n', 'n')`), /UNIQUE/);
});

// ── Opportunities ───────────────────────────────────────────────────────────

test('opportunities validate input, track versions and record updates', async () => {
  const bad = await opportunitiesRoute.POST(req('/api/opportunities', 'POST', { opportunity: { title: 'X', stage: 'Won' } }, owner));
  assert.equal(bad.status, 400);
  const created = await (await opportunitiesRoute.POST(req('/api/opportunities', 'POST', { opportunity: { title: 'State RFP', agency: 'TEA' } }, owner))).json();
  const opp = created.opportunity;
  assert.equal(opp.version, 1); assert.equal(opp.sourceInquiryId, null);
  const update = changes => opportunityRoute.PATCH(req(`/api/opportunities/${opp.id}`, 'PATCH', { version: opp.version, changes }, owner), params(opp.id));
  assert.equal((await update({ checks: { scope: 'Maybe' } })).status, 400);
  const updated = await (await update({ stage: 'Prepare', nextAction: 'Draft response', nextActionDue: '2026-11-30' })).json();
  assert.equal(updated.opportunity.stage, 'Prepare'); assert.equal(updated.opportunity.version, 2);
  assert.equal((await update({ notes: 'stale' })).status, 409);
  const types = (await rows(`SELECT type FROM activity_events WHERE subject_id = '${opp.id}'`)).map(r => r.type).sort();
  assert.deepEqual(types, ['followup.created', 'opportunity.created', 'opportunity.updated']);
});

// ── Follow-up dates (business timezone) ─────────────────────────────────────

test('business date uses America/Chicago across midnight and DST boundaries', () => {
  assert.equal(businessDate(new Date('2026-11-16T05:59:59Z')), '2026-11-15'); // 23:59 CST
  assert.equal(businessDate(new Date('2026-11-16T06:00:00Z')), '2026-11-16'); // 00:00 CST
  assert.equal(businessDate(new Date('2026-03-09T04:59:59Z')), '2026-03-08'); // 23:59 CDT (after spring-forward)
  assert.equal(businessDate(new Date('2026-03-09T05:00:00Z')), '2026-03-09');
  assert.equal(businessDate(new Date('2026-11-01T05:30:00Z')), '2026-11-01'); // 00:30 CDT on fall-back day
  assert.deepEqual(['2026-11-14', '2026-11-15', '2026-11-16', null].map(d => dueState(d, '2026-11-15')), ['overdue', 'today', 'upcoming', 'none']);
});

test('follow-up queue groups unassigned, overdue, due-today, conversion and opportunity actions', () => {
  const base = { kind: 'Project briefing', name: 'n', email: 'e', sector: 's', scope: 's', legacyStatus: null, notes: '', reason: '', opportunityId: null, source: 'public', version: 1, createdAt: 'c', updatedAt: 'u' };
  const inquiries = [
    { ...base, id: 'i1', organization: 'Unassigned', status: 'New', assignee: '', nextAction: '', nextActionDue: null },
    { ...base, id: 'i2', organization: 'Overdue', status: 'Reviewing', assignee: 'Olu', nextAction: 'Call', nextActionDue: '2026-11-14' },
    { ...base, id: 'i3', organization: 'Today', status: 'Awaiting information', assignee: 'Olu', nextAction: 'Email', nextActionDue: '2026-11-15' },
    { ...base, id: 'i4', organization: 'Qualified', status: 'Qualified', assignee: 'Olu', nextAction: '', nextActionDue: null },
    { ...base, id: 'i5', organization: 'Closed', status: 'Closed', assignee: '', nextAction: 'Ignore', nextActionDue: '2026-11-01' },
  ];
  const opp = { url: '', deadline: '', value: '', naics: '', psc: '', decision: 'Undecided', owner: '', notes: '', checks: {}, status: 'Tentative', contactName: '', contactEmail: '', sector: '', service: '', sourceInquiryId: null, agency: '', version: 1, createdAt: 'c', updatedAt: 'u' };
  const opportunities = [
    { ...opp, id: 'o1', title: 'No action', stage: 'Discover', nextAction: '', nextActionDue: null },
    { ...opp, id: 'o2', title: 'Late', stage: 'Prepare', nextAction: 'Draft', nextActionDue: '2026-11-10' },
    { ...opp, id: 'o3', title: 'Fine', stage: 'Prepare', nextAction: 'Review', nextActionDue: '2026-11-20' },
    { ...opp, id: 'o4', title: 'Closed', stage: 'Closed', nextAction: '', nextActionDue: null },
  ];
  const q = followUpQueue(inquiries, opportunities, '2026-11-15');
  assert.deepEqual(q.unassigned.map(i => i.id), ['i1']);
  assert.deepEqual(q.overdue.map(i => i.id), ['o2', 'i2']);
  assert.deepEqual(q.dueToday.map(i => i.id), ['i3']);
  assert.deepEqual(q.awaitingConversion.map(i => i.id), ['i4']);
  assert.deepEqual(q.opportunitiesNeedingAction.map(i => i.id), ['o2', 'o1']);
});

test('pure helpers: legacy status mapping and patch events', () => {
  assert.deepEqual(['Awaiting review', 'Tentative', 'Missing', 'Complete', 'Qualified', 'Converted', undefined].map(s => mapLegacyInquiryStatus(s).status),
    ['New', 'Reviewing', 'Awaiting information', 'Closed', 'Qualified', 'New', 'New']);
  const current = { id: 'i', status: 'New', assignee: '', nextAction: '', nextActionDue: null, notes: '', reason: '' };
  const r = applyInquiryPatch(current, { status: 'Qualified', reason: 'Fit', assignee: 'Olu' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.events.map(e => e.type), ['inquiry.reviewed', 'inquiry.status_changed', 'inquiry.assigned']);
});

// ── Persistence, export and public exposure ─────────────────────────────────

test('save/reload: workflow state persists across fresh reads and exports completely', async () => {
  const inq = await qualifiedInquiry();
  const converted = await (await convert(inq.id, inq.version, conversionDraft(inq))).json();
  const reloaded = await workflow();
  assert.equal(reloaded.inquiries[0].status, 'Converted');
  assert.equal(reloaded.opportunities[0].id, converted.opportunity.id);
  assert.match(reloaded.today, /^\d{4}-\d{2}-\d{2}$/); assert.equal(reloaded.businessTimeZone, 'America/Chicago');
  const document = (await (await workspace.GET(req('/api/workspace', 'GET', undefined, owner))).json()).data ?? initialWorkspace();
  const bundle = exportBundle(document, reloaded, new Date('2026-11-16T00:00:00Z'));
  assert.equal(bundle.schemaVersion, 2);
  assert.equal(bundle.workflow.inquiries.length, 1); assert.equal(bundle.workflow.opportunities.length, 1);
  assert.ok(bundle.workflow.activity.length >= 5);
  assert.equal(bundle.workflow.businessTimeZone, 'America/Chicago');
});

test('public endpoints never expose workflow records or internal fields', async () => {
  await writeWorkspace(initialWorkspace(), 0);
  const inq = await qualifiedInquiry();
  await patch(inq.id, inq.version, { notes: 'internal-only-note' });
  const text = await (await site.GET()).text();
  for (const secret of [publicInquiry.email, publicInquiry.organization, 'internal-only-note', 'Budget and timeline confirmed', 'Olu', 'Qualified', 'nextAction']) assert.ok(!text.includes(secret), secret);
});

test('reviewing a request clears its new-request notification; activity keeps insertion order', async () => {
  await submit();
  const inq = (await workflow()).inquiries[0];
  assert.equal((await workflow()).notifications.filter(n => !n.readAt).length, 1);
  await patch(inq.id, inq.version, { assignee: 'Olu' });
  assert.equal((await workflow()).notifications.filter(n => !n.readAt).length, 1, 'assignment alone keeps status New');
  const current = (await workflow()).inquiries[0];
  await patch(inq.id, current.version, { status: 'Reviewing' });
  const after = await workflow();
  assert.equal(after.notifications.filter(n => !n.readAt).length, 0);
  assert.deepEqual(after.activity.slice(0, 2).map(a => a.type), ['inquiry.status_changed', 'inquiry.reviewed']);
});
