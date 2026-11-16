// Server-side pagination, search, filters, relationships, reports, follow-ups and exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctx, withIsolatedDatabase, req, owner, added, edited, acted, opportunity, snapshot, rows, awardedSubmission, projectInput } from './helpers/api.mjs';
import * as list from '../app/api/records/[type]/route.ts';
import * as single from '../app/api/records/[type]/[id]/route.ts';
import * as contextRoute from '../app/api/context/[type]/[id]/route.ts';
import * as followupsRoute from '../app/api/followups/route.ts';
import * as reportsRoute from '../app/api/reports/route.ts';
import * as exportRoute from '../app/api/export/route.ts';
import * as linksRoute from '../app/api/evidence-links/route.ts';
import * as duplicatesRoute from '../app/api/organizations/duplicates/route.ts';
import * as workflowRoute from '../app/api/workflow/route.ts';
import * as site from '../app/api/site/route.ts';
import { operationalReport } from '../lib/reports.ts';
import { businessDate } from '../lib/workflow.ts';
import { buildExport } from '../lib/server/export.ts';
import { createPublicInquiry } from '../lib/server/workflow-store.ts';

withIsolatedDatabase();
const p = obj => ({ params: Promise.resolve(obj) });
const get = (type, qs = '', headers) => list.GET(req(`/api/records/${type}${qs ? '?' + qs : ''}`, 'GET', undefined, headers), p({ type }));
async function page(type, qs = '') { const r = await get(type, qs); assert.equal(r.status, 200, await r.clone().text()); return r.json(); }
async function all(type, qs = '', limit = 25) {
  const seen = []; let cursor = null, pages = 0;
  do {
    const body = await page(type, [qs, `limit=${limit}`, cursor ? `cursor=${encodeURIComponent(cursor)}` : ''].filter(Boolean).join('&'));
    seen.push(...body.items); cursor = body.page.nextCursor; pages++;
    assert.equal(body.page.hasMore, Boolean(cursor));
  } while (cursor && pages < 100);
  return { items: seen, pages };
}
const orgs = async (n, prefix = 'Org') => { for (let i = 0; i < n; i++) await added('organization', { name: `${prefix} ${String(i).padStart(3, '0')}`, orgType: i % 2 ? 'Government buyer' : 'Teaming partner' }, { confirmDistinct: true }); };
/** Bulk rows for volume tests, written directly (the store paths are covered elsewhere). */
function bulkOpportunities(n, extra = {}) {
  const at = '2026-11-01T00:00:00.000Z';
  const insert = ctx.db.prepare("INSERT INTO opportunities (id, title, checks, version, created_at, updated_at, next_action, next_action_due, stage) VALUES (?, ?, '{}', 1, ?, ?, ?, ?, ?)");
  for (let i = 0; i < n; i++) insert.bind(`bulk-opp-${i}`, `Bulk opportunity ${i}`, at, at, extra.nextAction ?? '', extra.due ?? null, extra.stage ?? 'Discover')._exec();
}

test('pages have a bounded default and maximum size and walk the whole set exactly once', async () => {
  await orgs(60);
  const first = await page('organization');
  assert.equal(first.items.length, 25); assert.equal(first.page.limit, 25); assert.equal(first.page.total, 60); assert.equal(first.page.hasMore, true);
  // Newest first; records created in the same millisecond are ordered by id (the tie-breaker).
  assert.equal(first.items[0].name, (await rows('SELECT name FROM organizations ORDER BY created_at DESC, id DESC LIMIT 1'))[0].name, 'default sort is newest first');
  assert.ok(['Org 059', 'Org 058', 'Org 057'].includes(first.items[0].name));
  const { items, pages } = await all('organization', '', 25);
  assert.equal(pages, 3); assert.equal(items.length, 60);
  assert.equal(new Set(items.map(o => o.id)).size, 60, 'no duplicates across pages');
  assert.equal((await page('organization', 'limit=100')).items.length, 60);
  for (const bad of ['limit=0', 'limit=101', 'limit=abc', 'limit=-1', 'limit=2.5', 'sort=name', 'sort=created;DROP', 'orgType=Spaceship', 'status=Deleted', 'organizationId=bad%20id', 'unknown=1', 'q=' + 'x'.repeat(101), 'ids=' + Array.from({ length: 101 }, (_, i) => 'id' + i).join(','), 'orgType=Teaming%20partner&orgType=Government%20buyer']) {
    const r = await get('organization', bad);
    assert.equal(r.status, 400, bad); assert.equal((await r.json()).code, 'invalid_parameter', bad);
  }
  assert.equal((await get('nonsense')).status, 404);
  assert.equal((await get('__proto__')).status, 404);
});

test('equal sort values are ordered by a unique tie-breaker in every sort', async () => {
  await orgs(37);
  ctx.db.exec("UPDATE organizations SET created_at = '2026-01-01T00:00:00.000Z', updated_at = '2026-01-01T00:00:00.000Z', name = 'Same name'");
  for (const sort of ['created', 'oldest', 'updated', 'title']) {
    const { items } = await all('organization', `sort=${sort}`, 5);
    assert.equal(items.length, 37, sort); assert.equal(new Set(items.map(o => o.id)).size, 37, sort);
    const ids = items.map(o => o.id), sorted = [...ids].sort();
    assert.deepEqual(ids, ['created', 'updated'].includes(sort) ? sorted.reverse() : sorted, `${sort} falls back to id order`);
  }
});

test('cursors are validated and bound to the search, filters and sort that produced them', async () => {
  await orgs(30);
  const first = await page('organization', 'limit=10&orgType=Teaming%20partner');
  const cursor = encodeURIComponent(first.page.nextCursor);
  assert.equal((await page('organization', `limit=10&orgType=Teaming%20partner&cursor=${cursor}`)).items.length, 5);
  for (const [qs, code] of [
    [`limit=10&cursor=${cursor}`, 'stale_cursor'], [`limit=10&orgType=Government%20buyer&cursor=${cursor}`, 'stale_cursor'],
    [`limit=10&orgType=Teaming%20partner&sort=oldest&cursor=${cursor}`, 'stale_cursor'], [`limit=10&orgType=Teaming%20partner&q=Org&cursor=${cursor}`, 'stale_cursor'],
    ['cursor=not-base64!!', 'invalid_cursor'], [`cursor=${encodeURIComponent(btoa('{"k":[1]}'))}`, 'invalid_cursor'], [`cursor=${encodeURIComponent(btoa('[]'))}`, 'invalid_cursor'],
  ]) {
    const r = await get('organization', qs);
    assert.equal(r.status, 400, qs); assert.equal((await r.json()).code, code, qs);
  }
  // A different limit keeps the same cursor valid (limit is not part of the result order).
  assert.equal((await get('organization', `limit=3&orgType=Teaming%20partner&cursor=${cursor}`)).status, 200);
});

test('search is parameterized, escapes LIKE wildcards and finds records beyond the first page', async () => {
  await orgs(60);
  await added('organization', { name: 'Fifty 50% Partners_LLC', orgType: 'Teaming partner' }, { confirmDistinct: true });
  const deep = await page('organization', 'q=Org%20000');
  assert.deepEqual(deep.items.map(o => o.name), ['Org 000'], 'oldest record is found although it is on the last page');
  assert.equal(deep.page.total, 1);
  assert.equal((await page('organization', 'q=50%25')).items.length, 1, '% is literal');
  assert.equal((await page('organization', 'q=s_L')).items.length, 1, '_ is literal');
  assert.equal((await page('organization', 'q=0_0')).items.length, 0);
  for (const attack of ["' OR 1=1 --", '%', '"; DROP TABLE organizations; --', '\\']) {
    const body = await page('organization', 'q=' + encodeURIComponent(attack));
    assert.ok(body.items.length <= 1, attack);
  }
  assert.equal((await rows('SELECT COUNT(*) AS n FROM organizations'))[0].n, 61, 'table intact');
  assert.equal((await page('organization', 'q=org%20059%20government')).items.length, 1, 'every term must match');
  assert.equal((await page('organization', 'q=org%20059%20teaming')).items.length, 0);
});

test('inserts, edits and deletions during paging never duplicate or skip the records being paged', async () => {
  await orgs(30);
  const original = new Set((await all('organization')).items.map(o => o.id));
  const first = await page('organization', 'limit=10');
  await added('organization', { name: 'Inserted meanwhile', orgType: 'Teaming partner' }, { confirmDistinct: true });
  const anchor = first.items.at(-1);
  await edited('organization', first.items[3], { notes: 'edited while paging' });
  ctx.db.exec(`DELETE FROM organizations WHERE id = '${anchor.id}'`); // the cursor's anchor row disappears
  const rest = [];
  let cursor = first.page.nextCursor;
  while (cursor) { const b = await page('organization', `limit=10&cursor=${encodeURIComponent(cursor)}`); rest.push(...b.items); cursor = b.page.nextCursor; }
  const seen = [...first.items, ...rest].map(o => o.id);
  assert.equal(new Set(seen).size, seen.length, 'no duplicates');
  for (const id of original) assert.ok(seen.includes(id), 'no original record skipped');
  assert.ok(!rest.some(o => o.name === 'Inserted meanwhile'), 'newer inserts appear on refresh, not mid-walk (newest-first)');
  const oldest = await all('organization', 'sort=oldest');
  assert.ok(oldest.items.some(o => o.name === 'Inserted meanwhile'));
});

test('filters, ids and parent filters resolve relationships beyond the first page', async () => {
  await orgs(60);
  const deepOrg = (await page('organization', 'q=Org%20001')).items[0];
  const contact = await added('contact', { name: 'Deep Contact', organizationId: deepOrg.id, email: 'deep@example.test' });
  const filtered = await page('contact', `organizationId=${deepOrg.id}`);
  assert.deepEqual(filtered.items.map(c => c.id), [contact.id]);
  assert.equal(filtered.items[0]._organizationName, 'Org 001');
  const byIds = await page('organization', `ids=${deepOrg.id},missing-id`);
  assert.deepEqual(byIds.items.map(o => o.id), [deepOrg.id]);
  const orgPage = await page('organization', `q=Org%20001`);
  assert.equal(orgPage.items[0]._contacts, 1);
  const opp = await opportunity('Partnered pursuit');
  const partner = await added('teamingPartner', { opportunityId: opp.id, organizationId: deepOrg.id, contactId: contact.id, proposedRole: 'Subcontractor' });
  assert.equal(partner.organizationId, deepOrg.id);
  assert.equal((await single.GET(req(`/api/records/organization/${deepOrg.id}`, 'GET'), p({ type: 'organization', id: deepOrg.id }))).status, 200);
  assert.equal((await single.GET(req('/api/records/organization/nope', 'GET'), p({ type: 'organization', id: 'nope' }))).status, 404);
  assert.equal((await page('organization', 'status=Active&orgType=Government%20buyer')).page.total, 30);
});

test('detail contexts return the related records each view needs, with replacement scopes', async () => {
  const { opp, submission } = await awardedSubmission();
  const req1 = await added('requirement', { opportunityId: opp.id, description: 'Requirement one' });
  const ev = await added('evidence', { title: 'Linked policy', reviewStatus: 'Verified' });
  await acted('evidence.link', { evidenceId: ev.id, subjectType: 'requirement', subjectId: req1.id });
  const c = await (await contextRoute.GET(req(`/api/context/opportunity/${opp.id}`, 'GET'), p({ type: 'opportunity', id: opp.id }))).json();
  assert.equal(c.record.id, opp.id);
  assert.deepEqual(c.records.requirement.map(r => r.id), [req1.id]);
  assert.equal(c.records.proposal.length, 1); assert.equal(c.records.proposalVersion.length >= 1, true); assert.equal(c.records.submission.length, 1);
  assert.ok(c.records.evidence.some(e => e.id === ev.id) && c.records.evidence.some(e => e.id === submission.awardEvidenceId));
  assert.ok(c.evidenceLinks.some(l => l.subjectId === req1.id));
  assert.ok(c.scopes.some(s => s.type === 'requirement' && s.ids.includes(opp.id)));
  const { record: project } = await acted('project.createFromAward', projectInput(submission), 201);
  const pc = await (await contextRoute.GET(req(`/api/context/project/${project.id}`, 'GET'), p({ type: 'project', id: project.id }))).json();
  assert.equal(pc.records.deliverable.length, 2); assert.equal(pc.records.projectBaseline.length, 1);
  assert.equal(pc.opportunities[0].id, opp.id);
  assert.equal((await contextRoute.GET(req('/api/context/project/missing', 'GET'), p({ type: 'project', id: 'missing' }))).status, 404);
  assert.equal((await contextRoute.GET(req('/api/context/evidence/x', 'GET'), p({ type: 'evidence', id: 'x' }))).status, 404);
  const links = await (await linksRoute.GET(req(`/api/evidence-links?subjectType=requirement&ids=${req1.id}`, 'GET'))).json();
  assert.equal(links.links.length, 1); assert.equal(links.evidence[0].id, ev.id);
  assert.equal((await linksRoute.GET(req('/api/evidence-links?subjectType=workspace&ids=a', 'GET'))).status, 400);
});

test('every new read endpoint requires the owner; the summary and public site carry no record content', async () => {
  const opp = await opportunity('Secret pursuit', { notes: 'CONFIDENTIAL-NOTE-123' });
  await createPublicInquiry({ kind: 'Project briefing', name: 'Pat Private', organization: 'Private District', email: 'pat.private@example.test', sector: 'S', scope: 'CONFIDENTIAL-SCOPE-456' });
  const anonymous = { 'content-type': 'application/json' }, wrong = { authorization: 'Bearer wrong-token-wrong-token-wrong-token-1' };
  const calls = headers => [
    get('organization', '', headers), single.GET(req(`/api/records/opportunity/${opp.id}`, 'GET', undefined, headers), p({ type: 'opportunity', id: opp.id })),
    contextRoute.GET(req(`/api/context/opportunity/${opp.id}`, 'GET', undefined, headers), p({ type: 'opportunity', id: opp.id })),
    followupsRoute.GET(req('/api/followups', 'GET', undefined, headers)), reportsRoute.GET(req('/api/reports', 'GET', undefined, headers)),
    exportRoute.GET(req('/api/export', 'GET', undefined, headers)), linksRoute.GET(req(`/api/evidence-links?subjectType=opportunity&ids=${opp.id}`, 'GET', undefined, headers)),
    duplicatesRoute.GET(req('/api/organizations/duplicates', 'GET', undefined, headers)), workflowRoute.GET(req('/api/workflow', 'GET', undefined, headers)),
  ];
  for (const headers of [anonymous, wrong]) for (const r of await Promise.all(calls(headers))) {
    assert.equal(r.status, 401); const text = await r.text();
    assert.ok(!text.includes('CONFIDENTIAL') && !text.includes('Secret pursuit'));
  }
  const summary = await (await workflowRoute.GET(req('/api/workflow', 'GET'))).text();
  for (const secret of ['CONFIDENTIAL-NOTE-123', 'CONFIDENTIAL-SCOPE-456', 'pat.private@example.test']) assert.ok(!summary.includes(secret), secret);
  assert.ok(Buffer.byteLength(summary) < 20000, 'summary stays small');
  const publicText = await (await site.GET()).text();
  for (const secret of ['CONFIDENTIAL', 'Secret pursuit', 'Private District']) assert.ok(!publicText.includes(secret), secret);
});

test('server reports aggregate the full dataset and match the shared definitions', async () => {
  const today = businessDate();
  for (let i = 0; i < 130; i++) await added('evidence', { title: `Expired ${i}`, reviewStatus: 'Verified', reviewDate: '2020-01-01' });
  await added('evidence', { title: 'No date', reviewStatus: 'Unreviewed' });
  const { submission } = await awardedSubmission();
  const { record: project } = await acted('project.createFromAward', projectInput(submission), 201);
  await added('milestone', { projectId: project.id, title: 'Late', plannedDate: '2020-01-01' });
  await added('milestone', { projectId: project.id, title: 'Undated' });
  await opportunity('Open without requirements');
  const report = await (await reportsRoute.GET(req('/api/reports', 'GET'))).json();
  const full = await snapshot();
  const expected = operationalReport({ opportunities: full.opportunities, records: full.records, evidenceLinks: full.evidenceLinks }, today);
  for (const m of expected) {
    const got = report.metrics.find(x => x.key === m.key), ids = new Set(m.items.map(i => i.id));
    assert.equal(got.count, m.items.length, m.key); assert.equal(got.noData, m.noData, m.key); assert.equal(got.unavailable, m.unavailable, m.key);
    for (const item of got.items) assert.ok(ids.has(item.id), m.key);
    assert.equal(got.items.length, Math.min(100, m.items.length), m.key);
  }
  const evidenceMetric = report.metrics.find(m => m.key === 'evidence-review');
  assert.equal(evidenceMetric.count, expected.find(m => m.key === 'evidence-review').items.length);
  assert.equal(evidenceMetric.unavailable, 1 + full.records.evidence.filter(e => !e.reviewDate).length - 1);
  assert.ok(evidenceMetric.count > 100); assert.equal(evidenceMetric.items.length, 100); assert.equal(evidenceMetric.truncated, true);
});

test('follow-up buckets are computed in SQL with complete totals and validated filters', async () => {
  bulkOpportunities(120, { nextAction: 'Call', due: '2020-01-01' });
  await opportunity('Owned opportunity', { owner: 'Olu', nextAction: 'Draft', nextActionDue: '2020-02-01' });
  const body = await (await followupsRoute.GET(req('/api/followups', 'GET'))).json();
  assert.equal(body.overdue.total, 121); assert.equal(body.overdue.items.length, 100);
  assert.equal(body.opportunitiesNeedingAction.total, 121);
  const olu = await (await followupsRoute.GET(req('/api/followups?owner=Olu', 'GET'))).json();
  assert.equal(olu.overdue.total, 1); assert.equal(olu.overdue.items[0].title, 'Owned opportunity');
  const inquiriesOnly = await (await followupsRoute.GET(req('/api/followups?kind=inquiry', 'GET'))).json();
  assert.equal(inquiriesOnly.overdue.total, 0);
  for (const bad of ['kind=all;drop', 'owner=', 'other=1']) assert.equal((await followupsRoute.GET(req('/api/followups?' + bad, 'GET'))).status, 400, bad);
  const summary = await (await workflowRoute.GET(req('/api/workflow', 'GET'))).json();
  assert.equal(summary.followUpsDue, 121); assert.equal(summary.counts.opportunity, 121); assert.equal(summary.schema, 3);
});

test('exports are complete beyond the old 2,000-record cap and refuse instead of truncating', async () => {
  bulkOpportunities(2100);
  for (let i = 0; i < 3; i++) await createPublicInquiry({ kind: 'Project briefing', name: 'N', organization: 'O' + i, email: `o${i}@example.test`, sector: 'S', scope: 'S' });
  const r = await exportRoute.GET(req('/api/export', 'GET'));
  assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /attachment/);
  const bundle = await r.json();
  assert.equal(bundle.workflow.opportunities.length, 2100);
  assert.equal(bundle.manifest.counts.opportunities, 2100); assert.equal(bundle.manifest.counts.inquiries, 3);
  assert.equal(bundle.manifest.consistency, 'single-transaction snapshot');
  assert.equal(bundle.schemaVersion, 2);
  const tooMany = await buildExport(new Date(), { maxRows: 100 });
  assert.equal(tooMany.ok, false); assert.equal(tooMany.status, 413); assert.match(tooMany.error, /Nothing was exported/);
  const tooBig = await buildExport(new Date(), { maxBytes: 1000 });
  assert.equal(tooBig.ok, false);
});

test('list queries use the migration 0007 indexes', async () => {
  const plan = sql => ctx.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().then(r => r.results.map(x => x.detail).join(' | '));
  assert.match(await plan("SELECT * FROM organizations t ORDER BY t.created_at DESC, t.id DESC LIMIT 26"), /organizations_created_id_idx/);
  assert.match(await plan("SELECT * FROM opportunities t ORDER BY t.updated_at DESC, t.id DESC LIMIT 26"), /opportunities_updated_id_idx/);
  assert.match(await plan("SELECT * FROM organizations t ORDER BY lower(t.name) ASC, t.id ASC LIMIT 26"), /organizations_name_lower_idx/);
  assert.match(await plan("SELECT * FROM inquiries WHERE organization_id = 'x'"), /inquiries_org_idx/);
  assert.match(await plan("SELECT * FROM notifications WHERE read_at IS NULL ORDER BY created_at DESC"), /notifications_unread_idx/);
});

test('duplicate groups are found across the whole organization table', async () => {
  await orgs(40);
  await added('organization', { name: 'Org 000', orgType: 'Teaming partner' }, { confirmDistinct: true });
  const body = await (await duplicatesRoute.GET(req('/api/organizations/duplicates', 'GET'))).json();
  assert.equal(body.groups.length, 1); assert.equal(body.groups[0].members.length, 2);
  void owner;
});

test('every allowlisted sort, filter value and search combination executes with matching bindings', async () => {
  const { listCapabilities } = await import('../lib/server/listing.ts');
  await orgs(3);
  let checked = 0;
  for (const [type, caps] of Object.entries(listCapabilities())) {
    for (const sort of caps.sorts) {
      const qs = [`sort=${sort}`, 'limit=2', caps.search.length ? 'q=a%20b' : ''].filter(Boolean).join('&');
      const r = await get(type, qs); assert.equal(r.status, 200, `${type} ${qs}: ${await r.clone().text()}`);
      const body = await r.json();
      if (body.page.nextCursor) assert.equal((await get(type, `${qs}&cursor=${encodeURIComponent(body.page.nextCursor)}`)).status, 200, `${type} ${sort} cursor`);
      checked++;
    }
    for (const [key, values] of Object.entries(caps.filters)) {
      for (const value of Array.isArray(values) ? values : values === 'id' ? ['none', 'some-id'] : ['Someone', 'none']) {
        const r = await get(type, `${key}=${encodeURIComponent(value)}&sort=due`.replace(/&sort=due$/, caps.sorts.includes('due') ? '&sort=due' : ''));
        assert.equal(r.status, 200, `${type} ${key}=${value}: ${await r.clone().text()}`); checked++;
      }
    }
  }
  assert.ok(checked > 150, `checked ${checked} combinations`);
  const evidence = await added('evidence', { title: 'State check', reviewStatus: 'Verified' });
  for (const state of ['current', 'usable']) assert.ok((await page('evidence', `state=${state}`)).items.some(e => e.id === evidence.id), state);
  for (const state of ['expired', 'rejected', 'unreviewed']) assert.ok(!(await page('evidence', `state=${state}`)).items.some(e => e.id === evidence.id), state);
});
