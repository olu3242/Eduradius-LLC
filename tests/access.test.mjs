import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { env } from './helpers/worker-env.mjs';
import { database } from './helpers/database.mjs';
import * as workspace from '../app/api/workspace/route.ts';
import * as session from '../app/api/auth/session/route.ts';
import * as inquiries from '../app/api/inquiries/route.ts';
import * as site from '../app/api/site/route.ts';
import { createSessionCookie, SESSION_COOKIE } from '../lib/server/access.ts';
import { readJson } from '../lib/server/http.ts';
import { readWorkspace, writeWorkspace } from '../lib/server/workspace-store.ts';
import { consume, LIMITS } from '../lib/server/rate-limit.ts';
import { toPublicSite } from '../lib/public-site.ts';
import { INQUIRY_KINDS } from '../lib/inquiry.ts';
import { initialWorkspace } from '../lib/workspace.ts';

const token = 'test-only-access-key-with-at-least-32-characters';
const origin = 'https://eduradius.test';
const request = (path, method = 'GET', body, headers = {}) => new Request(origin + path, {
  method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const ownerRequest = (method = 'GET', body, headers = {}) => request('/api/workspace', method, body, { authorization: `Bearer ${token}`, ...headers });
const inquiry = { name: 'Test Person', organization: 'Test Organization', email: 'test@example.com', sector: 'Education', scope: 'Training workshop', kind: 'Project briefing' };
let db;
beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  db = database();
  Object.assign(env, { DB: db, WORKSPACE_AUTH_MODE: 'token', WORKSPACE_ACCESS_TOKEN: token });
});
afterEach(() => db.close());

test('unconfigured built-runtime access fails closed before reading data', async () => {
  delete env.WORKSPACE_AUTH_MODE;
  assert.equal((await workspace.GET(ownerRequest())).status, 503);
  assert.equal((await workspace.PUT(ownerRequest('PUT', { data: initialWorkspace(), revision: 0 }))).status, 503);
  assert.equal((await readWorkspace()).revision, 0);
});
test('unknown mode and short token both fail closed', async () => {
  env.WORKSPACE_AUTH_MODE = 'invalid';
  assert.equal((await workspace.GET(ownerRequest())).status, 503);
  env.WORKSPACE_AUTH_MODE = 'token'; env.WORKSPACE_ACCESS_TOKEN = 'short';
  assert.equal((await workspace.GET(ownerRequest())).status, 503);
});
test('anonymous and wrong bearer cannot read or write owner data', async () => {
  assert.equal((await workspace.GET(request('/api/workspace'))).status, 401);
  assert.equal((await workspace.PUT(request('/api/workspace', 'PUT', { data: initialWorkspace(), revision: 0 }, { authorization: 'Bearer wrong' }))).status, 401);
  assert.equal((await readWorkspace()).revision, 0);
});
test('client-supplied Sites identity cannot bypass token mode', async () => {
  assert.equal((await workspace.GET(request('/api/workspace', 'GET', undefined, { 'oai-authenticated-user-id': 'owner' }))).status, 401);
});
test('owner save/read persists and stale revision returns conflict', async () => {
  const data = initialWorkspace(); data.profile.name = 'Saved company';
  assert.equal((await workspace.PUT(ownerRequest('PUT', { data, revision: 0 }))).status, 200);
  assert.equal((await (await workspace.GET(ownerRequest())).json()).data.profile.name, 'Saved company');
  assert.equal((await workspace.PUT(ownerRequest('PUT', { data, revision: 0 }))).status, 409);
  assert.equal((await workspace.PUT(ownerRequest('PUT', { data, revision: 1 }))).status, 200);
});
test('cross-origin owner writes and sign-in are rejected', async () => {
  const headers = { origin: 'https://other.test' };
  assert.equal((await workspace.PUT(ownerRequest('PUT', { data: initialWorkspace(), revision: 0 }, headers))).status, 403);
  assert.equal((await session.POST(request('/api/auth/session', 'POST', { token }, headers))).status, 403);
  assert.equal((await session.DELETE(request('/api/auth/session', 'DELETE', undefined, headers))).status, 403);
});
test('cross-site fetch metadata is rejected even without Origin', async () => {
  assert.equal((await inquiries.POST(request('/api/inquiries', 'POST', inquiry, { 'sec-fetch-site': 'cross-site' }))).status, 403);
});
test('valid token sign-in sets a secure session that can read owner data', async () => {
  const response = await session.POST(request('/api/auth/session', 'POST', { token }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Max-Age=43200']) assert.ok(cookie.includes(flag));
  const headers = { cookie: cookie.split(';')[0] };
  assert.equal((await workspace.GET(request('/api/workspace', 'GET', undefined, headers))).status, 200);
  assert.equal((await (await session.GET(request('/api/auth/session', 'GET', undefined, headers))).json()).authenticated, true);
});
test('invalid sign-in is rate limited after ten attempts', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await session.POST(request('/api/auth/session', 'POST', { token: 'wrong' }))).status, 401);
  const response = await session.POST(request('/api/auth/session', 'POST', { token: 'wrong' }));
  assert.equal(response.status, 429); assert.ok(Number(response.headers.get('retry-after')) > 0);
});
test('tampered and expired cookies cannot authenticate', async () => {
  const cookie = (await createSessionCookie(request('/api/auth/session'))).split(';')[0];
  const value = cookie.slice(cookie.indexOf('=') + 1);
  const parts = value.split('.');
  for (const changed of [value + 'x', value.replace(parts[2], 'changed'), value.replace(parts[1], '0000000000000')]) {
    assert.equal((await workspace.GET(request('/api/workspace', 'GET', undefined, { cookie: `${SESSION_COOKIE}=${changed}` }))).status, 401);
  }
});
test('rotating access key invalidates existing signed sessions', async () => {
  const cookie = (await createSessionCookie(request('/api/auth/session'))).split(';')[0];
  env.WORKSPACE_ACCESS_TOKEN = token + '-rotated';
  assert.equal((await workspace.GET(request('/api/workspace', 'GET', undefined, { cookie }))).status, 401);
});
test('sign-out clears the browser cookie', async () => {
  assert.match((await session.DELETE(request('/api/auth/session', 'DELETE'))).headers.get('set-cookie'), /Max-Age=0/);
});
test('Sites mode requires identity and an owner allowlist outside dev', async () => {
  env.WORKSPACE_AUTH_MODE = 'sites';
  assert.equal((await workspace.GET(request('/api/workspace'))).status, 401);
  const headers = { 'oai-authenticated-user-id': 'owner-123' };
  assert.equal((await workspace.GET(request('/api/workspace', 'GET', undefined, headers))).status, 503);
  env.WORKSPACE_OWNER_IDS = 'owner-123';
  assert.equal((await workspace.GET(request('/api/workspace', 'GET', undefined, headers))).status, 200);
  assert.equal((await workspace.GET(request('/api/workspace', 'GET', undefined, { 'oai-authenticated-user-id': 'outsider' }))).status, 403);
});
test('Sites owner email allowlist matches normalized email', async () => {
  env.WORKSPACE_AUTH_MODE = 'sites'; env.WORKSPACE_OWNER_EMAILS = ' Owner@Example.com ';
  assert.equal((await workspace.GET(request('/api/workspace', 'GET', undefined, { 'oai-authenticated-user-id': '123', 'oai-authenticated-user-email': 'owner@example.com' }))).status, 200);
});
test('public projection excludes private fields and unknown future content', () => {
  const data = initialWorkspace();
  data.profile.owner = 'private owner'; data.receipts.amount = 'private amount';
  data.siteContent.internalNote = 'private future note'; data.inquiries = [{ scope: 'private inquiry' }];
  const result = toPublicSite(data), text = JSON.stringify(result);
  for (const secret of ['private owner', 'private amount', 'private future note', 'private inquiry']) assert.ok(!text.includes(secret));
  assert.deepEqual(result.profile.services, data.profile.services);
  assert.equal(result.siteContent.headline, data.siteContent.headline);
});
test('public projection handles malformed list entries safely', () => {
  const result = toPublicSite({ profile: { services: ['AI consulting', null, 123] }, codes: [null, 7, { code: '541512', notes: 'private' }], registrations: [null], siteContent: { intro: 'Visible', privateNote: 'Hidden' } });
  assert.deepEqual(result.profile.services, ['AI consulting']);
  assert.equal(result.codes.length, 1); assert.equal(result.codes[0].code, '541512');
  assert.deepEqual(result.registrations, []); assert.deepEqual(result.siteContent, { intro: 'Visible' });
});
test('public endpoint never exposes stored inquiries', async () => {
  const data = initialWorkspace(); data.inquiries = [{ scope: 'secret inquiry' }];
  await writeWorkspace(data, 0);
  const response = await site.GET(); assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes('secret inquiry'));
});
test('public intake appends and preserves owner data', async () => {
  const data = initialWorkspace(); data.profile.owner = 'Owner only';
  await writeWorkspace(data, 0);
  assert.equal((await inquiries.POST(request('/api/inquiries', 'POST', inquiry))).status, 201);
  const stored = await readWorkspace();
  assert.equal(stored.data.profile.owner, 'Owner only'); assert.equal(stored.data.inquiries.length, 1);
  assert.equal(stored.data.inquiries[0].scope, inquiry.scope); assert.equal(stored.revision, 2);
});
test('honeypot returns success without storing a request', async () => {
  assert.equal((await inquiries.POST(request('/api/inquiries', 'POST', { ...inquiry, website: 'bot' }))).status, 201);
  assert.equal((await readWorkspace()).revision, 0);
});
test('invalid public intake returns 400 without writing', async () => {
  for (const body of [null, [], {}, { ...inquiry, email: 'bad' }, { ...inquiry, kind: 'unexpected' }]) {
    assert.equal((await inquiries.POST(request('/api/inquiries', 'POST', body))).status, 400);
  }
  assert.equal((await readWorkspace()).revision, 0);
});
test('intake accepts five requests per client then rejects the sixth', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await inquiries.POST(request('/api/inquiries', 'POST', inquiry))).status, 201);
  assert.equal((await inquiries.POST(request('/api/inquiries', 'POST', inquiry))).status, 429);
  assert.equal((await readWorkspace()).data.inquiries.length, 5);
});
test('database outage fails closed for login and intake', async () => {
  delete env.DB;
  assert.equal((await session.POST(request('/api/auth/session', 'POST', { token }))).status, 503);
  assert.equal((await inquiries.POST(request('/api/inquiries', 'POST', inquiry))).status, 503);
});
test('rate windows reset and persist only hashed client identity', async () => {
  const limit = { ...LIMITS.inquiry, max: 1 };
  assert.equal((await consume(limit, 'test-client-ip')).allowed, true);
  assert.equal((await consume(limit, 'test-client-ip')).allowed, false);
  const row = await db.prepare('SELECT key FROM rate_limits').first();
  assert.ok(!row.key.includes('test-client-ip'));
  await db.prepare('UPDATE rate_limits SET window_start=0').run();
  assert.equal((await consume(limit, 'test-client-ip')).allowed, true);
});
test('streamed body cap counts UTF-8 bytes rather than characters', async () => {
  assert.equal(await readJson(new Request(origin, { method: 'POST', body: JSON.stringify('éé') }), 5), 'too_large');
  assert.equal(await readJson(new Request(origin, { method: 'POST', body: '"abc"' }), 5), 'abc');
});
test('oversize stream is cancelled without reading the rest', async () => {
  let pulled = 0, cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { pulled++; controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const req = new Request(origin, { method: 'POST', body: stream, duplex: 'half' });
  assert.equal(await readJson(req, 10), 'too_large'); assert.equal(pulled, 2); assert.equal(cancelled, true);
});
test('malformed JSON and invalid UTF-8 are rejected', async () => {
  for (const body of ['{', new Uint8Array([255])]) assert.equal(await readJson(new Request(origin, { method: 'POST', body }), 20), null);
});
test('workspace write rejects malformed JSON and oversize payloads', async () => {
  assert.equal((await workspace.PUT(new Request(origin + '/api/workspace', { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: '{' }))).status, 400);
  assert.equal((await workspace.PUT(ownerRequest('PUT', { data: 'x'.repeat(700001), revision: 0 }))).status, 413);
  assert.equal((await readWorkspace()).revision, 0);
});
test('public intake returns 413 for oversize bodies', async () => {
  assert.equal((await inquiries.POST(request('/api/inquiries', 'POST', { ...inquiry, scope: 'é'.repeat(9000) }))).status, 413);
});

for (const kind of INQUIRY_KINDS) {
  test(`public form request type persists: ${kind}`, async () => {
    const response = await inquiries.POST(request('/api/inquiries', 'POST', { ...inquiry, kind, sector: 'Education & learning' }));
    assert.equal(response.status, 201);
    const stored = await readWorkspace();
    assert.equal(stored.data.inquiries[0].kind, kind);
    assert.equal(stored.data.inquiries[0].sector, 'Education & learning');
  });
}
