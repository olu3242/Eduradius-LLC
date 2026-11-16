// Runs a browser journey repeatedly against a LOCAL dev server and records EVERY attempt.
// Local only; destroys and recreates .wrangler/state in --mode clean.
//   node tests/browser/run-series.mjs --suite contracting --runs 5 --mode clean|repeated [--out outputs/browser-series/<name>]
//
// clean    : before each attempt, stop the dev server, rebuild the local D1 (legacy document) and restart.
// repeated : one database and server for all attempts (each attempt uses its own synthetic labels).
// Each attempt keeps: suite stdout/stderr, exit code/signal, duration, the dev-server log written
// during the attempt, and on failure the suite's diag.json and Playwright traces (DIAG_DIR).
// summary.json is appended after every attempt and never rewritten from scratch, so retries
// cannot erase earlier failures.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2), at = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const SUITES = { contracting: 'tests/browser/contracting-journey.mjs', journey: 'tests/browser/journey.mjs', pagination: 'tests/browser/pagination-ui.mjs' };
const suite = at('--suite', 'contracting'), runs = Number(at('--runs', '3')), mode = at('--mode', 'clean');
if (!SUITES[suite] || !['clean', 'repeated'].includes(mode) || !(runs >= 1 && runs <= 20)) { console.error('Usage: --suite contracting|journey|pagination --runs 1..20 --mode clean|repeated'); process.exit(1); }
const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const out = resolve(at('--out', join(ROOT, 'outputs', 'browser-series', `${suite}-${mode}-${new Date().toISOString().replace(/[:.]/g, '')}`)));
mkdirSync(out, { recursive: true });
const serverLog = join(out, 'dev-server.log');
const BASE = 'http://127.0.0.1:5173';
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0;

let server = null; // { proc, exit } — exit state is tracked per process
const serverExited = () => server?.exit ?? null;
async function health() { try { const r = await fetch(BASE + '/api/health'); return r.ok ? (await r.json()).build : null; } catch { return null; } }
async function startServer() {
  const fd = openSync(serverLog, 'a');
  const current = { proc: spawn('pnpm', ['dev'], { cwd: ROOT, stdio: ['ignore', fd, fd], detached: true }), exit: null };
  current.proc.on('exit', (code, signal) => { current.exit = { code, signal, at: new Date().toISOString() }; });
  server = current;
  for (let i = 0; i < 90; i++) { const b = await health(); if (b) return b; if (current.exit) break; await new Promise(r => setTimeout(r, 1000)); }
  throw new Error(`dev server did not become healthy (exit: ${JSON.stringify(current.exit)})`);
}
async function stopServer() {
  if (server && !server.exit) { try { process.kill(-server.proc.pid, 'SIGTERM'); } catch { /* gone */ } }
  spawnSync('pkill', ['-f', 'run-framework.mjs dev']);
  server = null;
  for (let i = 0; i < 30 && (await health()); i++) await new Promise(r => setTimeout(r, 500)); // wait until the port is free
}
function resetDatabase() {
  const r = spawnSync('bash', ['scripts/perf/fresh-local-state.sh', '--legacy'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('local database reset failed: ' + r.stderr.slice(-300));
}
const logSize = () => (existsSync(serverLog) ? statSync(serverLog).size : 0);
function logSince(offset) {
  const size = logSize(); if (size <= offset) return '';
  const fd = openSync(serverLog, 'r'), buf = Buffer.alloc(size - offset); readSync(fd, buf, 0, buf.length, offset); closeSync(fd);
  return buf.toString('utf8');
}
const SERVER_ERROR = /workflow\.error|http\.error|http\.exception|Your worker restarted|Uncaught|ERR_|EADDRINUSE|out of memory|Internal server error/i;

const summary = { suite, mode, runs, commit, dirtyTree: dirty, node: process.version, startedAt: new Date().toISOString(), attempts: [] };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(`series ${suite} ${mode} x${runs} on ${commit.slice(0, 12)}${dirty ? ' (dirty tree)' : ''} → ${out}`);
if (mode === 'repeated') { await stopServer(); resetDatabase(); summary.build = await startServer(); }
for (let n = 1; n <= runs; n++) {
  const dir = join(out, `attempt-${String(n).padStart(2, '0')}`); mkdirSync(dir, { recursive: true });
  let build = null, setupError = null;
  try { if (mode === 'clean') { await stopServer(); resetDatabase(); build = await startServer(); } else build = await health(); }
  catch (e) { setupError = String(e.message); }
  const offset = logSize(), started = Date.now();
  let result = { code: null, signal: null };
  if (!setupError) {
    result = await new Promise(res => {
      const child = spawn(process.execPath, [SUITES[suite]], { cwd: ROOT, env: { ...process.env, BASE, DIAG_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
      child.on('exit', (code, signal) => { writeFileSync(join(dir, 'stdout.txt'), stdout); writeFileSync(join(dir, 'stderr.txt'), stderr); res({ code, signal, stdout, stderr }); });
    });
  }
  const serverText = logSince(offset);
  writeFileSync(join(dir, 'dev-server.log'), serverText);
  const serverErrors = serverText.split('\n').filter(l => SERVER_ERROR.test(l)).slice(0, 20).map(l => l.slice(0, 300));
  const diag = existsSync(join(dir, 'diag.json')) ? JSON.parse(readFileSync(join(dir, 'diag.json'), 'utf8')) : null;
  const summaryLine = (result.stdout ?? '').trim().split('\n').pop() ?? '';
  const classification = setupError ? 'setup-failure'
    : serverExited() ? 'server-exit'
    : result.signal ? `suite-killed-${result.signal}`
    : result.code === 0 ? 'pass'
    : result.code === 3 ? (serverErrors.length || diag?.serverErrors?.length ? 'abort-with-server-errors' : 'abort')
    : result.code === 1 ? 'failed-checks'
    : /browserType\.launch|Target page, context or browser has been closed|Browser closed/i.test(result.stderr ?? '') ? 'browser-exit'
    : `exit-${result.code}`;
  const attempt = { n, startedAt: new Date(started).toISOString(), ms: Date.now() - started, build, classification, exitCode: result.code, signal: result.signal, summary: summaryLine.slice(0, 200), setupError,
    failingStep: diag ? { lastPassed: diag.lastPassed, firstFailedCheck: diag.firstFailedCheck, error: diag.error } : null, serverErrors, serverExit: serverExited() };
  summary.attempts.push(attempt);
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  appendFileSync(join(out, 'attempts.log'), JSON.stringify(attempt) + '\n');
  console.log(`attempt ${n}: ${classification} (${attempt.ms} ms) ${summaryLine.slice(0, 80)}${diag?.error ? ' — ' + diag.error.message : ''}`);
}
await stopServer();
summary.endedAt = new Date().toISOString();
summary.totals = summary.attempts.reduce((acc, a) => ({ ...acc, [a.classification]: (acc[a.classification] ?? 0) + 1 }), {});
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
console.log('totals', JSON.stringify(summary.totals));
process.exit(summary.attempts.every(a => a.classification === 'pass') ? 0 : 1);
