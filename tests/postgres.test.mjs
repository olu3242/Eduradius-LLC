import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postgresSql } from '../lib/server/postgres.ts';
import { database } from './helpers/postgres-database.mjs';

test('SQL dialect preserves parameters, literal contents, comments and mixed-case aliases', () => {
  assert.equal(postgresSql("SELECT '?' AS _sortKey, rowid FROM `contacts` WHERE name LIKE ? -- ?\n"), "SELECT '?' AS \"_sortKey\", __rowid FROM \"contacts\" WHERE name ILIKE $1 -- ?\n");
  assert.match(postgresSql('INSERT OR IGNORE INTO workspaces (id) VALUES (?) RETURNING id'), /VALUES \(\$1\)\s+ON CONFLICT DO NOTHING RETURNING id/);
});

test('PostgreSQL atomic batches roll back earlier writes when a later statement fails', async () => {
  const db = database();
  try {
    await assert.rejects(db.batch([
      db.prepare("INSERT INTO workspaces(id,data,updated_at) VALUES (?, ?, ?)").bind('rollback', '{}', 'now'),
      db.prepare('INSERT INTO missing_table(id) VALUES (?)').bind('fail'),
    ]));
    assert.equal(await db.prepare('SELECT * FROM workspaces WHERE id = ?').bind('rollback').first(), null);
    const results = await db.batch([db.prepare('INSERT OR IGNORE INTO workspaces(id,data,updated_at) VALUES (?, ?, ?)').bind('saved', '{}', 'now')]);
    assert.equal(results[0].meta.changes, 1);
    assert.equal((await db.prepare('SELECT * FROM workspaces WHERE id = ?').bind('saved').first()).revision, 1);
    assert.equal((await db.prepare('INSERT OR IGNORE INTO workspaces(id,data,updated_at) VALUES (?, ?, ?)').bind('saved','{}','now').run()).meta.changes, 0);
    assert.equal('__rowid' in (await db.prepare('SELECT * FROM workspaces').first()), false);
  } finally { await db.close(); }
});

test('JSON imports, duplicate aggregation and case-insensitive search keep their API types', async () => {
  const db = database();
  try {
    const row = await db.prepare("SELECT json_extract(value, '$.name') AS name FROM json_each(?)").bind('[{"name":"Olu"}]').first();
    assert.equal(row.name, 'Olu');
    const grouped = await db.prepare("SELECT json_group_array(json_object('id', '1', 'name', 'Olu')) AS members").first();
    assert.deepEqual(JSON.parse(grouped.members), [{ id:'1', name:'Olu' }]);
    assert.equal((await db.prepare("SELECT 'Olu' LIKE ? AS matches").bind('olu').first()).matches, true);
  } finally { await db.close(); }
});
