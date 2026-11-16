// Prepares a rollback to the pre-workflow application (Site v5). Reads an owner export
// (GET /api/export) and writes, without touching any database:
//   legacy-workspace.json        the workspace document v5 can read and save
//   apply-legacy-workspace.sql   a revision-guarded UPDATE of that document (run only after a backup)
// The workflow and contracting tables are not changed. See "Rollback" in docs/OPERATIONS.md.
//   node scripts/recovery/legacy-document.mjs --from-export <export.json> --out <directory>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { legacyDocument, acceptedByLegacySave, LEGACY_MAX_BYTES } from '../../lib/legacy-rollback.ts';
import { initialWorkspace } from '../../lib/workspace.ts';

const args = process.argv.slice(2), at = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const from = at('--from-export'), out = at('--out');
if (!from || !out) { console.error('Usage: --from-export <export.json> --out <directory>'); process.exit(1); }
const bundle = JSON.parse(readFileSync(from, 'utf8'));
if (bundle.schemaVersion !== 2 || !bundle.workflow || !bundle.manifest) { console.error('Not a complete workspace export (schemaVersion 2 with a manifest). Use GET /api/export.'); process.exit(1); }
const result = legacyDocument(bundle.workspace, bundle.workflow, initialWorkspace());
console.log(JSON.stringify({ counts: result.counts, bytes: result.bytes, legacyLimit: LEGACY_MAX_BYTES, workspaceRevision: bundle.manifest.workspaceRevision }, null, 1));
if (!result.fitsLegacyLimit || !acceptedByLegacySave(result.document)) {
  console.error(`The legacy document would be ${result.bytes} characters; Site v5 cannot save documents over ${LEGACY_MAX_BYTES}. Do not roll back to v5; fix forward or restore a backup.`);
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const json = JSON.stringify(result.document);
writeFileSync(join(out, 'legacy-workspace.json'), json);
const quoted = "'" + json.replaceAll("'", "''") + "'";
// Applies only if the document is still at the exported revision (no lost concurrent edits).
writeFileSync(join(out, 'apply-legacy-workspace.sql'), `UPDATE workspaces SET data = ${quoted}, revision = revision + 1, updated_at = '${new Date().toISOString()}' WHERE id = 'eduradius' AND revision = ${Number(bundle.manifest.workspaceRevision)};\n`);
console.log(`Wrote ${join(out, 'legacy-workspace.json')} and ${join(out, 'apply-legacy-workspace.sql')}. Nothing was applied.`);
