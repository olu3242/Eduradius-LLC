// Stage 3–4 browser journey against a LOCAL dev server (loopback mock sign-in, isolated
// local D1 with every migration applied). Not part of CI: needs a local Playwright + Chromium.
//   BASE=http://127.0.0.1:5173 node tests/browser/contracting-journey.mjs
// Briefing → review → assign → follow-up → qualify → convert → organization/contact → requirements → evidence → proposal → request changes →
// revise → approve → record submission → confirm award → project → milestones → deliverable →
// request revision → accept revised version → approve scope change → closeout → private
// experience record → reload and verify persistence; then mobile layout checks.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const T = 'J' + Date.now().toString(36);
const results = [];
const check = (name, pass, detail = '') => { results.push(Boolean(pass)); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// Reference pickers show at most 20 matches; type into the picker's search box first, the way an
// owner would once the workspace holds more records than fit in one list.
async function choose(scope, label, option, search = option) {
  const select = scope.getByLabel(label);
  await select.locator('xpath=preceding-sibling::input[@type="search"][1]').fill(search);
  await select.selectOption({ label: option });
}
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const nav = async name => { await page.locator('nav button', { hasText: name }).first().click(); await page.waitForTimeout(300); };
  const dialog = () => page.locator('[role=dialog]').last();
  const tab = name => page.getByRole('tab', { name }).click();
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const panel = () => page.locator('.tab-panel');
  const save = async (d, name = 'Save') => { await d.getByRole('button', { name, exact: true }).click(); await settle(); };

  let d;
  // Public briefing (synthetic, clearly labelled test data).
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const form = page.locator('form.m-contact-form');
  await form.scrollIntoViewIfNeeded();
  await form.getByLabel('Name').fill(`Synthetic Tester ${T}`);
  await form.getByLabel('Organization').fill(`Synthetic District ${T}`);
  await form.getByLabel('Work email').fill(`synthetic-${T.toLowerCase()}@example.test`);
  await form.getByLabel('What would you like to work on?').fill('SYNTHETIC TEST DATA — AI governance policy and staff training.');
  await form.getByRole('button', { name: /Save briefing request/ }).click(); await settle(1500);
  check('public briefing stored without claiming email', /No email has been sent/.test(await form.locator('.form-feedback').innerText()));

  await page.goto(BASE + '/signin-with-chatgpt?return_to=/workspace', { waitUntil: 'networkidle' });
  await settle();
  const workflowResponse = await page.request.get(BASE + '/api/workflow');
  check('responses carry a correlation id', /^[0-9a-f-]{36}$/.test(workflowResponse.headers()['x-request-id'] ?? ''));
  const today = (await workflowResponse.json()).today;

  // Review → assign → schedule follow-up → qualify → convert.
  await nav('Client requests');
  const card = page.locator('.inquiry-card', { hasText: `Synthetic District ${T}` });
  await card.getByRole('button', { name: /Review request/ }).click();
  d = dialog();
  await d.getByLabel('Assigned owner').fill('Olu');
  await d.getByLabel('Next action').fill('Confirm scope by phone');
  await d.getByLabel('Next-action due date').fill(today);
  await d.getByRole('button', { name: 'Save' }).click(); await settle();
  await d.getByLabel('Status').selectOption('Qualified');
  await d.getByLabel(/Reason for marking Qualified/).fill('Synthetic test: scope and budget confirmed.');
  await d.getByRole('button', { name: 'Save' }).click(); await settle();
  check('request reviewed, assigned, follow-up scheduled and qualified', (await d.innerText()).includes('Changes saved.') && (await d.locator('.activity-list').innerText()).includes('Assigned to Olu'));
  await d.getByRole('button', { name: 'Convert to opportunity' }).click(); await settle(400);
  d = dialog();
  await d.getByLabel('Opportunity title').fill(`AI governance RFP ${T}`);
  await d.getByRole('button', { name: 'Create opportunity' }).click(); await settle(1000);
  check('converted to opportunity', (await d.innerText()).includes('Opportunity created'));
  await d.getByRole('button', { name: 'Back to requests' }).click(); await settle(300);

  // Shared records: organization + contact, evidence.
  await nav('Organizations');
  await page.getByRole('button', { name: 'Add organization' }).click();
  d = dialog();
  await d.getByLabel('Organization name').fill(`Client ${T} District`);
  await d.getByLabel('Organization type').selectOption('Government buyer');
  await save(d);
  await page.locator('.opportunity-card', { hasText: `Client ${T} District` }).getByRole('button', { name: 'Open organization' }).click();
  await dialog().getByRole('button', { name: 'Add contact' }).click();
  d = dialog();
  await d.getByRole('textbox', { name: 'Name *', exact: true }).fill(`Pat ${T}`);
  await d.getByLabel('Role / title').fill('Director of Technology');
  await d.getByLabel('Email').fill(`pat-${T.toLowerCase()}@example.test`);
  await save(d);
  check('organization and contact created', (await dialog().innerText()).includes(`Pat ${T}`));
  await page.keyboard.press('Escape'); await settle(300);

  await nav('Evidence');
  for (const [title, category, status, date] of [[`SAM record ${T}`, 'Registration', 'Verified', '2099-01-01'], [`Award notice ${T}`, 'Award', 'Verified', ''], [`Signed acceptance ${T}`, 'Acceptance', 'Verified', '2099-01-01'], [`Draft memo ${T}`, 'Other', 'Unreviewed', '']]) {
    await page.getByRole('button', { name: 'Add evidence' }).click();
    d = dialog();
    await d.getByLabel('Document title').fill(title);
    await d.getByLabel('Category').selectOption(category);
    await d.getByLabel('Review status').selectOption(status);
    if (date) await d.getByLabel('Expiration / next review date').fill(date);
    await d.getByLabel('Where the document is kept').fill('Private drive / ' + category);
    await save(d);
  }
  check('evidence register shows reference-only limitation', (await page.locator('main').innerText()).includes('Reference-only register'));

  // Converted opportunity → link organization/contact.
  await nav('Opportunities');
  await page.locator('.opportunity-card', { hasText: `AI governance RFP ${T}` }).getByRole('button', { name: /Open pursuit/ }).click(); await settle(300);
  await choose(page, /^Organization/, `Client ${T} District`);
  await choose(page, /^Primary contact/, `Pat ${T} · Director of Technology`, `Pat ${T}`);
  await page.getByRole('button', { name: 'Save organization and contact' }).click(); await settle();
  check('opportunity linked to organization and contact', (await page.locator('.pursuit-header').innerText()).includes(`Client ${T} District`));

  // Requirements + evidence links.
  await tab('Requirements');
  for (const [text, status] of [['Active SAM registration', 'Not started'], ['Two client references', 'Evidence needed']]) {
    await page.getByRole('button', { name: 'Add requirement' }).click();
    d = dialog();
    await d.getByLabel('Requirement').fill(text);
    await d.getByLabel('Status').selectOption(status);
    await save(d);
  }
  const samRow = page.locator('.requirement-list > li').filter({ has: page.locator('strong', { hasText: /^Active SAM registration$/ }) });
  await choose(samRow, /Link evidence/, `SAM record ${T}`);
  await samRow.getByRole('button', { name: 'Link', exact: true }).click(); await settle();
  await samRow.getByRole('button', { name: 'Edit' }).click();
  d = dialog(); await d.getByLabel('Status').selectOption('Met'); await save(d);
  const reqText = await panel().innerText();
  check('requirement met with verified evidence; missing evidence tracked separately', reqText.includes('1 met') && reqText.includes('1 awaiting evidence') && reqText.includes('0 confirmed not met'));

  // Proposal → request changes → revise → approve → record submission.
  await tab('Proposal');
  await page.getByRole('button', { name: 'New proposal' }).click();
  await dialog().getByRole('button', { name: 'Create proposal' }).click(); await settle(900);
  const ed = () => page.locator('.proposal-editor');
  await ed().getByLabel('Executive summary text').fill('EduRadius proposes an AI governance framework with staff training.');
  await ed().getByLabel('Basis for proposed approach').selectOption({ index: 1 });
  await ed().getByLabel('Proposed approach text').fill('Discovery, policy drafting, training.');
  await ed().getByRole('button', { name: 'Save proposal' }).click(); await settle();
  await ed().getByRole('button', { name: 'Send for owner review' }).click(); await settle();
  await ed().getByRole('button', { name: 'Request changes' }).click();
  d = dialog(); await d.getByLabel(/What needs to change/).fill('Add a timeline to the approach.'); await save(d);
  check('owner review requested changes with a reason', (await ed().innerText()).includes('Add a timeline'));
  await ed().getByLabel('Proposed approach text').fill('Discovery (2 weeks), policy drafting (4 weeks), training (2 sessions).');
  await ed().getByRole('button', { name: 'Save proposal' }).click(); await settle();
  await ed().getByRole('button', { name: 'Send for owner review' }).click(); await settle();
  await ed().getByRole('button', { name: 'Approve (owner review)' }).click(); await settle();
  check('approved version 2 preserved with version 1 history', (await ed().innerText()).includes('Approved version 2') && (await ed().innerText()).includes('Version 1'));
  await ed().getByRole('button', { name: 'Record submission' }).click();
  d = dialog();
  await d.getByLabel(/Submission date/).fill('2026-11-20');
  await d.getByLabel('Confirmation / reference').fill(`PORTAL-${T}`);
  await d.getByRole('button', { name: 'Record submission' }).click(); await settle(900);
  check('submission recorded for the approved version without sending anything', (await ed().innerText()).includes('Submitted.'));

  // Confirm award.
  await tab('Submission & award');
  await page.getByRole('button', { name: 'Record outcome' }).click();
  d = dialog();
  await d.locator('select').first().selectOption('Awarded');
  await d.getByLabel(/Outcome date/).fill('2026-12-01');
  await choose(d, /Award evidence/, `Award notice ${T} · Verified`, `Award notice ${T}`);
  await d.getByLabel(/I confirm the award/).check();
  await d.getByRole('button', { name: 'Save outcome' }).click(); await settle(900);
  check('award confirmed with evidence', (await panel().innerText()).includes('Awarded'));

  // Create project (review step).
  await tab('Project');
  await page.getByRole('button', { name: 'Review and create project' }).click();
  d = dialog();
  await d.getByLabel('Planned completion').fill('2027-03-31');
  await d.getByRole('textbox', { name: 'Deliverable 1', exact: true }).fill('Governance framework');
  await d.getByLabel(/I confirm these details/).check();
  await d.getByRole('button', { name: 'Create project' }).click(); await settle(1200);
  check('project created from confirmed award with baseline 1', (await page.locator('.pursuit').innerText()).includes('Baseline 1 (active)'));
  await page.getByLabel('Move project to').selectOption('Active');
  await page.getByRole('button', { name: 'Apply status' }).click(); await settle();

  // Milestones.
  await tab('Milestones');
  for (const [title, date] of [['Discovery complete', '2026-12-20'], ['Framework delivered', '2027-02-28']]) {
    await page.getByRole('button', { name: 'Add milestone' }).click();
    d = dialog();
    await d.getByRole('textbox', { name: 'Milestone *', exact: true }).fill(title);
    await d.getByLabel('Planned date').fill(date);
    if (title === 'Framework delivered') await d.getByLabel('Discovery complete').check();
    await save(d);
  }
  const msRow = name => page.locator('.followup-list li').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
  for (const name of ['Discovery complete', 'Framework delivered']) {
    await msRow(name).getByRole('button', { name: 'Edit' }).click();
    d = dialog();
    await d.getByLabel('Status').selectOption('Complete');
    await d.getByLabel('Actual completion date').fill(name === 'Discovery complete' ? '2026-12-19' : '2027-02-27');
    await save(d);
  }
  check('milestones planned with dependency and completed in order', (await panel().innerText()).match(/Complete/g)?.length >= 2);

  // Deliverable: submit → request revision → revise → accept with client evidence.
  await tab('Deliverables');
  const delRow = () => page.locator('.followup-list > li', { hasText: 'Governance framework' }).first();
  await delRow().getByRole('button', { name: 'Edit' }).click();
  d = dialog(); await d.getByLabel(/Current draft/).fill('Framework v1 — private drive / delivery / framework-v1'); await save(d);
  await delRow().getByRole('button', { name: 'Submit for review' }).click(); await settle();
  await delRow().getByRole('button', { name: 'Request revision' }).click();
  d = dialog(); await d.getByLabel(/What needs to change/).fill('Add an escalation path.'); await save(d);
  await delRow().getByRole('button', { name: 'Edit' }).click();
  d = dialog(); await d.getByLabel(/Current draft/).fill('Framework v2 with escalation path — framework-v2'); await save(d);
  await delRow().getByRole('button', { name: 'Submit for review' }).click(); await settle();
  await delRow().getByRole('button', { name: 'Record acceptance' }).click();
  d = dialog();
  await d.getByLabel(/Client acceptance — with/).check();
  await d.getByLabel(/Accepted by/).fill('Dr. Lee, Superintendent');
  await choose(d, /Acceptance evidence/, `Signed acceptance ${T}`);
  await d.getByRole('button', { name: 'Record acceptance' }).click(); await settle(900);
  check('revised version 2 accepted by recorded client authority', (await delRow().innerText()).includes('Accepted version 2 — Client acceptance by Dr. Lee'));

  // Approve a scope change.
  await tab('Changes');
  await page.getByRole('button', { name: 'Propose change' }).click();
  d = dialog();
  await d.getByRole('textbox', { name: 'Change *', exact: true }).fill('Add a follow-up workshop');
  await d.getByLabel('Requested change').fill('One additional staff workshop in March.');
  await d.getByLabel('Reason for the change').fill('Client request after pilot.');
  await d.getByLabel(/Proposed baseline scope/).fill('Governance framework, staff training and one follow-up workshop.');
  await d.getByLabel('Proposed planned completion').fill('2027-04-15');
  await save(d);
  await page.getByRole('button', { name: 'Record decision' }).click();
  d = dialog(); await d.getByLabel('Decision rationale').fill('Agreed in writing; amendment reference pending.'); await d.getByRole('button', { name: 'Record decision' }).click(); await settle(900);
  await tab('Overview');
  const overview = await panel().innerText();
  check('approved change created baseline 2 and kept baseline 1', overview.includes('Baseline 2 (active)') && overview.includes('Baseline 1') && overview.includes('one follow-up workshop'));

  // Closeout (normal path, all checklist items complete).
  await page.getByLabel('Move project to').selectOption('Closing');
  await page.getByRole('button', { name: 'Apply status' }).click(); await settle();
  await tab('Closeout');
  await choose(panel(), 'Final acceptance evidence', `Signed acceptance ${T} · Verified`, `Signed acceptance ${T}`);
  await panel().getByLabel('Lessons learned').fill('Schedule stakeholder interviews before the holidays.');
  await panel().getByLabel('Archive and retention reviewed').check();
  await settle(300);
  const open = await panel().locator('.checklist li.open').count();
  check('closeout checklist complete before closing', open === 0, `${open} open`);
  await panel().getByRole('button', { name: 'Complete closeout' }).click(); await settle(900);
  check('project closed through closeout', (await page.locator('.pursuit-header').innerText()).includes('Closed'));

  // Private experience record.
  await panel().getByRole('button', { name: /Create private experience record/ }).click(); await settle(1000);
  check('experience record created as Private', (await page.locator('main').innerText()).includes('Private'));

  // Reload → persistence.
  await page.reload({ waitUntil: 'networkidle' }); await settle();
  await nav('Experience');
  check('experience record persists after reload', (await page.locator('main').innerText()).includes(`AI governance RFP ${T}`));
  await nav('Projects');
  await page.getByLabel('Filter projects by status').selectOption('All');
  check('closed project persists with accepted deliverable', (await page.locator('.opportunity-card', { hasText: `AI governance RFP ${T}` }).innerText()).includes('1 / 1'));
  await nav('Reports');
  check('reports render definitions and sources', (await page.locator('main').innerText()).includes('Source: projects'));

  // Export completeness.
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('button.side-export', { hasText: 'Export workspace' }).click()]);
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  const recs = exported.workflow.records;
  check('export contains the full chain', ['organization', 'contact', 'requirement', 'evidence', 'proposal', 'proposalVersion', 'submission', 'project', 'projectBaseline', 'milestone', 'deliverable', 'deliverableVersion', 'changeRequest', 'closeout', 'experience'].every(t => recs[t]?.length > 0));

  // Public exposure.
  const publicText = await (await page.request.get(BASE + '/api/site')).text();
  check('public content excludes contacts, proposals, evidence and projects', ![`Pat ${T}`, `Client ${T}`, `PORTAL-${T}`, 'Governance framework', `Signed acceptance ${T}`].some(x => publicText.includes(x)));

  // Mobile layout.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await mobile.newPage();
  await m.goto(BASE + '/signin-with-chatgpt?return_to=/workspace', { waitUntil: 'networkidle' }); await m.waitForTimeout(700);
  const overflow = () => m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  let mobileOk = true;
  for (const name of ['Organizations', 'Evidence', 'Projects', 'Experience', 'Reports']) {
    await m.getByRole('button', { name: 'Toggle navigation' }).click();
    await m.locator('nav button', { hasText: name }).first().click(); await m.waitForTimeout(500);
    const o = await overflow(); if (o > 1) { mobileOk = false; console.log(`  overflow on ${name}: ${o}px`); }
  }
  await m.getByRole('button', { name: 'Toggle navigation' }).click();
  await m.locator('nav button', { hasText: 'Projects' }).first().click(); await m.waitForTimeout(400);
  await m.getByLabel('Filter projects by status').selectOption('All');
  await m.locator('.opportunity-card', { hasText: `AI governance RFP ${T}` }).getByRole('button', { name: 'Open project' }).click(); await m.waitForTimeout(500);
  for (const name of ['Milestones', 'Deliverables', 'Changes', 'Closeout']) { await m.getByRole('tab', { name }).click(); await m.waitForTimeout(300); const o = await overflow(); if (o > 1) { mobileOk = false; console.log(`  overflow on ${name} tab: ${o}px`); } }
  check('mobile (390px) pages and project tabs have no horizontal overflow', mobileOk);
  await mobile.close();

  const live = await (await page.request.get(BASE + '/api/health')).json();
  const readyResponse = await page.request.get(BASE + '/api/health/ready');
  check('health endpoints report status without configuration details', live.status === 'ok' && readyResponse.status() === 200 && !JSON.stringify(await readyResponse.json()).match(/token|sites|inquiries/));
  check('no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} contracting journey checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
