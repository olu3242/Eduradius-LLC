// End-to-end browser journey against a LOCAL dev server with the loopback mock sign-in.
// Not part of CI: requires a locally installed Playwright with Chromium.
//   BASE=http://127.0.0.1:5173 node tests/browser/journey.mjs
// Uses only clearly named test records in the isolated local database.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const ORG = 'Journey QA ' + Date.now().toString(36);
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const dialog = page => page.locator('[role=dialog]').last();

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], expectedErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // 1. Public submission through the company site form.
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const form = page.locator('form.m-contact-form');
  await form.scrollIntoViewIfNeeded();
  await form.getByLabel('Name').fill('Journey Tester');
  await form.getByLabel('Organization').fill(ORG);
  await form.getByLabel('Work email').fill('journey@example.test');
  await form.getByLabel('What would you like to work on?').fill('AI governance policy review for a district leadership team.');
  await form.getByRole('button', { name: /Save briefing request/ }).click();
  await page.waitForTimeout(1500);
  check('public form stores the request without claiming email delivery', /No email has been sent/.test(await form.locator('.form-feedback').innerText()));

  // 2. Owner sign-in (loopback development identity) and legacy migration.
  await page.goto(BASE + '/signin-with-chatgpt?return_to=/workspace', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const nav = name => page.locator('nav button', { hasText: name }).first().click();
  await nav('Client requests');
  await page.waitForSelector('.inquiry-card');
  const board = await page.locator('main').innerText();
  check('new request listed with status New', board.includes(ORG));
  await page.getByLabel('Filter by status').selectOption('All statuses');
  const legacyText = await page.locator('.inquiry-card', { hasText: 'Legacy QA District' }).innerText().catch(() => '');
  check('legacy request migrated and status mapped (Tentative → Reviewing)', /Reviewing/.test(legacyText), legacyText.split('\n').slice(0, 2).join(' | '));
  const today = (await (await page.request.get(BASE + '/api/workflow')).json()).today;

  // 3. Review → assign → schedule follow-up (keyboard: open with Enter, Escape restores focus).
  const card = page.locator('.inquiry-card', { hasText: ORG });
  const reviewButton = card.getByRole('button', { name: /Review request/ });
  await reviewButton.focus(); await page.keyboard.press('Enter');
  let d = dialog(page);
  check('review dialog opens with an accessible name', (await d.getAttribute('aria-labelledby')) && (await d.locator('h2').innerText()).includes(ORG));
  const inDialog = await page.evaluate(() => document.querySelector('[role=dialog]')?.contains(document.activeElement));
  check('focus moves into the dialog', inDialog);
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  check('Tab stays trapped inside the dialog', await page.evaluate(() => document.querySelector('[role=dialog]')?.contains(document.activeElement)));
  await page.keyboard.press('Escape');
  check('Escape closes and returns focus to the trigger', (await page.locator('[role=dialog]').count()) === 0 && await reviewButton.evaluate(el => el === document.activeElement));
  await reviewButton.click(); d = dialog(page);
  const unlabeled = await d.evaluate(el => [...el.querySelectorAll('input, select, textarea')].filter(c => !c.closest('label') && !c.getAttribute('aria-label')).length);
  check('every dialog control has a label', unlabeled === 0, `${unlabeled} unlabeled`);
  await d.getByLabel('Assigned owner').fill('Olu');
  await d.getByLabel('Next action').fill('Call to confirm governance scope');
  await d.getByLabel('Next-action due date').fill(today);
  await d.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1000);
  check('assignment and follow-up saved', (await d.innerText()).includes('Changes saved.'));

  // 4. Qualify (reason required) — error feedback first.
  await d.getByLabel('Status').selectOption('Qualified');
  await d.getByLabel(/Reason for marking Qualified/).fill('');
  await d.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(300);
  check('empty reason is blocked by the form', await d.getByLabel(/Reason for marking Qualified/).evaluate(el => !el.checkValidity()));
  await d.getByLabel(/Reason for marking Qualified/).fill('   ');
  expectedErrors.push(/status of 400/);
  await d.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(800);
  check('whitespace reason is rejected by the server with visible feedback', /Record a reason/.test(await d.getByRole('alert').innerText().catch(() => '')));
  await d.getByLabel(/Reason for marking Qualified/).fill('Scope fits AI governance; budget confirmed by phone.');
  await d.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1000);
  check('qualified with recorded reason', (await d.innerText()).includes('Changes saved.') && (await d.innerText()).includes('budget confirmed'));
  const history = await d.locator('.activity-list').innerText();
  check('history shows reviewed, assignment, follow-up and status events', ['Inquiry reviewed', 'Assigned to Olu', 'Follow-up scheduled', 'Status changed from'].every(t => history.includes(t)), history.replace(/\n/g, ' | ').slice(0, 200));

  // 5. Follow-ups view shows the item due today in Central Time.
  await page.keyboard.press('Escape');
  await nav('Follow-ups');
  await page.waitForSelector('.followups');
  const dueToday = await page.locator('section', { has: page.locator('h2', { hasText: 'Due today' }) }).innerText();
  check('follow-up appears under Due today', dueToday.includes(ORG));
  const awaiting = await page.locator('section', { has: page.locator('h2', { hasText: 'Qualified — ready to convert' }) }).innerText();
  check('qualified request appears as ready to convert', awaiting.includes(ORG));
  check('unassigned section lists the migrated request', (await page.locator('section', { has: page.locator('h2', { hasText: 'Unassigned requests' }) }).innerText()).includes('Legacy QA District'));

  // 6. Convert with an editable review step.
  await page.locator('section', { has: page.locator('h2', { hasText: 'Qualified — ready to convert' }) }).locator('li', { hasText: ORG }).getByRole('button', { name: 'Convert' }).click();
  d = dialog(page);
  check('conversion review prefilled from the request', (await d.getByLabel('Agency / customer').inputValue()) === ORG && (await d.getByLabel('Contact email').inputValue()) === 'journey@example.test');
  await d.getByLabel('Opportunity title').fill(ORG + ' governance engagement');
  await d.getByLabel('Estimated value (USD)').fill('15000');
  await d.getByRole('button', { name: 'Create opportunity' }).click();
  await page.waitForTimeout(1200);
  check('conversion success state', (await d.innerText()).includes('Opportunity created'));
  await d.getByRole('button', { name: /Open opportunity/ }).click();
  await page.waitForTimeout(500);
  d = dialog(page);
  check('resulting opportunity opens with carried-over fields', (await d.getByLabel('Opportunity title').inputValue()).includes('governance engagement') && (await d.getByLabel('Contact name').inputValue()) === 'Journey Tester');
  await d.getByRole('button', { name: 'Cancel' }).click();

  // 7. Duplicate conversion attempt (retry) creates nothing new.
  const wf = (await (await page.request.get(BASE + '/api/export')).json()).workflow;
  const inq = wf.inquiries.find(i => i.organization === ORG);
  const retry = await page.request.post(`${BASE}/api/inquiries/${inq.id}/convert`, { data: { version: inq.version, opportunity: { title: 'Duplicate' } } });
  check('retrying conversion returns the existing opportunity', retry.status() === 200 && (await retry.json()).alreadyConverted === true);
  check('exactly one opportunity linked to the request', wf.opportunities.filter(o => o.sourceInquiryId === inq.id).length === 1);

  // 8. Reload → persistence.
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  await nav('Opportunities'); await page.waitForTimeout(500);
  const opps = await page.locator('main').innerText();
  check('opportunity and migrated legacy opportunity persist after reload', opps.includes(ORG + ' governance engagement') && opps.includes('Legacy QA Pursuit'));
  await nav('Client requests'); await page.getByLabel('Filter by status').selectOption('All statuses'); await page.waitForTimeout(300);
  check('source request kept for reference as Converted', /Converted/.test(await page.locator('.inquiry-card', { hasText: ORG }).innerText()));

  // 9. Export completeness.
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('button.side-export', { hasText: 'Export workspace' }).click()]);
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  check('export includes document and every workflow collection', exported.schemaVersion === 2 && exported.workflow.inquiries.some(i => i.organization === ORG) && exported.workflow.opportunities.length >= 2 && exported.workflow.activity.some(a => a.type === 'inquiry.converted') && !('inquiries' in exported.workspace));

  // 10. Public endpoint exposure.
  const publicText = await (await page.request.get(BASE + '/api/site')).text();
  check('public content excludes workflow records', !publicText.includes(ORG) && !publicText.includes('journey@example.test') && !publicText.includes('budget confirmed'));

  // 11. Downloads.
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const hrefs = await page.$$eval('a[href^="/brand/"]', as => [...new Set(as.map(a => a.getAttribute('href')))]);
  let downloadsOk = hrefs.length >= 5;
  for (const h of hrefs) { const r = await page.request.get(BASE + h); downloadsOk &&= r.status() === 200 && Buffer.compare(await r.body(), readFileSync(new URL('../../public' + h, import.meta.url))) === 0; }
  check('brand downloads return the exact published files', downloadsOk, `${hrefs.length} files`);

  // 12. Mobile layout and navigation.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const m = await mobile.newPage();
  await m.goto(BASE + '/signin-with-chatgpt?return_to=/workspace', { waitUntil: 'networkidle' }); await m.waitForTimeout(800);
  const overflow = async () => m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('mobile workspace has no horizontal overflow', (await overflow()) <= 1);
  const toggle = m.getByRole('button', { name: 'Toggle navigation' }).first();
  await toggle.click(); await m.locator('nav button', { hasText: 'Follow-ups' }).click(); await m.waitForTimeout(600);
  check('mobile menu reaches Follow-ups without overflow', (await m.locator('h1').innerText()).includes('Follow-ups') && (await overflow()) <= 1);
  await m.getByRole('button', { name: 'Toggle navigation' }).first().click(); await m.locator('nav button', { hasText: 'Client requests' }).click(); await m.waitForTimeout(600);
  await m.locator('.inquiry-card').first().getByRole('button', { name: /Review request/ }).click(); await m.waitForTimeout(300);
  const fits = await m.locator('[role=dialog]').evaluate(el => el.getBoundingClientRect().right <= window.innerWidth + 1);
  check('mobile review dialog fits the viewport', fits && (await overflow()) <= 1);
  await m.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/mobile-dialog.png' : '/dev/null' }).catch(() => {});
  await mobile.close();

  const unexpected = errors.filter(e => { const i = expectedErrors.findIndex(p => p.test(e)); if (i < 0) return true; expectedErrors.splice(i, 1); return false; });
  check('no unexpected page or console errors', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
} finally { await browser.close(); }
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
