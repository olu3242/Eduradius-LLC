// Paginated list UI behaviour against a LOCAL dev server seeded with the synthetic dataset
// (scripts/perf/fresh-local-state.sh). Not part of CI.
//   BASE=http://127.0.0.1:5173 node tests/browser/pagination-ui.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const results = [];
const check = (name, pass, detail = '') => { results.push(Boolean(pass)); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const cards = page => page.locator('.opportunity-card');
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/signin-with-chatgpt?return_to=/workspace', { waitUntil: 'networkidle' });
  const nav = name => page.locator('nav button', { hasText: name }).first().click();
  await nav('Organizations'); await cards(page).first().waitFor();

  // Stale responses: an earlier, slower search must never replace a newer one.
  let delayed = 0;
  await page.route(/\/api\/records\/organization\?.*q=Org\+0001/, async route => { delayed++; await new Promise(r => setTimeout(r, 1500)); await route.continue(); });
  const search = page.getByPlaceholder('Search organizations');
  await search.fill('Org 0001'); await page.waitForTimeout(400); // debounce fires the slow request
  await search.fill('Org 0002');
  await page.locator('.opportunity-card h2', { hasText: /^Synthetic Org 0002$/ }).waitFor();
  await page.waitForTimeout(1800); // let the slow response arrive
  check('a slower, superseded search response is discarded', delayed === 1 && (await cards(page).count()) === 1 && (await cards(page).first().innerText()).includes('Synthetic Org 0002'));
  await page.unroute(/\/api\/records\/organization\?.*q=Org\+0001/);

  // Empty state and filter reset.
  await search.fill('no-such-organization-zzz');
  await page.getByRole('heading', { name: 'No organizations match these filters.' }).waitFor();
  check('no-match state names the cause', true);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.opportunity-card').length === 25);
  check('clear filters restores the first page', (await search.inputValue()) === '' && (await cards(page).count()) === 25);

  // Error and retry.
  await page.route(/\/api\/records\/organization\?/, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"The workspace is temporarily unavailable. Please retry."}' }), { times: 1 });
  await page.getByLabel('Filter by organization type').selectOption('Government buyer');
  await page.getByText('The workspace is temporarily unavailable. Please retry.').first().waitFor();
  check('a failed page shows the error with a retry control', await page.getByRole('button', { name: 'Retry' }).first().isVisible());
  await page.getByRole('button', { name: 'Retry' }).first().click();
  await cards(page).first().waitFor();
  check('retry loads the filtered page', (await cards(page).count()) > 0 && /Government buyer/i.test(await cards(page).first().innerText()));
  check('search and filter state is preserved across retry', (await page.getByLabel('Filter by organization type').inputValue()) === 'Government buyer');

  // Keyboard: "Load more" is reachable and keeps focus; the count is announced.
  const more = page.getByRole('button', { name: 'Load more organizations' });
  await more.focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.opportunity-card').length === 50);
  check('Enter on "Load more" appends a page', (await cards(page).count()) === 50);
  check('focus stays on "Load more" after appending', await page.evaluate(() => document.activeElement?.textContent?.includes('Load more')));
  check('result count is a polite live region', (await page.locator('.result-count').getAttribute('aria-live')) === 'polite');

  await page.getByLabel('Filter by organization type').selectOption('All types');

  // Reference picker: keyboard search beyond the first 20 choices, inside a pursuit.
  await nav('Opportunities');
  await page.getByPlaceholder('Search opportunities').fill('opportunity 0000');
  await page.locator('.opportunity-card', { hasText: 'Synthetic opportunity 0000' }).getByRole('button', { name: /Open pursuit/ }).click();
  await page.getByRole('heading', { name: 'Synthetic opportunity 0000' }).waitFor();
  const requests = [];
  page.on('request', r => { if (r.url().includes('/api/records/organization')) requests.push(r.url()); });
  await page.waitForTimeout(500);
  check('pickers make no requests until used', requests.length === 0);
  const orgSearch = page.getByLabel('Organization', { exact: true }).locator('xpath=preceding-sibling::input[@type="search"][1]');
  await orgSearch.focus(); await page.keyboard.type('Org 0007');
  await page.getByLabel('Organization', { exact: true }).locator('option', { hasText: 'Synthetic Org 0007' }).waitFor({ state: 'attached' });
  await page.keyboard.press('Tab');
  check('Tab moves from the picker search to its select', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Organization'));
  await page.getByLabel('Organization', { exact: true }).selectOption({ label: 'Synthetic Org 0007' });
  check('a record beyond the first 20 choices can be selected', (await page.getByLabel('Organization', { exact: true }).locator('option:checked').innerText()) === 'Synthetic Org 0007');

  // Accessible names for every form control in the workspace main area.
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('main input, main select, main textarea')].filter(el => {
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label')) return false;
    return !(el.id && document.querySelector(`label[for="${el.id}"]`));
  }).map(el => el.outerHTML.slice(0, 80)));
  check('every form control in the view has an accessible name', unnamed.length === 0, unnamed.join(' | '));

  // Mobile layout with pickers and paged lists.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await mobile.newPage();
  await m.goto(BASE + '/signin-with-chatgpt?return_to=/workspace', { waitUntil: 'networkidle' });
  await m.getByRole('button', { name: 'Toggle navigation' }).click();
  await m.locator('nav button', { hasText: 'Opportunities' }).first().click();
  await m.getByPlaceholder('Search opportunities').fill('opportunity 0000');
  await m.locator('.opportunity-card', { hasText: 'Synthetic opportunity 0000' }).getByRole('button', { name: /Open pursuit/ }).click();
  await m.getByRole('heading', { name: 'Synthetic opportunity 0000' }).waitFor();
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('pursuit with reference pickers has no horizontal overflow at 390px', overflow <= 1, `${overflow}px`);
  await m.getByRole('button', { name: 'Toggle navigation' }).click();
  await m.locator('nav button', { hasText: 'Organizations' }).first().click();
  await m.locator('.opportunity-card').first().waitFor();
  check('paged list and "Load more" fit at 390px', (await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
  await mobile.close();
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally { await browser.close(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} pagination UI checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
