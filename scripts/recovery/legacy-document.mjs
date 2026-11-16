// Prepares a rollback to the PRE-WORKFLOW application (Site v5). Prefer redeploying the previous
// release (e07844b or later), which reads current data directly; use this only when v5 is the
// required target. Reads an owner export (GET /api/export) and writes, without touching any database:
//   legacy-workspace.json        the workspace document v5 can read and save (with a rollback marker)
//   apply-legacy-workspace.sql   a revision-guarded UPDATE of that document (run only after a backup)
// Refuses: incomplete exports, documents v5 cannot save (size), and runs without
// --confirm-v5-rollback. The workflow and contracting tables are not changed.
//   node scripts/recovery/legacy-document.mjs --from-export <export.json> --out <directory> --confirm-v5-rollback
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { legacyDocument, acceptedByLegacySave, withRollbackMarker, LEGACY_MAX_BYTES } from '../../lib/legacy-rollback.ts';
import { initialWorkspace } from '../../lib/workspace.ts';

const args = process.argv.slice(2), at = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const refuse = (code, message) => { console.error(`REFUSED: ${message}`); process.exit(code); };
const from = at('--from-export'), out = at('--out');
if (!from || !out) refuse(1, 'usage: --from-export <export.json> --out <directory> --confirm-v5-rollback');
let bundle;
try { bundle = JSON.parse(readFileSync(from, 'utf8')); } catch { refuse(1, 'the export file could not be read as JSON.'); }
if (bundle.schemaVersion !== 2 || !bundle.workflow || !bundle.manifest?.counts) refuse(1, 'not a complete workspace export (schemaVersion 2 with a manifest). Use GET /api/export.');
const w = bundle.workflow, counts = bundle.manifest.counts;
const mismatched = [['inquiries', w.inquiries], ['opportunities', w.opportunities], ['activity', w.activity], ['evidenceLinks', w.evidenceLinks], ...Object.entries(w.records ?? {})]
  .filter(([k, list]) => !Array.isArray(list) || counts[k] !== list.length).map(([k]) => k);
if (mismatched.length) refuse(2, `the export is incomplete or altered (counts differ for: ${mismatched.join(', ')}). Take a new export.`);

const result = legacyDocument(bundle.workspace, w, initialWorkspace());
const document = await withRollbackMarker(result.document, new Date().toISOString());
const json = JSON.stringify(document);
const hiddenUnderV5 = Object.fromEntries(Object.entries(w.records ?? {}).filter(([, l]) => l.length).map(([k, l]) => [k, l.length]));
console.log(JSON.stringify({ counts: result.counts, bytes: json.length, legacyLimit: LEGACY_MAX_BYTES, workspaceRevision: bundle.manifest.workspaceRevision,
  keptInTablesButNotShownByV5: { ...hiddenUnderV5, workflowActivity: result.counts.activityKeptInTablesOnly } }, null, 1));
if (json.length > LEGACY_MAX_BYTES || !acceptedByLegacySave(document)) refuse(2, `the legacy document would be ${json.length} characters; Site v5 cannot save documents over ${LEGACY_MAX_BYTES}. Do not roll back to v5: redeploy the previous release, fix forward, or restore a backup.`);
if (!args.includes('--confirm-v5-rollback')) refuse(3, 'v5 cannot show the records listed above (they stay in their tables). Prefer redeploying the previous release. If v5 is required, rerun with --confirm-v5-rollback.');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'legacy-workspace.json'), json);
const quoted = "'" + json.replaceAll("'", "''") + "'";
// Applies only if the document is still at the exported revision (no lost concurrent edits).
writeFileSync(join(out, 'apply-legacy-workspace.sql'), `UPDATE workspaces SET data = ${quoted}, revision = revision + 1, updated_at = '${new Date().toISOString()}' WHERE id = 'eduradius' AND revision = ${Number(bundle.manifest.workspaceRevision)};\n`);
console.log(`Wrote ${join(out, 'legacy-workspace.json')} and ${join(out, 'apply-legacy-workspace.sql')}. Nothing was applied.`);
console.log('While v5 is live, treat existing requests and opportunities as read-only where possible: edits to them come back as conflicts that the owner must decide (Follow-ups → Rollback conflicts).');
