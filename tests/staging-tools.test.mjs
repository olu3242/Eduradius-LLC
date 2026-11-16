// Staging safeguards: configuration generator and certification script, against local fixtures
// and a mock HTTP server. Nothing here contacts a hosted service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const production = JSON.parse(readFileSync(join(ROOT, 'scripts/production-identity.json'), 'utf8'));
const ACCOUNT = 'a'.repeat(32), DB_ID = '3f2c9d4e-1b7a-4c2e-9f10-5a6b7c8d9e0f';
const good = { STAGING_CLOUDFLARE_ACCOUNT_ID: ACCOUNT, STAGING_WORKER_NAME: 'eduradius-staging', STAGING_D1_DATABASE_NAME: 'eduradius-staging', STAGING_D1_DATABASE_ID: DB_ID };
const target = e => `${e.STAGING_CLOUDFLARE_ACCOUNT_ID}/${e.STAGING_WORKER_NAME}/${e.STAGING_D1_DATABASE_NAME}/${e.STAGING_D1_DATABASE_ID}`;
function fixture({ built = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'staging-config-'));
  if (built) { mkdirSync(join(dir, 'dist/server'), { recursive: true }); writeFileSync(join(dir, 'dist/server/wrangler.json'), JSON.stringify({ name: 'site', main: 'index.js', vars: { SECRET_SHOULD_NOT_SURVIVE: 'x' }, d1_databases: [{ binding: 'DB', database_name: 'site-creator-d1', database_id: production.d1DatabaseIds[0] }], dev: { port: 1 } })); }
  return dir;
}
const config = (env, dir = fixture()) => ({ dir, ...spawnSync(process.execPath, [join(ROOT, 'scripts/staging-config.mjs')], { cwd: dir, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }) });

test('staging config refuses missing, production-like, placeholder and unconfirmed targets', () => {
  const cases = [
    [{}, /set STAGING_CLOUDFLARE_ACCOUNT_ID/],
    [{ ...good, STAGING_CONFIRM_TARGET: target(good), STAGING_CLOUDFLARE_ACCOUNT_ID: 'nope' }, /account id/],
    [{ ...good, STAGING_WORKER_NAME: production.workerNames[0] }, /staging/],
    [{ ...good, STAGING_D1_DATABASE_NAME: production.d1DatabaseNames[0] }, /must contain "staging"/],
    [{ ...good, STAGING_D1_DATABASE_ID: production.d1DatabaseIds[0] }, /production or placeholder/],
    [{ ...good, STAGING_D1_DATABASE_ID: 'not-a-uuid' }, /UUID/],
    [{ ...good, STAGING_CONFIRM_TARGET: 'eduradius-staging' }, /complete target exactly/],
    [{ ...good, STAGING_CONFIRM_TARGET: target({ ...good, STAGING_D1_DATABASE_ID: DB_ID.replace('3f', '4f') }) }, /complete target exactly/],
  ];
  for (const [env, message] of cases) {
    const r = config({ ...env, ...(env.STAGING_CONFIRM_TARGET || !env.STAGING_WORKER_NAME ? {} : { STAGING_CONFIRM_TARGET: target(env) }) });
    assert.equal(r.status, 2, JSON.stringify(env)); assert.match(r.stderr, message);
    assert.ok(!existsSync(join(r.dir, 'dist/server/wrangler.staging.json')), 'nothing written');
  }
  const unbuilt = config({ ...good, STAGING_CONFIRM_TARGET: target(good) }, fixture({ built: false }));
  assert.equal(unbuilt.status, 2); assert.match(unbuilt.stderr, /build the candidate first/);
});

test('staging config writes only the isolated target and no secret values', () => {
  const r = config({ ...good, STAGING_CONFIRM_TARGET: target(good), WORKSPACE_ACCESS_TOKEN: 'super-secret-token-value-should-never-appear-1234' });
  assert.equal(r.status, 0, r.stderr);
  const written = readFileSync(join(r.dir, 'dist/server/wrangler.staging.json'), 'utf8');
  const parsed = JSON.parse(written);
  assert.equal(parsed.account_id, ACCOUNT); assert.equal(parsed.name, 'eduradius-staging');
  assert.deepEqual(parsed.d1_databases, [{ binding: 'DB', database_name: 'eduradius-staging', database_id: DB_ID }]);
  assert.deepEqual(parsed.vars, { WORKSPACE_AUTH_MODE: 'token' }); assert.equal(parsed.dev, undefined);
  for (const text of [written, r.stdout, r.stderr]) assert.ok(!text.includes('super-secret-token-value'));
});

/** Mock deployment: health/readiness as configured; records every request method and path. */
async function mockServer({ build = 'abcdef123456', ready = 200 } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json'); res.setHeader('x-request-id', 'mock-request-id');
    if (req.url === '/api/health') return res.end(JSON.stringify({ status: 'ok', build }));
    if (req.url === '/api/health/ready') { res.statusCode = ready; return res.end(JSON.stringify({ status: ready === 200 ? 'ok' : 'not_ready', checks: {} })); }
    res.statusCode = 401; res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}
const TOKEN = 'staging-test-token-0123456789abcdef0123456789';
function certify(env, args = []) {
  return new Promise(res => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/staging-certify.mjs'), ...args], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('exit', code => res({ code, out, err }));
  });
}

test('certification refuses production, unconfirmed hosts and a missing candidate before any request', async () => {
  const prod = await certify({ STAGING_BASE_URL: `https://${production.hosts[0]}`, STAGING_CONFIRM_HOST: production.hosts[0], STAGING_ACCESS_TOKEN: TOKEN }, ['--expect-build', 'abcdef1']);
  assert.equal(prod.code, 2); assert.match(prod.err, /production Site/);
  const mock = await mockServer();
  try {
    const unconfirmed = await certify({ STAGING_BASE_URL: mock.base, STAGING_CONFIRM_HOST: 'localhost', STAGING_ACCESS_TOKEN: TOKEN }, ['--expect-build', 'abcdef1']);
    assert.equal(unconfirmed.code, 2); assert.match(unconfirmed.err, /exactly match/);
    const noBuild = await certify({ STAGING_BASE_URL: mock.base, STAGING_CONFIRM_HOST: '127.0.0.1', STAGING_ACCESS_TOKEN: TOKEN });
    assert.equal(noBuild.code, 2); assert.match(noBuild.err, /--expect-build/);
    const plainHttp = await certify({ STAGING_BASE_URL: 'http://staging.example.test', STAGING_CONFIRM_HOST: 'staging.example.test', STAGING_ACCESS_TOKEN: TOKEN }, ['--expect-build', 'abcdef1']);
    assert.equal(plainHttp.code, 2); assert.match(plainHttp.err, /https/);
    assert.deepEqual(mock.seen, [], 'no request was sent for any refused run');
  } finally { mock.close(); }
});

test('certification stops before creating records when the build or readiness is wrong', async () => {
  for (const [options, label] of [[{ build: '000000000000' }, 'build mismatch'], [{ ready: 503 }, 'not ready']]) {
    const mock = await mockServer(options);
    try {
      const r = await certify({ STAGING_BASE_URL: mock.base, STAGING_CONFIRM_HOST: '127.0.0.1', STAGING_ACCESS_TOKEN: TOKEN }, ['--expect-build', 'abcdef123456']);
      assert.equal(r.code, 2, label); assert.match(r.out, /no records were created/, label);
      assert.ok(mock.seen.every(s => s.startsWith('GET /api/health')), `${label}: only health checks were requested (${mock.seen.join(', ')})`);
      assert.ok(!r.out.includes(TOKEN) && !r.err.includes(TOKEN), 'token never printed');
    } finally { mock.close(); }
  }
});
