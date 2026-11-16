// scripts/migration-status.mjs as an operator runs it, against real SQLite files and
// wrangler-style JSON: empty, previous-release, fully migrated, partial, failed and ambiguous targets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { migrationFiles } from './helpers/database.mjs';
import { SCHEMA_QUERY } from '../scripts/migration-status.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
const sql = f => readFileSync(join(ROOT, 'drizzle', f), 'utf8');
function dbFile(name, upTo, extra = '') {
  const file = join(dir, `${name}.sqlite`), db = new DatabaseSync(file);
  for (const f of migrationFiles()) if (upTo && f.slice(0, 4) <= upTo) db.exec(sql(f));
  if (extra) db.exec(extra);
  const rows = db.prepare(SCHEMA_QUERY).all(); db.close();
  const json = join(dir, `${name}.json`); writeFileSync(json, JSON.stringify([{ results: rows, success: true, meta: {} }]));
  return { file, json };
}
const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'scripts/migration-status.mjs'), ...args], { encoding: 'utf8' });
const files = migrationFiles();
const last = files.at(-1).slice(0, 4);

test('fresh install: an empty database is refused unless explicitly confirmed, then gets every file', () => {
  const empty = dbFile('empty', null);
  const refused = run('--wrangler-json', empty.json);
  assert.equal(refused.status, 1); assert.match(refused.stderr, /no schema objects were read/);
  const ok = run('--wrangler-json', empty.json, '--empty-database-ok');
  assert.equal(ok.status, 0); assert.match(ok.stdout, new RegExp(`Apply, in this order: ${files.join(', ')}`));
});

test('upgrade: the previous release (0006) gets exactly the newer files; a full database gets nothing', () => {
  const previous = dbFile('previous', '0006');
  for (const r of [run('--sqlite', previous.file), run('--wrangler-json', previous.json)]) {
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, new RegExp(`Apply, in this order: ${files.filter(f => f > '0006z').join(', ')}$`, 'm'));
  }
  const full = dbFile('full', last);
  const r = run('--sqlite', full.file);
  assert.equal(r.status, 0); assert.match(r.stdout, /Up to date/);
});

test('a partially applied migration is refused with its missing objects, and resume prints only those', () => {
  const file = files.find(f => f.startsWith('0007'));
  const partial = dbFile('partial', '0006', sql(file).split('--> statement-breakpoint').slice(0, 5).join('\n'));
  const r = run('--wrangler-json', partial.json);
  assert.equal(r.status, 2); assert.match(r.stdout, /partial  0007/); assert.match(r.stdout, /NOT CONSISTENT/); assert.doesNotMatch(r.stdout, /Apply, in this order/);
  const resume = run('--wrangler-json', partial.json, '--resume-sql', file);
  assert.equal(resume.status, 0); assert.equal(resume.stdout.trim().split('\n').length, sql(file).split('--> statement-breakpoint').length - 5);
});

test('failed, unreadable or malformed inspections are refused', () => {
  const cases = { error: [{ error: { text: 'not authorized: SQLITE_AUTH' } }], failed: [{ success: false, results: [] }], shape: [{ rows: [] }], scalar: 42 };
  for (const [name, value] of Object.entries(cases)) {
    const f = join(dir, `${name}.json`); writeFileSync(f, JSON.stringify(value));
    const r = run('--wrangler-json', f);
    assert.equal(r.status, 1, name); assert.match(r.stderr, /REFUSED/, name); assert.doesNotMatch(r.stdout, /Apply/, name);
  }
  const garbage = join(dir, 'garbage.json'); writeFileSync(garbage, 'not json at all');
  assert.equal(run('--wrangler-json', garbage).status, 1);
  assert.equal(run('--wrangler-json', join(dir, 'missing.json')).status, 1);
  assert.equal(run('--sqlite', join(dir, 'missing.sqlite')).status, 1);
});

test('ambiguous targets are refused: unrecognised objects, or migration tracking that disagrees with the schema', () => {
  const foreign = dbFile('foreign', last, 'CREATE TABLE legacy_billing (id text);');
  const r = run('--sqlite', foreign.file);
  assert.equal(r.status, 2); assert.match(r.stderr, /table legacy_billing/);
  assert.equal(run('--sqlite', foreign.file, '--allow-unrecognised').status, 0);
  const tracked = dbFile('tracked', '0006', 'CREATE TABLE d1_migrations (id integer primary key, name text);');
  assert.equal(run('--sqlite', tracked.file).status, 2, 'tracking present but not supplied');
  const agree = join(dir, 'agree.json'); writeFileSync(agree, JSON.stringify([{ success: true, results: files.filter(f => f <= '0006z').map(name => ({ name })) }]));
  const disagree = join(dir, 'disagree.json'); writeFileSync(disagree, JSON.stringify([{ success: true, results: files.map(name => ({ name })) }]));
  assert.equal(run('--sqlite', tracked.file, '--d1-migrations-json', agree).status, 0);
  const bad = run('--sqlite', tracked.file, '--d1-migrations-json', disagree);
  assert.equal(bad.status, 2); assert.match(bad.stderr, /Reconcile before applying anything/);
});
