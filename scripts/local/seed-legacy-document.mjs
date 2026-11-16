// Writes a pre-workflow (legacy-shaped) workspace document into a LOCAL D1 file, so the
// first owner load exercises the JSON → table import. Synthetic content only.
//   node --import ./tests/register.mjs scripts/local/seed-legacy-document.mjs <path-to-d1.sqlite>
import { env } from '../../tests/helpers/worker-env.mjs';
import { database } from '../../tests/helpers/database.mjs';

const file = process.argv[2];
if (!file || !/\.sqlite$/.test(file) || !file.includes('.wrangler')) throw new Error('Pass a local .wrangler D1 .sqlite file.');
Object.assign(env, { DB: database({ file }) });
const { initialWorkspace } = await import('../../lib/workspace.ts');
const { readWorkspace, writeWorkspace } = await import('../../lib/server/workspace-store.ts');
const current = await readWorkspace();
if (current.data) throw new Error('A workspace document already exists; use an empty local database.');
const data = initialWorkspace();
data.inquiries = [{ id: 'legacy-qa-inquiry', name: 'Legacy Tester', organization: 'Legacy QA District', email: 'legacy@example.test', sector: 'Education & learning', scope: 'Legacy-format briefing request.', kind: 'Project briefing', createdAt: '2026-10-01T15:00:00.000Z', status: 'Tentative', notes: '' }];
data.opportunities = [{ id: 'legacy-qa-opportunity', title: 'Legacy QA Pursuit', agency: 'Legacy Agency', url: '', deadline: '2026-12-15', value: '', naics: '', psc: '', stage: 'Discover', decision: 'Undecided', owner: '', notes: '', checks: {}, status: 'Tentative' }];
data.activity = [{ text: 'Updated opportunity: Legacy QA Pursuit', date: '2026-10-05T12:00:00.000Z' }];
const result = await writeWorkspace(data, 0);
env.DB.close();
console.log('legacy document written', JSON.stringify(result).slice(0, 120));
