// Rollback-conflict decisions in the browser. LOCAL only; prepare the database with:
//   scripts/perf/fresh-local-state.sh --legacy && node --import ./tests/register.mjs scripts/local/seed-rollback-conflicts.mjs <d1.sqlite>
//   pnpm dev, then: BASE=http://127.0.0.1:5173 node tests/browser/recovery-ui.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const results = [];
const check = (name, pass, detail = '') => { results.push(Boolean(pass)); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/signin-with-chatgpt?return_to=/workspace', { waitUntil: 'networkidle' });
  const summary = await (await page.request.get(BASE + '/api/workflow')).json();
  check('first owner load imports and records two open conflicts', summary.openImportConflicts === 2, String(summary.openImportConflicts));
  await page.reload({ waitUntil: 'networkidle' });
  const navCount = await page.locator('nav button', { hasText: 'Follow-ups' }).innerText();
  check('follow-ups navigation counts the open conflicts', /\d/.test(navCount));
  await page.locator('nav button', { hasText: 'Follow-ups' }).first().click();
  const panel = page.locator('section', { has: page.getByRole('heading', { name: /Rollback conflicts/ }) });
  await panel.locator('.conflict-table').nth(1).waitFor(); // list loads after the heading
  check('panel lists both conflicts with field-level differences', (await panel.locator('.conflict-table').count()) === 2 && (await panel.innerText()).includes('Edited while the legacy app was live'));
  const first = panel.locator('.followup-list > li').first();
  check('decision buttons stay disabled until a reason is entered', await first.getByRole('button', { name: 'Keep current' }).isDisabled());
  await first.getByLabel(/Reason for your decision/).fill('The workflow record is authoritative.');
  await first.getByRole('button', { name: 'Keep current' }).click();
  await page.getByText(/Current record kept/).waitFor();
  const remaining = panel.locator('.followup-list > li');
  await page.waitForFunction(() => document.querySelectorAll('.conflict-table').length === 1);
  await remaining.first().getByLabel(/Reason for your decision/).fill('This edit was made during the rollback and is correct.');
  await remaining.first().getByRole('button', { name: 'Apply legacy edit' }).click();
  await page.getByText(/Legacy edit applied/).waitFor();
  await page.waitForFunction(() => !document.querySelector('#fu-conflicts'));
  const after = await (await page.request.get(BASE + '/api/import-conflicts?status=all')).json();
  check('both decisions are recorded with reasons', after.items.length === 2 && after.items.every(c => c.status !== 'Open' && c.decisionReason));
  const exportBody = await (await page.request.get(BASE + '/api/export')).json();
  const types = exportBody.workflow.activity.map(a => a.type);
  check('activity records detection and both decisions', ['import.conflicts_detected', 'import.conflict_kept', 'import.conflict_applied'].every(t => types.includes(t)));
  const mobile = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await mobile.goto(BASE + '/signin-with-chatgpt?return_to=/workspace', { waitUntil: 'networkidle' });
  check('no horizontal overflow at 390px', (await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally { await browser.close(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} recovery UI checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
