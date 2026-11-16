import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (args, env = {}) => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('WORKSPACE_')));
  return spawnSync(process.execPath, ['scripts/preflight.mjs', ...args], { env: { ...clean, ...env }, encoding: 'utf8' });
};
const secret = 'preflight-secret-value-that-must-never-print-0123456789';

test('preflight reports missing names and fails for staging without auth', () => {
  const r = run(['--target', 'staging']);
  assert.equal(r.status, 1); assert.match(r.stdout, /WORKSPACE_AUTH_MODE is missing/);
});
test('preflight passes token mode without printing the token', () => {
  const r = run(['--target', 'production'], { WORKSPACE_AUTH_MODE: 'token', WORKSPACE_ACCESS_TOKEN: secret });
  assert.equal(r.status, 0, r.stdout); assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret));
});
test('preflight rejects short and placeholder tokens and sites mode without allowlist', () => {
  assert.equal(run(['--target', 'staging'], { WORKSPACE_AUTH_MODE: 'token', WORKSPACE_ACCESS_TOKEN: 'short' }).status, 1);
  assert.equal(run(['--target', 'staging'], { WORKSPACE_AUTH_MODE: 'token', WORKSPACE_ACCESS_TOKEN: 'replace-with-a-real-secret-value-0000000' }).status, 1);
  assert.equal(run(['--target', 'production'], { WORKSPACE_AUTH_MODE: 'sites' }).status, 1);
  const ok = run(['--target', 'production'], { WORKSPACE_AUTH_MODE: 'sites', WORKSPACE_OWNER_EMAILS: 'owner@example.test' });
  assert.equal(ok.status, 0); assert.ok(!ok.stdout.includes('owner@example.test'));
});
test('preflight reads an env file overlay without echoing values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
  try {
    const file = join(dir, '.dev.vars');
    writeFileSync(file, `WORKSPACE_AUTH_MODE=token\nWORKSPACE_ACCESS_TOKEN="${secret}"\n`);
    const r = run(['--target', 'local', '--env-file', file]);
    assert.equal(r.status, 0, r.stdout); assert.ok(!r.stdout.includes(secret));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
