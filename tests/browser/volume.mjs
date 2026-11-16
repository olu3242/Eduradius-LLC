// Representative-volume and long-text check against a LOCAL dev server (synthetic data).
// Not part of CI. Reports measured timings for the stated conditions; no targets are implied.
//   BASE=http://127.0.0.1:5173 node tests/browser/volume.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const T = 'V' + Date.now().toString(36);
const results = [];
const check = (name, pass, detail = '') => { results.push(Boolean(pass)); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const longWord = 'Supercalifragilistic'.repeat(12); // 240 chars, no break opportunities
const longText = (n) => `SYNTHETIC ${T} ${longWord} ` + 'Representative long text for layout testing. '.repeat(Math.ceil(n / 46)).slice(0, n - 280);

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/signin-with-chatgpt?return_to=/workspace', { waitUntil: 'networkidle' });
  const post = (path, data) => page.request.post(BASE + path, { data });
  const t0 = Date.now();
  for (let i = 0; i < 80; i++) {
    await post('/api/records/organization', { record: { name: `Synthetic Org ${T} ${i}`, notes: longText(3000), orgType: i % 2 ? 'Government buyer' : 'Teaming partner' }, confirmDistinct: true });
    await post('/api/opportunities', { opportunity: { title: `Synthetic opportunity ${T} ${i} ${longWord.slice(0, 120)}`, notes: longText(6000), agency: `Agency ${i}` } });
  }
  const opp = (await (await page.request.get(BASE + '/api/workflow')).json()).opportunities.find(o => o.title.startsWith(`Synthetic opportunity ${T} 0 `));
  for (let i = 0; i < 50; i++) await post('/api/records/requirement', { record: { opportunityId: opp.id, description: longText(1900), owner: 'Owner ' + i } });
  for (let i = 0; i < 60; i++) await post('/api/records/evidence', { record: { title: `Synthetic evidence ${T} ${i}`, location: longText(480), notes: longText(3500) } });
  console.log(`seeded 80 organizations, 80 opportunities, 50 requirements, 60 evidence in ${Date.now() - t0} ms`);

  const workflowStart = Date.now();
  const payload = await page.request.get(BASE + '/api/workflow');
  const bytes = (await payload.body()).length;
  console.log(`GET /api/workflow: ${Date.now() - workflowStart} ms, ${(bytes / 1024).toFixed(0)} KiB (local dev server, Chromium, this machine)`);
  check('workflow payload returns successfully at this volume', payload.status() === 200);

  const overflow = p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const timed = async (label, fn) => { const s = Date.now(); await fn(); const ms = Date.now() - s; console.log(`${label}: ${ms} ms`); return ms; };
  await timed('workspace load to network idle', () => page.goto(BASE + '/workspace', { waitUntil: 'networkidle' }));
  for (const name of ['Organizations', 'Evidence', 'Opportunities']) {
    await timed(`${name} page render`, async () => { await page.locator('nav button', { hasText: name }).first().click(); await page.waitForSelector('main .panel'); });
    check(`${name}: long unbroken text does not cause horizontal overflow (desktop)`, (await overflow(page)) <= 1);
  }
  await page.locator('.opportunity-card', { hasText: `Synthetic opportunity ${T} 0 ` }).getByRole('button', { name: /Open pursuit/ }).click();
  await timed('pursuit requirements tab (50 long requirements)', async () => { await page.getByRole('tab', { name: 'Requirements' }).click(); await page.waitForSelector('.requirement-list li'); });
  check('requirements tab lists all 50 items', (await page.locator('.requirement-list > li').count()) === 50);
  check('requirements tab has no horizontal overflow', (await overflow(page)) <= 1);

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await mobile.newPage();
  await m.goto(BASE + '/signin-with-chatgpt?return_to=/workspace', { waitUntil: 'networkidle' });
  for (const name of ['Organizations', 'Evidence', 'Opportunities']) {
    await m.getByRole('button', { name: 'Toggle navigation' }).click();
    await m.locator('nav button', { hasText: name }).first().click(); await m.waitForTimeout(500);
    check(`${name}: no horizontal overflow at 390px with long text`, (await overflow(m)) <= 1, `${await overflow(m)}px`);
  }
  await mobile.close();
} finally { await browser.close(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} volume checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
