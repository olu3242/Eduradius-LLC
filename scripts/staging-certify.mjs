#!/usr/bin/env node
// HTTP-level certification of an ISOLATED staging deployment (token mode).
// Writes clearly labelled synthetic records. Never run it against production.
//
//   STAGING_BASE_URL=https://<staging-host> \
//   STAGING_CONFIRM_HOST=<staging-host> \
//   STAGING_ACCESS_TOKEN=<staging token from your secret store> \
//   node scripts/staging-certify.mjs [--expect-build <commit>]
//
// Guards: refuses the production Site host and any host not typed exactly in
// STAGING_CONFIRM_HOST; the token is never printed; output is a JSON summary.
const PRODUCTION_HOSTS = ['eduradius-contract-workspace.olufemi-adey-1577.chatgpt.site'];
const base = process.env.STAGING_BASE_URL?.replace(/\/$/, '');
const confirm = process.env.STAGING_CONFIRM_HOST;
const token = process.env.STAGING_ACCESS_TOKEN;
const expectBuild = process.argv.includes('--expect-build') ? process.argv[process.argv.indexOf('--expect-build') + 1] : null;
const fail = msg => { console.error(`Refusing to run: ${msg}`); process.exit(2); };
if (!base || !confirm || !token) fail('set STAGING_BASE_URL, STAGING_CONFIRM_HOST and STAGING_ACCESS_TOKEN.');
const host = new URL(base).hostname;
if (PRODUCTION_HOSTS.includes(host)) fail('the target is the production Site.');
if (host !== confirm) fail('STAGING_CONFIRM_HOST must exactly match the target hostname.');
if (new URL(base).protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(host)) fail('staging must use https.');

const RUN = 'SYNTHETIC-STAGING-' + new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const results = [];
const record = (name, pass, detail = '') => results.push({ name, result: pass ? 'pass' : 'fail', detail });
let cookie = '';
async function call(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const res = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth && cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json, requestId: res.headers.get('x-request-id') };
}
const ok = (r, status = 200) => r.status === status;

// 1. Health and build identity
const live = await call('/api/health', { auth: false });
record('liveness', ok(live) && live.json?.status === 'ok', `build ${live.json?.build}`);
if (expectBuild) record('deployed build matches candidate', String(live.json?.build ?? '').startsWith(expectBuild.slice(0, 12)), `expected ${expectBuild}`);
const ready = await call('/api/health/ready', { auth: false });
record('readiness (database, schema, access configured)', ok(ready), JSON.stringify(ready.json?.checks));
record('responses carry a correlation id', Boolean(live.requestId));

// 2. Access boundaries (anonymous, forged identity, invalid credentials)
const privatePaths = ['/api/workspace', '/api/workflow'];
for (const path of privatePaths) {
  record(`anonymous ${path} denied`, (await call(path, { auth: false })).status === 401);
  record(`forged Sites identity headers ignored on ${path}`, (await call(path, { auth: false, headers: { 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': 'forged@example.test' } })).status === 401);
  record(`invalid bearer on ${path} denied`, (await call(path, { auth: false, headers: { authorization: 'Bearer ' + 'x'.repeat(48) } })).status === 401);
  record(`tampered session cookie on ${path} denied`, (await call(path, { auth: false, headers: { cookie: 'eduradius_ws=v1.9999999999999.AAAA.' + 'A'.repeat(43) } })).status === 401);
}
record('anonymous record write denied', (await call('/api/records/organization', { method: 'POST', auth: false, body: { record: { name: RUN } } })).status === 401);
record('cross-origin write rejected', (await call('/api/actions/organization.linkExisting', { method: 'POST', auth: false, body: {}, headers: { origin: 'https://attacker.example' } })).status === 403);

// 3. Public intake boundaries
const intake = { name: `${RUN} visitor`, organization: `${RUN} District`, email: 'synthetic-staging@example.test', sector: 'Other / to discuss', scope: `${RUN} — synthetic certification request. Not a real inquiry.`, kind: 'Project briefing' };
record('public intake rejects internal fields', (await call('/api/inquiries', { method: 'POST', auth: false, body: { ...intake, status: 'Qualified', assignee: 'x' } })).status === 400);
const submitted = await call('/api/inquiries', { method: 'POST', auth: false, body: intake });
record('public intake stores a synthetic request', ok(submitted, 201) && /No email has been sent/.test(submitted.json?.message ?? ''));

// 4. Owner session
const login = await fetch(base + '/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
record('owner sign-in issues an HttpOnly session', login.status === 200 && /HttpOnly/i.test(login.headers.get('set-cookie') ?? ''));

// 5. End-to-end journey through the API
const flow = async () => (await call('/api/workflow')).json;
let wf = await flow();
let inquiry = wf.inquiries.find(i => i.organization === intake.organization);
const patchInquiry = changes => call(`/api/inquiries/${inquiry.id}`, { method: 'PATCH', body: { version: inquiry.version, changes } });
let r = await patchInquiry({ assignee: 'Staging owner', nextAction: 'Synthetic follow-up', nextActionDue: wf.today });
inquiry = r.json?.inquiry; record('review and assign', ok(r));
record('stale version rejected', (await call(`/api/inquiries/${inquiry.id}`, { method: 'PATCH', body: { version: inquiry.version - 1, changes: { notes: 'stale' } } })).status === 409);
record('invalid transition rejected', (await patchInquiry({ status: 'Converted' })).status === 400);
r = await patchInquiry({ status: 'Qualified', reason: `${RUN} synthetic qualification` }); inquiry = r.json?.inquiry; record('qualify with reason', ok(r));
const draft = { title: `${RUN} opportunity`, agency: intake.organization, stage: 'Qualify' };
const [c1, c2] = await Promise.all([call(`/api/inquiries/${inquiry.id}/convert`, { method: 'POST', body: { version: inquiry.version, opportunity: draft } }), call(`/api/inquiries/${inquiry.id}/convert`, { method: 'POST', body: { version: inquiry.version, opportunity: draft } })]);
record('concurrent conversion creates one opportunity', [c1.status, c2.status].sort().join() === '200,201');
const opportunity = (c1.json ?? c2.json).opportunity;
const act = (name, body) => call(`/api/actions/${name}`, { method: 'POST', body });
const create = (type, rec) => call(`/api/records/${type}`, { method: 'POST', body: { record: rec, confirmDistinct: true } });
const evidence = async (title, category) => (await create('evidence', { title: `${RUN} ${title}`, category, reviewStatus: 'Verified', reviewDate: '2099-12-31', location: 'Synthetic staging reference' })).json.record;
const award = await evidence('award notice (synthetic)', 'Award'), acceptance = await evidence('acceptance (synthetic)', 'Acceptance');
let req = (await create('requirement', { opportunityId: opportunity.id, description: `${RUN} requirement` })).json.record;
record('Met without evidence is rejected', (await call(`/api/records/requirement/${req.id}`, { method: 'PATCH', body: { version: req.version, changes: { status: 'Met' } } })).status === 400);
let p = (await act('proposal.create', { opportunityId: opportunity.id, title: `${RUN} proposal` })).json.record;
const sections = { ...p.sections, executiveSummary: { body: `${RUN} synthetic summary`, basis: 'Draft text', refs: [] } };
p = (await call(`/api/records/proposal/${p.id}`, { method: 'PATCH', body: { version: p.version, changes: { sections } } })).json.record;
p = (await act('proposal.submitForReview', { id: p.id, version: p.version })).json.record;
p = (await act('proposal.requestChanges', { id: p.id, version: p.version, reason: 'Synthetic revision request' })).json.record;
p = (await act('proposal.submitForReview', { id: p.id, version: p.version })).json.record;
record('submission before approval rejected', (await act('proposal.recordSubmission', { id: p.id, version: p.version, submittedOn: wf.today, method: 'Email' })).status === 409);
p = (await act('proposal.approve', { id: p.id, version: p.version })).json.record;
const sub = (await act('proposal.recordSubmission', { id: p.id, version: p.version, submittedOn: wf.today, method: 'Email', reference: RUN })).json.record;
record('submission tied to the approved version', sub?.proposalVersionId === p.approvedVersionId);
record('project before award rejected', (await act('project.createFromAward', { submissionId: sub.id, confirm: true, title: RUN, scope: RUN })).status === 409);
const awarded = await act('submission.recordOutcome', { id: sub.id, version: sub.version, outcome: 'Awarded', outcomeDate: wf.today, awardEvidenceId: award.id, confirmAward: true });
record('award recorded with evidence', ok(awarded));
const projectBody = { submissionId: sub.id, confirm: true, title: `${RUN} project`, scope: `${RUN} synthetic scope`, deliverables: [{ title: `${RUN} deliverable` }] };
const [p1, p2] = await Promise.all([act('project.createFromAward', projectBody), act('project.createFromAward', projectBody)]);
record('concurrent project creation yields one project', [p1.status, p2.status].sort().join() === '200,201');
let project = (p1.json ?? p2.json).record;
project = (await act('project.transition', { id: project.id, version: project.version, to: 'Active' })).json.record;
wf = await flow();
let deliverable = wf.records.deliverable.find(d => d.projectId === project.id);
deliverable = (await call(`/api/records/deliverable/${deliverable.id}`, { method: 'PATCH', body: { version: deliverable.version, changes: { draftSummary: `${RUN} draft` } } })).json.record;
deliverable = (await act('deliverable.submitForReview', { id: deliverable.id, version: deliverable.version })).json.record;
record('client acceptance without evidence rejected', (await act('deliverable.accept', { id: deliverable.id, version: deliverable.version, acceptanceKind: 'Client acceptance', acceptanceAuthority: 'Synthetic' })).status === 400);
deliverable = (await act('deliverable.accept', { id: deliverable.id, version: deliverable.version, acceptanceKind: 'Client acceptance', acceptanceAuthority: 'Synthetic acceptor (test)', acceptanceEvidenceId: acceptance.id })).json.record;
record('client acceptance recorded with verified evidence', deliverable?.status === 'Accepted');
const change = (await create('changeRequest', { projectId: project.id, title: `${RUN} change`, requestedChange: 'Synthetic', reason: 'Synthetic', newScope: `${RUN} revised scope` })).json.record;
record('approved change creates a new baseline', ok(await act('changeRequest.decide', { id: change.id, version: change.version, decision: 'Approved', reason: 'Synthetic approval' })));
project = (await flow()).records.project.find(x => x.id === project.id);
project = (await act('project.transition', { id: project.id, version: project.version, to: 'Closing' })).json.record;
record('closeout blocked without prerequisites', (await act('project.closeout', { id: project.id, version: project.version })).status === 409);
const closed = await act('project.closeout', { id: project.id, version: project.version, finalAcceptanceEvidenceId: acceptance.id, lessonsLearned: 'Synthetic lesson', archiveReviewed: true });
record('closeout completes with the checklist', ok(closed));
const exp = await act('experience.createFromProject', { projectId: project.id });
record('private experience record created', ok(exp, 201) && exp.json?.record?.publicationStatus === 'Private');

// 6. Persistence (fresh session) and public exposure
cookie = (await fetch(base + '/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })).headers.get('set-cookie')?.split(';')[0] ?? '';
const reread = await flow();
record('records persist across a new session', reread.records.experience.some(e => e.projectId === project.id) && reread.records.project.find(x => x.id === project.id)?.status === 'Closed');
const publicText = JSON.stringify((await call('/api/site', { auth: false })).json);
record('public content excludes synthetic private records', !publicText.includes(RUN) && !publicText.includes('synthetic-staging@example.test'));

const failed = results.filter(x => x.result === 'fail');
console.log(JSON.stringify({ target: host, run: RUN, build: live.json?.build, passed: results.length - failed.length, total: results.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
