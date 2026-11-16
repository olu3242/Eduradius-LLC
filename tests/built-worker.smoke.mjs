import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const cli = 'node_modules/wrangler/bin/wrangler.js';
const config = 'dist/server/wrangler.json';
const token = 'local-smoke-only-key-with-at-least-32-characters';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function worker(mode) {
  const state = mkdtempSync(join(tmpdir(), 'eduradius-smoke-'));
  const localEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' };
  let child, logs = '';
  const stop = async () => {
    if (child && child.exitCode === null) {
      if (process.platform === 'win32') child.kill(); else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(3000)]);
      if (child.exitCode === null && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    }
    rmSync(state, { recursive: true, force: true });
  };
  try {
    // Apply every migration in order, exactly as an environment upgrade would.
    for (const file of readdirSync('drizzle').filter(f => /^\d{4}_.+\.sql$/.test(f)).sort().map(f => 'drizzle/' + f)) {
      const result = spawnSync(process.execPath, [cli, 'd1', 'execute', 'DB', '--local', '--config', config, '--persist-to', state, '--file', file], { env: localEnv, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    const port = await freePort();
    const args = [cli, 'dev', '--config', config, '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'];
    // Always override ambient local configuration; these keys are test fixtures.
    args.push('--var', `WORKSPACE_AUTH_MODE:${mode}`, '--var', `WORKSPACE_ACCESS_TOKEN:${token}`);
    child = spawn(process.execPath, args, { env: localEnv, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { logs = (logs + data).slice(-12000); });
    child.stderr.on('data', data => { logs = (logs + data).slice(-12000); });
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(logs);
      try {
        const response = await fetch(base + '/api/auth/session', { signal: AbortSignal.timeout(1000) });
        if (response.ok) return { base, stop };
      } catch {}
      await pause(200);
    }
    throw new Error('Worker did not start: ' + logs);
  } catch (error) { await stop(); throw error; }
}

test('built Worker: public intake, token session, conversion, persistence and body rejection', { timeout: 120000 }, async () => {
  const app = await worker('token');
  try {
    const get = path => fetch(app.base + path);
    assert.equal((await get('/')).status, 200);
    assert.equal((await get('/workspace')).status, 200);
    assert.equal((await get('/api/workspace')).status, 401);
    const login = await fetch(app.base + '/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const owner = () => fetch(app.base + '/api/workspace', { headers: { cookie } });
    assert.equal((await owner()).status, 200);
    const inquiry = await fetch(app.base + '/api/inquiries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Smoke Test', organization: 'Local Test', email: 'smoke@example.com', sector: 'Education', scope: 'Local persistence check', kind: 'Project briefing' }) });
    assert.equal(inquiry.status, 201);
    const stored = await (await owner()).json();
    assert.ok(!('inquiries' in (stored.data ?? {})), 'inquiries are not copied into the workspace document');
    const json = (path, init = {}) => fetch(app.base + path, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) } });
    const full = async () => ({ ...(await (await json('/api/workflow')).json()), ...(await (await json('/api/export')).json()).workflow });
    let flow = await full();
    let lead = flow.inquiries[0];
    assert.equal(lead.scope, 'Local persistence check'); assert.equal(lead.status, 'New');
    assert.equal(flow.notifications[0].emailStatus, 'disabled');
    const qualify = await json(`/api/inquiries/${lead.id}`, { method: 'PATCH', body: JSON.stringify({ version: lead.version, changes: { status: 'Qualified', reason: 'Smoke qualification', assignee: 'Smoke owner' } }) });
    assert.equal(qualify.status, 200);
    lead = (await qualify.json()).inquiry;
    const draft = { title: 'Smoke opportunity', agency: 'Local Test', contactEmail: 'smoke@example.com', stage: 'Qualify' };
    const convert = () => json(`/api/inquiries/${lead.id}/convert`, { method: 'POST', body: JSON.stringify({ version: lead.version, opportunity: draft }) });
    const [first, second] = await Promise.all([convert(), convert()]);
    assert.deepEqual([first.status, second.status].sort(), [200, 201], 'one conversion succeeds; the concurrent duplicate returns the existing record');
    flow = await full();
    const firstPage = await (await json('/api/records/inquiry?limit=1')).json();
    assert.equal(firstPage.items.length, 1); assert.equal(firstPage.page.total, 1, 'paginated list served by the built Worker');
    assert.equal(flow.opportunities.filter(o => o.sourceInquiryId === lead.id).length, 1);
    assert.equal(flow.inquiries[0].status, 'Converted');
    assert.ok(flow.activity.some(a => a.type === 'inquiry.converted' && a.actor === 'token:session'));
    const publicText = JSON.stringify(await (await get('/api/site')).json());
    for (const secret of ['smoke@example.com', 'Smoke opportunity', 'Smoke qualification']) assert.ok(!publicText.includes(secret));
    assert.equal((await fetch(app.base + '/api/workflow')).status, 401, 'anonymous workflow access denied');
    const oversize = await fetch(app.base + '/api/workspace', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(700001), revision: 1 }) });
    assert.equal(oversize.status, 413);
    assert.equal((await owner()).status, 200, 'next request remains usable after oversize rejection');
    // Intake no longer creates the planning document; the owner's first save does.
    const base = stored.data ?? { profile: {}, codes: [], documents: [] };
    const updated = { ...base, profile: { ...base.profile, name: 'Saved in built Worker' } };
    const saved = await fetch(app.base + '/api/workspace', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ data: updated, revision: stored.revision }) });
    assert.equal(saved.status, 200);
    assert.equal((await (await owner()).json()).data.profile.name, 'Saved in built Worker');
  } finally { await app.stop(); }
});

test('built Worker: unconfigured owner access fails closed', { timeout: 120000 }, async () => {
  const app = await worker('unconfigured');
  try {
    assert.equal((await fetch(app.base + '/api/workspace')).status, 503);
    assert.equal((await fetch(app.base + '/api/workflow')).status, 503);
    assert.equal((await fetch(app.base + '/api/site')).status, 200);
    assert.equal((await (await fetch(app.base + '/api/auth/session')).json()).authenticated, false);
  } finally { await app.stop(); }
});
