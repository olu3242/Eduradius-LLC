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
  assert.equal(status.consistent, true); assert.deepEqual(status.toApply, []);
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
  useDatabase(database({ upTo: '0006' }));
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
