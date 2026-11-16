// Read-only: reports which migrations in drizzle/ are applied, pending or PARTIALLY applied by
// comparing the objects each file creates (tables, indexes, added columns) with a database's
// actual schema. Run it before prescribing any upgrade; it never writes.
//
//   Local D1 file:   node scripts/migration-status.mjs --sqlite <path-to-d1.sqlite>
//   Hosted D1:       wrangler d1 execute <db> --remote --json --command "$(node scripts/migration-status.mjs --print-query)" > schema.json
//                    node scripts/migration-status.mjs --wrangler-json schema.json
//   Resume a PARTIAL file (prints only its missing statements; review, then apply them):
//                    node scripts/migration-status.mjs --wrangler-json schema.json --resume-sql 0007_list_indexes.sql > resume.sql
//
// Exit codes: 0 = consistent (applied files form a prefix); 1 = inspection failed, unreadable or empty;
// 2 = partial, out-of-order, unrecognised objects, or tracking that disagrees with the schema.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = new URL('../drizzle/', import.meta.url);
// Only sqlite_master is read (D1 does not authorize pragma_table_info joins). SQLite rewrites a
// table's stored CREATE statement on ALTER TABLE ... ADD, so added columns are found in `sql`.
export const SCHEMA_QUERY = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'";

/** sqlite_master rows → [{ kind, tbl, name }] including one 'column' row per column of each table. */
export function schemaRows(master) {
  const rows = [];
  for (const r of master) {
    rows.push({ kind: r.type, tbl: r.tbl_name, name: r.name });
    if (r.type === 'table' && typeof r.sql === 'string') {
      // Column definitions are the depth-0, comma-separated parts between the outer parentheses.
      const body = r.sql.slice(r.sql.indexOf('(') + 1, r.sql.lastIndexOf(')'));
      const parts = []; let depth = 0, current = '';
      for (const ch of body) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch; }
      parts.push(current);
      for (const part of parts) { const m = part.trim().match(/^[`"\[]?([A-Za-z_][A-Za-z0-9_]*)[`"\]]?\s/); if (m && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)$/i.test(m[1])) rows.push({ kind: 'column', tbl: r.name, name: m[1] }); }
    }
  }
  return rows;
}

/** Objects a migration creates, parsed from its SQL. */
export function expectedObjects(sql) {
  const out = [];
  for (const m of sql.matchAll(/CREATE TABLE `([^`]+)`/g)) out.push({ kind: 'table', table: m[1], name: m[1] });
  for (const m of sql.matchAll(/CREATE (?:UNIQUE )?INDEX `([^`]+)` ON `([^`]+)`/g)) out.push({ kind: 'index', table: m[2], name: m[1] });
  for (const m of sql.matchAll(/ALTER TABLE `([^`]+)` ADD `([^`]+)`/g)) out.push({ kind: 'column', table: m[1], name: m[2] });
  return out;
}
export const migrationFiles = () => readdirSync(DIR).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();

/** rows: [{ kind: 'table'|'index'|'column', tbl, name }] (see schemaRows). */
export function migrationStatus(rows, files = migrationFiles(), read = f => readFileSync(new URL(f, DIR), 'utf8')) {
  const has = new Set(rows.map(r => `${r.kind}:${r.kind === 'column' ? `${r.tbl}.` : ''}${r.name}`));
  const status = files.map(file => {
    const objects = expectedObjects(read(file));
    const missing = objects.filter(o => !has.has(`${o.kind}:${o.kind === 'column' ? `${o.table}.` : ''}${o.name}`));
    return { file, state: !missing.length ? 'applied' : missing.length === objects.length ? 'pending' : 'partial', objects: objects.length, missing: missing.map(o => `${o.kind} ${o.kind === 'column' ? `${o.table}.` : ''}${o.name}`) };
  });
  const firstNotApplied = status.findIndex(s => s.state !== 'applied');
  const prefix = firstNotApplied === -1 ? status.length : firstNotApplied;
  const problems = status.filter((s, i) => s.state === 'partial' || (i > prefix && s.state === 'applied'));
  return {
    status,
    applied: status.slice(0, prefix).map(s => s.file),
    toApply: problems.length ? [] : status.slice(prefix).map(s => s.file),
    problems: problems.map(s => ({ file: s.file, state: s.state, missing: s.missing })),
    consistent: problems.length === 0,
  };
}

/**
 * Statements of `file` whose objects are missing, in file order. Every migration statement here
 * creates exactly one table, index or column, so applying these completes a partially applied file.
 */
export function resumeStatements(file, rows, read = f => readFileSync(new URL(f, DIR), 'utf8')) {
  const has = new Set(rows.map(r => `${r.kind}:${r.kind === 'column' ? `${r.tbl}.` : ''}${r.name}`));
  return read(file).split('--> statement-breakpoint').map(st => st.trim()).filter(Boolean).filter(st => {
    const objects = expectedObjects(st);
    if (objects.length !== 1) throw new Error(`Cannot resume ${file}: a statement does not create exactly one object.`);
    const o = objects[0];
    return !has.has(`${o.kind}:${o.kind === 'column' ? `${o.table}.` : ''}${o.name}`);
  }).map(st => (st.endsWith(';') ? st : st + ';'));
}

const PLATFORM_TABLES = new Set(['_cf_KV', '_cf_METADATA', 'd1_migrations', 'sqlite_sequence']);
/** Objects no migration creates (platform tables excluded): the tool cannot vouch for such a database. */
export function unrecognised(rows, files = migrationFiles(), read = f => readFileSync(new URL(f, DIR), 'utf8')) {
  const known = new Set(files.flatMap(f => expectedObjects(read(f))).filter(o => o.kind !== 'column').map(o => `${o.kind}:${o.name}`));
  return rows.filter(r => r.kind !== 'column' && !PLATFORM_TABLES.has(r.tbl) && !known.has(`${r.kind}:${r.name}`)).map(r => `${r.kind} ${r.name}`);
}
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not readable JSON (${e.message.slice(0, 80)}).`); } };
const wranglerResults = (parsed, what) => {
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const failed = entries.find(e => !e || typeof e !== 'object' || e.error || e.success === false || !Array.isArray(e.results));
  if (failed) throw new Error(`The ${what} query failed or returned an unexpected shape: ${JSON.stringify(failed).slice(0, 200)}`);
  return entries.flatMap(r => r.results);
};

async function main(args) {
  if (args.includes('--print-query')) { console.log(SCHEMA_QUERY); return 0; }
  let rows;
  const at = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  try {
    if (at('--sqlite')) {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(at('--sqlite'), { readOnly: true });
      rows = schemaRows(db.prepare(SCHEMA_QUERY).all()); db.close();
    } else if (at('--wrangler-json')) rows = schemaRows(wranglerResults(readJson(at('--wrangler-json')), 'schema'));
    else { console.error('Usage: --sqlite <file> | --wrangler-json <file> | --print-query'); return 1; }
  } catch (e) { console.error(`REFUSED: could not inspect the database: ${e.message}`); return 1; }
  // Fail closed: an empty or unreadable schema must never turn into "apply everything".
  if (!rows.length && !args.includes('--empty-database-ok')) { console.error('REFUSED: no schema objects were read. If this is a brand-new empty database, rerun with --empty-database-ok.'); return 1; }
  const strange = unrecognised(rows);
  if (strange.length && !args.includes('--allow-unrecognised')) {
    console.error(`REFUSED: objects that no migration creates: ${strange.slice(0, 10).join(', ')}${strange.length > 10 ? ', …' : ''}. Confirm this is the intended database; rerun with --allow-unrecognised only if they are expected.`);
    return 2;
  }
  if (at('--resume-sql')) { console.log(resumeStatements(at('--resume-sql'), rows).join('\n')); return 0; }
  const result = migrationStatus(rows);
  // Platform migration tracking must agree with the schema; otherwise the state is ambiguous.
  if (rows.some(r => r.kind === 'table' && r.name === 'd1_migrations')) {
    if (!at('--d1-migrations-json')) { console.error('REFUSED: this database has Wrangler migration tracking (d1_migrations). Also pass --d1-migrations-json <file> from: wrangler d1 execute <db> --remote --json --command "SELECT name FROM d1_migrations ORDER BY id"'); return 2; }
    let tracked;
    try { tracked = wranglerResults(readJson(at('--d1-migrations-json')), 'd1_migrations').map(r => String(r.name)); } catch (e) { console.error(`REFUSED: ${e.message}`); return 1; }
    if (JSON.stringify(tracked) !== JSON.stringify(result.applied)) { console.error(`REFUSED: d1_migrations lists [${tracked.join(', ')}] but the schema shows [${result.applied.join(', ')}] applied. Reconcile before applying anything.`); return 2; }
  }
  for (const s of result.status) console.log(`${s.state.padEnd(8)} ${s.file}${s.missing.length && s.state === 'partial' ? `  missing: ${s.missing.join(', ')}` : ''}`);
  if (!result.consistent) {
    console.log('\nNOT CONSISTENT: a migration is partially applied or applied out of order. Do not apply further files.');
    console.log('Follow "Interrupted migration" in docs/OPERATIONS.md, or restore the pre-migration backup.');
    return 2;
  }
  console.log(result.toApply.length ? `\nApply, in this order: ${result.toApply.join(', ')}` : '\nUp to date: every migration is applied.');
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await main(process.argv.slice(2)));
