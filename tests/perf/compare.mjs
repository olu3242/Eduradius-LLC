// Before/after measurement on the SYNTHETIC dataset from scripts/perf/fresh-local-state.sh.
// Local dev server only (loopback sign-in). Reports what it measured; it sets no targets.
//   BASE=http://127.0.0.1:5173 D1_FILE=.wrangler/state/v3/d1/.../<hash>.sqlite node tests/perf/compare.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const out = { environment: { base: BASE, node: process.version, browser: 'Chromium (Playwright)', when: new Date().toISOString() }, scenarios: {} };

// Ground truth for export completeness, read directly from the local D1 file.
const sqlite = new DatabaseSync(process.env.D1_FILE, { readOnly: true });
const truth = Object.fromEntries(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ('d1_migrations', 'rate_limits', 'workspaces', 'workspace_snapshots')").all()
  .map(({ name }) => [name, sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n]));
sqlite.close();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
let log = [];
page.on('requestfinished', async request => {
  const url = new URL(request.url());
  if (!url.pathname.startsWith('/api/')) return;
  const response = await request.response(); const body = response ? await response.body().catch(() => Buffer.alloc(0)) : Buffer.alloc(0);
  const t = request.timing();
  log.push({ path: url.pathname + url.search, status: response?.status(), bytes: body.length, ms: Math.round(t.responseEnd) });
});
const settle = () => page.waitForLoadState('networkidle').catch(() => {});
async function scenario(name, run) {
  await settle(); await page.waitForTimeout(300); log = [];
  const start = Date.now(); const detail = await run(); await settle();
  const ms = Date.now() - start; await page.waitForTimeout(800); // let body reads finish
  out.scenarios[name] = { wallMs: ms, apiRequests: log.length, apiBytes: log.reduce((a, r) => a + r.bytes, 0), requests: log.map(r => `${r.status} ${r.path.slice(0, 90)} ${r.bytes}B ${r.ms}ms`), ...detail };
  console.log(name, JSON.stringify({ wallMs: ms, apiRequests: log.length, apiKiB: +(out.scenarios[name].apiBytes / 1024).toFixed(1), ...detail }));
}
const nav = name => page.locator('nav button', { hasText: name }).first().click();

await page.goto(BASE + '/signin-with-chatgpt?return_to=/', { waitUntil: 'networkidle' });
await scenario('initial workspace load', async () => { await page.goto(BASE + '/workspace', { waitUntil: 'networkidle' }); return {}; });
await scenario('open Opportunities view', async () => {
  await nav('Opportunities'); await page.locator('.opportunity-card').first().waitFor();
  return { cardsRendered: await page.locator('.opportunity-card').count() };
});
await scenario('search opportunities (last-seeded record)', async () => {
  await page.getByPlaceholder('Search opportunities').fill('opportunity 0399');
  await page.locator('.opportunity-card', { hasText: 'Synthetic opportunity 0399' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.opportunity-card').length === 1, null, { timeout: 5000 }).catch(() => {});
  return { cardsRendered: await page.locator('.opportunity-card').count() };
});
await scenario('open pursuit with 30 requirements', async () => {
  await page.getByPlaceholder('Search opportunities').fill('opportunity 0000');
  await page.locator('.opportunity-card', { hasText: 'Synthetic opportunity 0000' }).getByRole('button', { name: /Open pursuit/ }).click();
  await page.getByRole('tab', { name: 'Requirements' }).click(); await page.locator('.requirement-list > li').first().waitFor();
  return { requirementsRendered: await page.locator('.requirement-list > li').count() };
});
await scenario('open Organizations view', async () => {
  await nav('Organizations'); await page.locator('.opportunity-card').first().waitFor();
  return { cardsRendered: await page.locator('.opportunity-card').count() };
});
await scenario('search organizations (last-seeded record)', async () => {
  await page.getByPlaceholder('Search organizations').fill('Org 0399');
  await page.locator('.opportunity-card', { hasText: 'Synthetic Org 0399' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.opportunity-card').length === 1, null, { timeout: 5000 }).catch(() => {});
  return { cardsRendered: await page.locator('.opportunity-card').count() };
});
await scenario('search organizations (oldest record)', async () => {
  await page.getByPlaceholder('Search organizations').fill('Org 0000');
  await page.waitForFunction(() => document.querySelectorAll('.opportunity-card').length === 1 && document.querySelector('.opportunity-card')?.textContent?.includes('Synthetic Org 0000'), null, { timeout: 10000 });
  return { cardsRendered: await page.locator('.opportunity-card').count() };
});
await scenario('export workspace', async () => {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: 'Export', exact: true }).click()]);
  const file = JSON.parse(readFileSync(await download.path(), 'utf8')); const bundle = file.workflow ?? file;
  const got = { inquiries: bundle.inquiries?.length, opportunities: bundle.opportunities?.length, activity_events: bundle.activity?.length, evidence_links: bundle.evidenceLinks?.length };
  const tableOf = { organization: 'organizations', contact: 'contacts', requirement: 'requirements', evidence: 'evidence', proposal: 'proposals', proposalVersion: 'proposal_versions', submission: 'submissions', project: 'projects', projectBaseline: 'project_baselines', milestone: 'milestones', deliverable: 'deliverables' };
  for (const [type, table] of Object.entries(tableOf)) got[table] = bundle.records?.[type]?.length;
  const mismatches = Object.entries(got).filter(([table, n]) => n !== truth[table]).map(([table, n]) => `${table}: exported ${n}, database ${truth[table]}`);
  return { exportBytes: (await download.createReadStream().then(s => new Promise(r => { let n = 0; s.on('data', c => { n += c.length; }); s.on('end', () => r(n)); }))), complete: mismatches.length === 0, mismatches };
});
// API-level: the request the workspace makes on every load/refresh (median of 5).
const timings = [];
let summaryBytes = 0, summaryRecords = 0;
for (let i = 0; i < 5; i++) {
  const s = Date.now(); const r = await page.request.get(BASE + '/api/workflow'); const body = await r.body(); timings.push(Date.now() - s);
  summaryBytes = body.length; const j = JSON.parse(body);
  summaryRecords = (j.inquiries?.length ?? 0) + (j.opportunities?.length ?? 0) + Object.values(j.records ?? {}).reduce((a, l) => a + l.length, 0) + (j.evidenceLinks?.length ?? 0) + (j.activity?.length ?? 0) + (j.notifications?.length ?? 0);
}
timings.sort((a, b) => a - b);
out.scenarios['GET /api/workflow'] = { medianMs: timings[2], bytes: summaryBytes, recordsReturned: summaryRecords };
console.log('GET /api/workflow', JSON.stringify(out.scenarios['GET /api/workflow']));
out.databaseRows = truth;
await browser.close();
if (process.env.OUT) (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
