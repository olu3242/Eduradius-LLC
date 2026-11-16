// LOCAL only: simulates a v5 rollback window on a database seeded with --legacy, so the
// forward import produces rollback conflicts (see tests/browser/recovery-ui.mjs).
//   node --import ./tests/register.mjs scripts/local/seed-rollback-conflicts.mjs <path-to-d1.sqlite>
import { env } from '../../tests/helpers/worker-env.mjs';
import { database } from '../../tests/helpers/database.mjs';

const file = process.argv[2];
if (!file || !/\.sqlite$/.test(file) || !file.includes('.wrangler')) throw new Error('Pass a local .wrangler D1 .sqlite file.');
Object.assign(env, { DB: database({ file }) });
const { importLegacyWorkflow } = await import('../../lib/server/workflow-store.ts');
const { buildExport } = await import('../../lib/server/export.ts');
const { legacyDocument, withRollbackMarker } = await import('../../lib/legacy-rollback.ts');
const { initialWorkspace } = await import('../../lib/workspace.ts');
const { readWorkspace } = await import('../../lib/server/workspace-store.ts');
await importLegacyWorkflow();                                  // first load of this release
const bundle = JSON.parse((await buildExport()).body);         // owner export
const doc = await withRollbackMarker(legacyDocument(bundle.workspace, bundle.workflow, initialWorkspace()).document, new Date().toISOString());
doc.inquiries[0].notes = 'Edited while the legacy app was live';  // rollback-window edits
doc.opportunities[0].title = doc.opportunities[0].title + ' (renamed in legacy app)';
const stored = await readWorkspace();
await env.DB.prepare("UPDATE workspaces SET data = ?, revision = revision + 1 WHERE id = 'eduradius' AND revision = ?").bind(JSON.stringify(doc), stored.revision).run();
env.DB.close();
console.log('rollback window simulated: 1 request and 1 opportunity edited in the legacy document');
