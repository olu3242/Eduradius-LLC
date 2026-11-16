import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from './helpers/worker-env.mjs';
import { database, migrationFiles } from './helpers/database.mjs';
import { withIsolatedDatabase, ctx, acted, act, added, snapshot, awardedSubmission, projectInput, rows, token } from './helpers/api.mjs';
import * as health from '../app/api/health/route.ts';
import * as ready from '../app/api/health/ready/route.ts';
import * as site from '../app/api/site/route.ts';
import { redactLogFields, logEvent } from '../lib/server/http.ts';
import { runWithRequestId, requestIdFor } from '../lib/server/request-context.ts';
import { writeWorkspace, readWorkspace } from '../lib/server/workspace-store.ts';
import { initialWorkspace } from '../lib/workspace.ts';

withIsolatedDatabase();

// ── Health and readiness ────────────────────────────────────────────────────

test('liveness and readiness expose only ok/not-ok states, never configuration or data', async () => {
  const live = await (await health.GET()).json();
  assert.equal(live.status, 'ok'); assert.ok('build' in live);
  const ok = await ready.GET();
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.deepEqual(body.checks, { database: 'ok', schema: 'ok', access: 'configured' });
  const text = JSON.stringify(body);
  for (const leak of [token, 'token', 'sites', 'inquiries', 'workspaces', 'DB']) assert.ok(!text.includes(leak), leak);
  delete env.WORKSPACE_AUTH_MODE;
  assert.equal((await ready.GET()).status, 503, 'unconfigured access is not ready');
  env.WORKSPACE_AUTH_MODE = 'token';
  ctx.db.close(); ctx.db = database({ upTo: '0004' }); env.DB = ctx.db;
  const partial = await ready.GET();
  assert.equal(partial.status, 503); assert.equal((await partial.json()).checks.schema, 'incomplete');
  delete env.DB;
  assert.equal((await (await ready.GET()).json()).checks.database, 'unavailable');
});

test('logs are structured, correlated and redacted', () => {
  const redacted = redactLogFields({ email: 'a@b.test', token: 'secret', nested: { phone: '555', ok: 1 }, message: 'x'.repeat(500), reason: 'not_owner' });
  assert.equal(redacted.email, '[redacted]'); assert.equal(redacted.token, '[redacted]'); assert.equal(redacted.nested.phone, '[redacted]');
  assert.equal(redacted.nested.ok, 1); assert.equal(redacted.reason, 'not_owner'); assert.ok(redacted.message.length <= 301);
  const lines = [], original = console.log;
  console.log = line => lines.push(line);
  try { runWithRequestId('req-test-123456', () => logEvent('test.event', { email: 'private@example.test' })); } finally { console.log = original; }
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.requestId, 'req-test-123456'); assert.equal(parsed.email, '[redacted]');
  assert.equal(requestIdFor(new Request('https://x.test', { headers: { 'x-request-id': 'bad id with spaces' } })).length, 36, 'malformed incoming ids are replaced');
  assert.equal(requestIdFor(new Request('https://x.test', { headers: { 'x-request-id': 'edge-abcdef12' } })), 'edge-abcdef12');
});

// ── Migrations: empty database and the earliest supported version ───────────

test('an empty database migrates through every file to the full schema', async () => {
  const fresh = database();
  const tables = (await fresh.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results.map(r => r.name);
  fresh.close();
  assert.equal(migrationFiles().length, 8);
  for (const t of ['workspaces', 'rate_limits', 'inquiries', 'organizations', 'proposal_versions', 'projects', 'experience_records']) assert.ok(tables.includes(t), t);
});

test('the earliest supported version (Site v5, migration 0000 only) upgrades without data loss', async () => {
  ctx.db.close(); ctx.db = database({ upTo: '0000' }); env.DB = ctx.db;
  const original = initialWorkspace();
  original.profile.contact = 'Original owner contact';
  original.inquiries = [{ id: 'v5-inquiry', name: 'V5 Visitor', organization: 'V5 District', email: 'v5@example.test', sector: 'Education & learning', scope: 'Original v5 request', kind: 'Project briefing', createdAt: '2026-11-01T12:00:00.000Z', status: 'Awaiting review', notes: 'v5 note' }];
  original.opportunities = [{ id: 'v5-opportunity', title: 'V5 pursuit', agency: 'V5 Agency', url: '', deadline: '', value: '', naics: '', psc: '', stage: 'Qualify', decision: 'Undecided', owner: '', notes: '', checks: { scope: 'Yes' }, status: 'Tentative' }];
  original.activity = [{ text: 'Updated opportunity: V5 pursuit', date: '2026-11-02T12:00:00.000Z' }];
  await writeWorkspace(original, 0);
  for (const file of migrationFiles().filter(f => f.slice(0, 4) > '0000')) ctx.db.applyMigration(file);
  const snap = await snapshot();
  assert.equal(snap.inquiries[0].id, 'v5-inquiry'); assert.equal(snap.inquiries[0].notes, 'v5 note'); assert.equal(snap.inquiries[0].organizationId, null);
  assert.equal(snap.opportunities[0].id, 'v5-opportunity'); assert.equal(snap.opportunities[0].checks.scope, 'Yes');
  assert.ok(snap.activity.some(a => a.type === 'legacy.entry'));
  const doc = await readWorkspace();
  assert.equal(doc.data.profile.contact, 'Original owner contact'); assert.equal(doc.revision, 2);
  assert.deepEqual(JSON.parse((await rows('SELECT data FROM workspace_snapshots'))[0].data), JSON.parse(JSON.stringify(original)));
  // Later features work on upgraded data: link the migrated opportunity to a new organization.
  const org = await added('organization', { name: 'V5 Agency' });
  const opp = snap.opportunities[0];
  await acted('opportunity.link', { id: opp.id, version: opp.version, organizationId: org.id });
});

// ── Interrupted multi-record operations ─────────────────────────────────────

test('a failure inside a multi-record action leaves no partial records', async () => {
  const { submission } = await awardedSubmission();
  const realBatch = ctx.db.batch.bind(ctx.db);
  // Fail the batch at its third statement (after the project and baseline inserts run).
  ctx.db.batch = async statements => realBatch(statements.map((s, i) => (i === 2 ? { _exec() { s._exec(); throw new Error('simulated interruption'); } } : s)));
  const response = await act('project.createFromAward', projectInput(submission));
  ctx.db.batch = realBatch;
  assert.equal(response.status, 503);
  for (const table of ['projects', 'project_baselines', 'deliverables']) assert.equal((await rows(`SELECT id FROM ${table}`)).length, 0, `${table} rolled back`);
  assert.equal((await rows("SELECT id FROM activity_events WHERE type = 'project.created'")).length, 0);
  const { record } = await acted('project.createFromAward', projectInput(submission), 201);
  assert.equal(record.status, 'Planning', 'the retry succeeds cleanly');
});

test('concurrent edits: one wins, the stale writer gets 409 with the current record', async () => {
  const org = await added('organization', { name: 'Concurrency Co' });
  const { edit } = await import('./helpers/api.mjs');
  const [a, b] = await Promise.all([edit('organization', org, { notes: 'A' }), edit('organization', org, { notes: 'B' })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const loser = a.status === 409 ? a : b;
  assert.ok((await loser.json()).current.version === 2);
});

test('public website content never includes Stage 3-4 records', async () => {
  await writeWorkspace(initialWorkspace(), 0);
  const { submission } = await awardedSubmission();
  await acted('project.createFromAward', projectInput(submission, { scope: 'PRIVATE-SCOPE-MARKER' }), 201);
  const text = await (await site.GET()).text();
  assert.ok(!text.includes('PRIVATE-SCOPE-MARKER') && !text.includes('Riverside proposal') && !text.includes('Notice of award'));
  assert.ok((await snapshot()).records.project.length === 1);
});
