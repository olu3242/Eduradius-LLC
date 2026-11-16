// Seeds a deterministic SYNTHETIC dataset into a local SQLite/D1 file through the real
// store and route code (validation, hooks, activity). Local measurement only — never
// point it at a hosted database. Stop the dev server before running.
//   node --import ./tests/register.mjs scripts/perf/seed-dataset.mjs <path-to-d1.sqlite>
import { env } from '../../tests/helpers/worker-env.mjs';
import { database } from '../../tests/helpers/database.mjs';

const file = process.argv[2];
if (!file || !/\.sqlite$/.test(file) || !file.includes('.wrangler')) throw new Error('Pass a local .wrangler D1 .sqlite file.');
const token = 'perf-seed-only-access-key-with-32-plus-characters';
Object.assign(env, { DB: database({ file }), WORKSPACE_AUTH_MODE: 'token', WORKSPACE_ACCESS_TOKEN: token });

const create = await import('../../app/api/records/[type]/route.ts');
const update = await import('../../app/api/records/[type]/[id]/route.ts');
const actions = await import('../../app/api/actions/[action]/route.ts');
const opportunities = await import('../../app/api/opportunities/route.ts');
const { createPublicInquiry } = await import('../../lib/server/workflow-store.ts');
const { emptySections, SECTION_BASIS } = await import('../../lib/records.ts');

const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const req = (path, method, body) => new Request('https://eduradius.test' + path, { method, headers, body: JSON.stringify(body) });
const p = obj => ({ params: Promise.resolve(obj) });
async function ok(response, label) { if (![200, 201].includes(response.status)) throw new Error(`${label}: ${response.status} ${await response.text()}`); return response.json(); }
const add = async (type, record) => (await ok(await create.POST(req(`/api/records/${type}`, 'POST', { record, confirmDistinct: true }), p({ type })), type)).record;
const edit = async (type, rec, changes) => (await ok(await update.PATCH(req(`/api/records/${type}/${rec.id}`, 'PATCH', { version: rec.version, changes }), p({ type, id: rec.id })), type)).record;
const act = async (name, body) => ok(await actions.POST(req(`/api/actions/${name}`, 'POST', body), p({ action: name })), name);

const pad = n => String(n).padStart(4, '0');
const text = (label, n) => (`SYNTHETIC ${label}. ` + 'Representative narrative text for local volume measurement only. '.repeat(Math.ceil(n / 66))).slice(0, n);
const sectors = ['K-12', 'Higher education', 'State agency', 'Workforce'];
const t0 = Date.now();

for (let i = 0; i < 1200; i++) {
  await createPublicInquiry({ kind: i % 3 ? 'Briefing request' : 'Teaming inquiry', name: `Synthetic Person ${pad(i)}`, organization: `Synthetic District ${pad(i)}`, email: `person${pad(i)}@example.test`, sector: sectors[i % 4], scope: text(`scope ${pad(i)}`, 700) });
}
const opps = [];
for (let i = 0; i < 400; i++) {
  opps.push((await ok(await opportunities.POST(req('/api/opportunities', 'POST', { opportunity: { title: `Synthetic opportunity ${pad(i)}`, agency: `Synthetic Agency ${pad(i % 40)}`, notes: text(`opportunity ${pad(i)}`, 1500), nextAction: i % 5 ? '' : 'Review requirements', nextActionDue: i % 5 ? null : '2026-11-1' + (i % 9) } })), 'opportunity')).opportunity);
}
const orgs = [];
for (let i = 0; i < 400; i++) orgs.push(await add('organization', { name: `Synthetic Org ${pad(i)}`, orgType: i % 2 ? 'Government buyer' : 'Teaming partner', notes: text(`organization ${pad(i)}`, 1200) }));
for (let i = 0; i < 600; i++) await add('contact', { name: `Synthetic Contact ${pad(i)}`, organizationId: orgs[i % 400].id, email: `contact${pad(i)}@example.test`, notes: text(`contact ${pad(i)}`, 300) });
const evidence = [];
for (let i = 0; i < 300; i++) evidence.push(await add('evidence', { title: `Synthetic evidence ${pad(i)}`, category: 'Capability', reviewStatus: i % 3 ? 'Verified' : 'Unreviewed', reviewDate: i % 10 ? null : '2026-01-0' + (1 + (i % 9)), notes: text(`evidence ${pad(i)}`, 800) }));
let links = 0;
for (let o = 0; o < 60; o++) {
  for (let r = 0; r < 30; r++) {
    const requirement = await add('requirement', { opportunityId: opps[o].id, description: text(`requirement ${pad(o)}-${r}`, 500), owner: 'Synthetic owner', mandatory: r % 2 === 0 });
    if (r < 15) { await act('evidence.link', { evidenceId: evidence[(o * 30 + r) % 300].id, subjectType: 'requirement', subjectId: requirement.id }); links++; }
  }
}
// 30 awarded pursuits → projects with milestones and deliverables (full lifecycle path).
const notice = await add('evidence', { title: 'Synthetic notice of award', category: 'Award', reviewStatus: 'Verified' });
for (let i = 0; i < 30; i++) {
  const opp = opps[100 + i];
  let { record: proposal } = await act('proposal.create', { opportunityId: opp.id, title: `Synthetic proposal ${pad(i)}` });
  const sections = emptySections();
  for (const key of Object.keys(sections)) sections[key] = { body: text(`proposal ${pad(i)} ${key}`, 600), basis: SECTION_BASIS[0], refs: [] };
  proposal = await edit('proposal', proposal, { sections });
  proposal = (await act('proposal.submitForReview', { id: proposal.id, version: proposal.version })).record;
  proposal = (await act('proposal.approve', { id: proposal.id, version: proposal.version })).record;
  let { record: submission } = await act('proposal.recordSubmission', { id: proposal.id, version: proposal.version, submittedOn: '2026-10-01', method: 'Email' });
  submission = (await act('submission.recordOutcome', { id: submission.id, version: submission.version, outcome: 'Awarded', outcomeDate: '2026-10-15', awardEvidenceId: notice.id, confirmAward: true })).record;
  const { record: project } = await act('project.createFromAward', { submissionId: submission.id, confirm: true, title: `Synthetic project ${pad(i)}`, scope: text(`project ${pad(i)}`, 800), owner: 'Synthetic owner', startDate: '2026-11-01', plannedEndDate: '2027-0' + (1 + (i % 8)) + '-28', deliverables: [1, 2, 3, 4, 5].map(d => ({ title: `Synthetic deliverable ${pad(i)}-${d}` })) });
  let previous = null;
  for (let m = 0; m < 8; m++) previous = await add('milestone', { projectId: project.id, title: `Synthetic milestone ${pad(i)}-${m}`, plannedDate: `2026-1${m % 2 + 1}-1${m}`, dependsOn: previous ? [previous.id] : [] });
}
const db = env.DB;
const counts = Object.fromEntries((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name").all()).results
  .map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS n FROM ${name}`)]));
for (const [name, statement] of Object.entries(counts)) counts[name] = (await statement.first()).n;
db.close();
console.log(JSON.stringify({ seededInMs: Date.now() - t0, evidenceLinks: links, rows: counts }, null, 1));
