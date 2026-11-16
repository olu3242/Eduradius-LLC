// Migration inspection, interrupted operations, compatibility without the newest migration, and
// the tested rollback path to the pre-workflow application (Site v5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { env } from './helpers/worker-env.mjs';
import { database, migrationFiles } from './helpers/database.mjs';
import { ctx, withIsolatedDatabase, req, added, acted, opportunity, awardedSubmission, projectInput } from './helpers/api.mjs';
import * as list from '../app/api/records/[type]/route.ts';
import * as contextRoute from '../app/api/context/[type]/[id]/route.ts';
import * as reportsRoute from '../app/api/reports/route.ts';
import * as exportRoute from '../app/api/export/route.ts';
import * as workflowRoute from '../app/api/workflow/route.ts';
import * as inquiryRoute from '../app/api/inquiries/[id]/route.ts';
import * as convertRoute from '../app/api/inquiries/[id]/convert/route.ts';
import { migrationStatus, resumeStatements, schemaRows, SCHEMA_QUERY } from '../scripts/migration-status.mjs';
import { legacyDocument, acceptedByLegacySave } from '../lib/legacy-rollback.ts';
import { initialWorkspace } from '../lib/workspace.ts';
import { importLegacyWorkflow, createPublicInquiry } from '../lib/server/workflow-store.ts';
import { readWorkspace, writeWorkspace } from '../lib/server/workspace-store.ts';

withIsolatedDatabase();
const p = obj => ({ params: Promise.resolve(obj) });
const rowsOf = async db => schemaRows((await db.prepare(SCHEMA_QUERY).all()).results);
const migrationSql = f => readFileSync(new URL(`../drizzle/${f}`, import.meta.url), 'utf8');
const statementsOf = f => migrationSql(f).split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
const useDatabase = db => { ctx.db.close(); ctx.db = db; env.DB = db; };
const exported = async () => (await (await exportRoute.GET(req('/api/export', 'GET'))).json());

test('migration status: a full database is consistent and an earlier one gets exactly the pending files', async () => {
  const full = await rowsOf(ctx.db);
  const status = migrationStatus(full);
  assert.equal(status.consistent, true); assert.deepEqual(status.toApply, []); assert.equal(status.applied.length, migrationFiles().length);
  const earlier = database({ upTo: '0003' });
  const partialStatus = migrationStatus(await rowsOf(earlier));
  assert.deepEqual(partialStatus.applied, migrationFiles().filter(f => f <= '0003z'));
  assert.deepEqual(partialStatus.toApply, migrationFiles().filter(f => f > '0003z'));
  earlier.close();
  const empty = migrationStatus([]);
  assert.equal(empty.consistent, true); assert.deepEqual(empty.toApply, migrationFiles());
});

test('migration status detects partial and out-of-order files and resumes exactly the missing statements', async () => {
  // Interrupted 0007: only some of its indexes were created before the failure.
  const db = database({ upTo: '0006' });
  const file = migrationFiles().find(f => f.startsWith('0007'));
  const statements = statementsOf(file);
  for (const st of statements.slice(0, 7)) db.exec(st);
  let status = migrationStatus(await rowsOf(db));
  assert.equal(status.consistent, false); assert.deepEqual(status.toApply, []);
  assert.equal(status.problems[0].file, file); assert.equal(status.problems[0].state, 'partial'); assert.equal(status.problems[0].missing.length, statements.length - 7);
  assert.throws(() => db.exec(statements[0]), /already exists/, 'rerunning the whole file fails');
  for (const st of resumeStatements(file, await rowsOf(db))) db.exec(st);
  status = migrationStatus(await rowsOf(db));
  assert.equal(status.consistent, true); assert.deepEqual(status.toApply, migrationFiles().filter(f => f > file), 'later files are still prescribed, in order');
  db.close();

  // Interrupted 0003 after its tables but before the added columns, with data already present.
  const db3 = database({ upTo: '0002' });
  db3.exec("INSERT INTO inquiries (id, kind, name, organization, email, sector, scope, created_at, updated_at) VALUES ('keep-me', 'Project briefing', 'N', 'O', 'e@example.test', 'S', 'S', 'x', 'x')");
  const s3 = migrationFiles().find(f => f.startsWith('0003'));
  for (const st of statementsOf(s3).filter(st => !st.startsWith('ALTER'))) db3.exec(st);
  assert.equal(migrationStatus(await rowsOf(db3)).problems[0].file, s3);
  const resume = resumeStatements(s3, await rowsOf(db3));
  assert.ok(resume.every(st => st.startsWith('ALTER TABLE')) && resume.length === 4);
  for (const st of resume) db3.exec(st);
  for (const f of migrationFiles().filter(f => f > s3)) db3.applyMigration(f);
  assert.equal(migrationStatus(await rowsOf(db3)).consistent, true);
  assert.equal((await db3.prepare("SELECT organization_id FROM inquiries WHERE id = 'keep-me'").first()).organization_id, null, 'existing rows kept');
  db3.close();

  // Out of order: 0006 applied while 0005 is missing.
  const db6 = database({ upTo: '0004' });
  db6.applyMigration(migrationFiles().find(f => f.startsWith('0006')));
  const s6 = migrationStatus(await rowsOf(db6));
  assert.equal(s6.consistent, false); assert.ok(s6.problems.some(p => p.file.startsWith('0006')));
  db6.close();
});

test('this release runs on a database without migration 0007 (indexes only), just without the new indexes', async () => {
  const db = database({ upTo: '0006' });
  for (const f of migrationFiles().filter(f => f > '0007z')) db.applyMigration(f); // every file except 0007
  useDatabase(db);
  const opp = await opportunity('Before 0007');
  await added('organization', { name: 'Org before 0007', orgType: 'Teaming partner' });
  assert.equal((await list.GET(req('/api/records/opportunity?q=0007', 'GET'), p({ type: 'opportunity' }))).status, 200);
  assert.equal((await contextRoute.GET(req(`/api/context/opportunity/${opp.id}`, 'GET'), p({ type: 'opportunity', id: opp.id }))).status, 200);
  assert.equal((await reportsRoute.GET(req('/api/reports', 'GET'))).status, 200);
  assert.equal((await workflowRoute.GET(req('/api/workflow', 'GET'))).status, 200);
  assert.equal((await exported()).manifest.counts.organization, 1);
});

test('an interrupted legacy import changes nothing and the retry imports everything once', async () => {
  const doc = initialWorkspace();
  doc.inquiries = [{ id: 'legacy-1', name: 'L', organization: 'Legacy Org', email: 'l@example.test', sector: 'S', scope: 'S', kind: 'Project briefing', createdAt: '2026-10-01T15:00:00.000Z', status: 'Tentative' }];
  doc.activity = [{ text: 'Legacy entry', date: '2026-10-05T12:00:00.000Z' }];
  await writeWorkspace(doc, 0);
  const realBatch = ctx.db.batch.bind(ctx.db);
  ctx.db.batch = async statements => { ctx.db.batch = realBatch; return realBatch([...statements.slice(0, 3), { _exec() { throw new Error('simulated interruption'); } }]); };
  await assert.rejects(importLegacyWorkflow(), /simulated interruption/);
  assert.equal((await ctx.db.prepare('SELECT COUNT(*) AS n FROM inquiries').first()).n, 0, 'no partial rows');
  assert.equal((await ctx.db.prepare('SELECT COUNT(*) AS n FROM workspace_snapshots').first()).n, 0, 'no partial snapshot');
  assert.ok(Array.isArray((await readWorkspace()).data.inquiries), 'document unchanged');
  assert.equal((await importLegacyWorkflow()).imported, true);
  assert.equal((await ctx.db.prepare('SELECT COUNT(*) AS n FROM inquiries').first()).n, 1);
});

test('rollback to the pre-workflow app and forward again preserves every record, id, link and version', async () => {
  // 1. Legacy document from the live Site, imported on the first owner load of this release.
  const doc = initialWorkspace();
  doc.inquiries = [{ id: 'legacy-inq', name: 'Legacy Person', organization: 'Legacy District', email: 'legacy@example.test', sector: 'S', scope: 'Legacy scope', kind: 'Project briefing', createdAt: '2026-10-01T15:00:00.000Z', status: 'Missing', notes: 'legacy note' }];
  doc.opportunities = [{ id: 'legacy-opp', title: 'Legacy pursuit', agency: 'Agency', url: '', deadline: '2026-12-15', value: '', naics: '', psc: '', stage: 'Prepare', decision: 'Go', owner: 'Olu', notes: '', checks: { scope: 'Yes' }, status: 'Tentative' }];
  doc.activity = [{ text: 'Legacy activity entry', date: '2026-10-05T12:00:00.000Z' }];
  await writeWorkspace(doc, 0);
  await (await workflowRoute.GET(req('/api/workflow', 'GET'))).json();
  assert.ok(!('opportunities' in (await readWorkspace()).data), 'import strips the legacy arrays');
  assert.equal(acceptedByLegacySave((await readWorkspace()).data), false, 'a code-only rollback could not save the stripped document');

  // 2. Records created after the import: a public request converted to an opportunity, contracting and delivery records.
  const { id: newInquiryId } = await createPublicInquiry({ kind: 'Teaming inquiry', name: 'New Person', organization: 'New District', email: 'new@example.test', sector: 'S', scope: 'Post-import request' });
  let inquiry = (await (await inquiryRoute.PATCH(req(`/api/inquiries/${newInquiryId}`, 'PATCH', { version: 1, changes: { status: 'Qualified', reason: 'Fits', assignee: 'Olu' } }), p({ id: newInquiryId }))).json()).inquiry;
  const converted = await (await convertRoute.POST(req(`/api/inquiries/${newInquiryId}/convert`, 'POST', { version: inquiry.version, opportunity: { title: 'Converted pursuit' } }), p({ id: newInquiryId }))).json();
  const { submission, org } = await awardedSubmission();
  const { record: project } = await acted('project.createFromAward', projectInput(submission, { clientOrganizationId: org.id }), 201);
  const requirement = await added('requirement', { opportunityId: 'legacy-opp', description: 'Linked to a legacy opportunity' });
  const before = await exported();

  // 3. Roll back: rebuild the legacy document from the export and apply it (what the operator SQL does).
  const rollback = legacyDocument(before.workspace, before.workflow, initialWorkspace());
  assert.equal(rollback.fitsLegacyLimit, true); assert.equal(acceptedByLegacySave(rollback.document), true);
  const legacyIds = rollback.document.inquiries.map(i => i.id);
  assert.deepEqual(legacyIds.sort(), ['legacy-inq', newInquiryId].sort(), 'every request, old and new, with its id');
  assert.equal(rollback.document.inquiries.find(i => i.id === 'legacy-inq').status, 'Missing', 'unchanged imported status restored exactly');
  assert.equal(rollback.document.inquiries.find(i => i.id === newInquiryId).status, 'Complete', 'converted maps to Complete');
  assert.ok(rollback.document.opportunities.some(o => o.id === converted.opportunity.id) && rollback.document.opportunities.some(o => o.id === 'legacy-opp'));
  assert.deepEqual(rollback.document.activity, [{ text: 'Legacy activity entry', date: '2026-10-05T12:00:00.000Z' }]);
  const stored = await readWorkspace();
  await ctx.db.prepare("UPDATE workspaces SET data = ?, revision = revision + 1 WHERE id = 'eduradius' AND revision = ?").bind(JSON.stringify(rollback.document), stored.revision).run();

  // 4. While on v5: a visitor request arrives (v5 appends it to the document) and the owner saves.
  const v5 = (await readWorkspace());
  v5.data.inquiries.push({ id: 'v5-inq', name: 'During rollback', organization: 'Rollback District', email: 'r@example.test', sector: 'S', scope: 'S', kind: 'Project briefing', createdAt: '2026-11-20T10:00:00.000Z', status: 'Awaiting review' });
  await ctx.db.prepare("UPDATE workspaces SET data = ?, revision = revision + 1 WHERE id = 'eduradius'").bind(JSON.stringify(v5.data)).run();

  // 5. Forward again: the import adds only the v5-period request; nothing is duplicated or changed.
  const result = await importLegacyWorkflow();
  assert.equal(result.imported, true);
  const after = await exported();
  assert.equal(after.workflow.inquiries.length, before.workflow.inquiries.length + 1);
  assert.ok(after.workflow.inquiries.some(i => i.id === 'v5-inq'));
  const strip = bundle => ({ ...bundle.workflow, inquiries: bundle.workflow.inquiries.filter(i => i.id !== 'v5-inq'), activity: bundle.workflow.activity.filter(a => !['legacy.entry', 'workflow.imported'].includes(a.type) || a.occurredAt < '2026-11-01') });
  assert.deepEqual(strip(after), strip(before), 'ids, versions, links and contracting records unchanged');
  assert.equal(after.workflow.activity.filter(a => a.type === 'legacy.entry').length, 1, 'legacy activity not duplicated');
  assert.equal(after.workflow.records.project.find(x => x.id === project.id).clientOrganizationId, org.id);
  assert.equal(after.workflow.records.requirement.find(x => x.id === requirement.id).opportunityId, 'legacy-opp');
  assert.equal((await ctx.db.prepare('SELECT COUNT(*) AS n FROM workspace_snapshots').first()).n, 2, 'each import keeps its own snapshot');
});

// ── Rollback-window edits: explicit owner decisions, never silent loss ───────

import * as actionsRoute from '../app/api/actions/[action]/route.ts';
import * as conflictsRoute from '../app/api/import-conflicts/route.ts';
import { withRollbackMarker } from '../lib/legacy-rollback.ts';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const decide = async body => actionsRoute.POST(req('/api/actions/importConflict.resolve', 'POST', body), p({ action: 'importConflict.resolve' }));
const openConflicts = async () => (await (await conflictsRoute.GET(req('/api/import-conflicts', 'GET'))).json());
async function importedLegacy() {
  const doc = initialWorkspace();
  doc.inquiries = [
    { id: 'inq-a', name: 'A', organization: 'Alpha District', email: 'a@example.test', sector: 'S', scope: 'Scope A', kind: 'Project briefing', createdAt: '2026-10-01T15:00:00.000Z', status: 'Missing', notes: 'original A' },
    { id: 'inq-b', name: 'B', organization: 'Beta District', email: 'b@example.test', sector: 'S', scope: 'Scope B', kind: 'Project briefing', createdAt: '2026-10-02T15:00:00.000Z', status: 'Tentative', notes: '' },
  ];
  doc.opportunities = [{ id: 'opp-a', title: 'Alpha pursuit', agency: 'Agency', url: '', deadline: '', value: '', naics: '', psc: '', stage: 'Prepare', decision: 'Go', owner: 'Olu', notes: '', checks: {}, status: 'Tentative' }];
  doc.activity = [];
  await writeWorkspace(doc, 0);
  await workflowRoute.GET(req('/api/workflow', 'GET'));
}
async function rollbackToV5(edit) {
  const bundle = await exported();
  const rebuilt = legacyDocument(bundle.workspace, bundle.workflow, initialWorkspace()).document;
  const doc = await withRollbackMarker(rebuilt, '2026-11-16T00:00:00.000Z');
  const stored = await readWorkspace();
  await ctx.db.prepare("UPDATE workspaces SET data = ?, revision = revision + 1 WHERE id = 'eduradius' AND revision = ?").bind(JSON.stringify(doc), stored.revision).run();
  const v5 = await readWorkspace(); edit(v5.data); // what v5 saves while it is live
  await ctx.db.prepare("UPDATE workspaces SET data = ?, revision = revision + 1 WHERE id = 'eduradius'").bind(JSON.stringify(v5.data)).run();
  return bundle;
}

test('rollback-window edits to existing records become open conflicts; tables keep their values until the owner decides', async () => {
  await importedLegacy();
  const before = await rollbackToV5(d => {
    d.inquiries.find(i => i.id === 'inq-a').notes += '\nCalled back during rollback';
    d.inquiries.find(i => i.id === 'inq-a').status = 'Complete';
    d.opportunities.find(o => o.id === 'opp-a').title = 'Alpha pursuit (renamed in v5)';
    d.inquiries.push({ id: 'inq-new', name: 'N', organization: 'New District', email: 'n@example.test', sector: 'S', scope: 'S', kind: 'Project briefing', createdAt: '2026-11-20T10:00:00.000Z', status: 'Awaiting review' });
  });
  const result = await importLegacyWorkflow();
  assert.equal(result.imported, true); assert.equal(result.conflicts, 2);
  const after = await exported();
  assert.deepEqual(after.workflow.inquiries.find(i => i.id === 'inq-a'), before.workflow.inquiries.find(i => i.id === 'inq-a'), 'table value kept, not overwritten');
  assert.ok(after.workflow.inquiries.some(i => i.id === 'inq-new'), 'new v5 record imported');
  assert.equal(after.workflow.inquiries.find(i => i.id === 'inq-b').version, 1, 'untouched record has no conflict');
  const list = await openConflicts();
  assert.equal(list.total, 2);
  const inqConflict = list.items.find(c => c.subjectId === 'inq-a'), oppConflict = list.items.find(c => c.subjectId === 'opp-a');
  assert.deepEqual(inqConflict.fields.sort(), ['notes', 'status']); assert.deepEqual(oppConflict.fields, ['title']);
  assert.equal((await (await workflowRoute.GET(req('/api/workflow', 'GET'))).json()).openImportConflicts, 2);
  assert.equal((await ctx.db.prepare('SELECT COUNT(*) AS n FROM workspace_snapshots').first()).n, 2, 'the v5 document is kept in its own snapshot');

  // Decisions are explicit, reasoned and version-guarded.
  assert.equal((await decide({ id: oppConflict.id, version: oppConflict.version, decision: 'keep-current' })).status, 400, 'reason required');
  assert.equal((await decide({ id: oppConflict.id, version: oppConflict.version, decision: 'merge', reason: 'x' })).status, 400);
  assert.equal((await decide({ id: oppConflict.id, version: 99, decision: 'keep-current', reason: 'x' })).status, 409);
  const kept = await decide({ id: oppConflict.id, version: oppConflict.version, decision: 'keep-current', reason: 'The workflow title is correct.' });
  assert.equal(kept.status, 200); assert.equal((await kept.json()).record.title, 'Alpha pursuit');
  assert.equal((await decide({ id: oppConflict.id, version: oppConflict.version + 1, decision: 'apply-legacy', reason: 'retry' })).status, 409, 'decided once');
  const applied = await decide({ id: inqConflict.id, version: inqConflict.version, decision: 'apply-legacy', reason: 'The call happened during the rollback.' });
  assert.equal(applied.status, 200, await applied.clone().text());
  const record = (await applied.json()).record;
  assert.equal(record.notes, 'original A\nCalled back during rollback'); assert.equal(record.status, 'Closed'); assert.equal(record.legacyStatus, 'Complete');
  assert.equal(record.version, before.workflow.inquiries.find(i => i.id === 'inq-a').version + 1);
  const activity = (await exported()).workflow.activity.map(a => a.type);
  assert.ok(activity.includes('import.conflict_kept') && activity.includes('import.conflict_applied') && activity.includes('import.conflicts_detected'));
  assert.equal((await openConflicts()).total, 0);
  // Re-running the import (another owner load) records nothing twice.
  await importLegacyWorkflow();
  assert.equal((await ctx.db.prepare('SELECT COUNT(*) AS n FROM import_conflicts').first()).n, 2);
});

test('applying a legacy edit is refused when the record changed after the conflict was found', async () => {
  await importedLegacy();
  await rollbackToV5(d => { d.opportunities[0].notes = 'v5 note'; });
  await importLegacyWorkflow();
  const [c] = (await openConflicts()).items;
  const opp = (await exported()).workflow.opportunities.find(o => o.id === 'opp-a');
  await ctx.db.prepare("UPDATE opportunities SET notes = 'edited later', version = version + 1 WHERE id = 'opp-a'").run();
  const r = await decide({ id: c.id, version: c.version, decision: 'apply-legacy', reason: 'apply' });
  assert.equal(r.status, 409);
  assert.equal((await openConflicts()).total, 1, 'still open');
  assert.equal((await ctx.db.prepare("SELECT notes FROM opportunities WHERE id = 'opp-a'").first()).notes, 'edited later'); void opp;
});

test('without a rollback marker, edits by an outdated client are compared with the previous import snapshot', async () => {
  await importedLegacy();
  const stored = await readWorkspace();
  const original = JSON.parse((await ctx.db.prepare('SELECT data FROM workspace_snapshots').first()).data);
  original.inquiries.find(i => i.id === 'inq-b').notes = 'edited in an old tab';
  await ctx.db.prepare("UPDATE workspaces SET data = ?, revision = revision + 1 WHERE id = 'eduradius' AND revision = ?").bind(JSON.stringify({ ...stored.data, inquiries: original.inquiries, opportunities: original.opportunities }), stored.revision).run();
  const result = await importLegacyWorkflow();
  assert.equal(result.conflicts, 1);
  assert.deepEqual((await openConflicts()).items[0].fields, ['notes']);
});

test('the v5 rollback tool refuses incomplete exports, oversize documents and unconfirmed runs', async () => {
  await importedLegacy();
  const bundle = await exported();
  const dir = mkdtempSync(join(tmpdir(), 'rollback-')), run = (file, ...extra) => spawnSync(process.execPath, ['scripts/recovery/legacy-document.mjs', '--from-export', file, '--out', join(dir, 'out'), ...extra], { encoding: 'utf8' });
  const write = (name, value) => { const f = join(dir, name); writeFileSync(f, JSON.stringify(value)); return f; };
  const incomplete = run(write('incomplete.json', { ...bundle, workflow: { ...bundle.workflow, inquiries: bundle.workflow.inquiries.slice(1) } }), '--confirm-v5-rollback');
  assert.equal(incomplete.status, 2); assert.match(incomplete.stderr, /incomplete/);
  const big = run(write('big.json', { ...bundle, workflow: { ...bundle.workflow, inquiries: bundle.workflow.inquiries.map(i => ({ ...i, scope: 'x'.repeat(400000) })) } }), '--confirm-v5-rollback');
  assert.equal(big.status, 2); assert.match(big.stderr, /cannot save documents over 700000/);
  const unconfirmed = run(write('ok.json', bundle));
  assert.equal(unconfirmed.status, 3); assert.ok(!existsSync(join(dir, 'out', 'legacy-workspace.json')), 'nothing written without confirmation');
  const ok = run(join(dir, 'ok.json'), '--confirm-v5-rollback');
  assert.equal(ok.status, 0, ok.stderr);
  const doc = JSON.parse(readFileSync(join(dir, 'out', 'legacy-workspace.json'), 'utf8'));
  assert.equal(Object.keys(doc._rollback.fingerprints).length, 3);
  assert.match(readFileSync(join(dir, 'out', 'apply-legacy-workspace.sql'), 'utf8'), /WHERE id = 'eduradius' AND revision = \d+;/);
});
