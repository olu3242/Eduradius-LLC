#!/usr/bin/env node
// Configuration preflight. Reports missing or invalid settings by NAME only; it never
// prints, logs or writes configuration values.
//
//   node scripts/preflight.mjs --target local|staging|production [--env-file path]
//
// Values come from the process environment, optionally overlaid by a KEY=value file such
// as dist/server/.dev.vars. Exit code 1 when a required setting is missing or invalid.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const target = option('--target') ?? 'local';
const envFile = option('--env-file');
if (!['local', 'staging', 'production'].includes(target)) { console.error('Usage: --target local|staging|production [--env-file path]'); process.exit(2); }

const env = { ...process.env };
if (envFile) {
  if (!existsSync(envFile)) { console.error(`Env file not found: ${envFile}`); process.exit(2); }
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"`])(.*)\1$/, '$2');
  }
}

const results = [];
const report = (level, message) => results.push({ level, message });
const present = name => typeof env[name] === 'string' && env[name].trim() !== '';
const PLACEHOLDER = /(replace|example|changeme|placeholder|your[-_ ]?|xxx|<|>)/i;

// ── Authentication ──────────────────────────────────────────────────────────
const mode = (env.WORKSPACE_AUTH_MODE ?? '').trim().toLowerCase();
if (!mode) {
  if (target === 'local') report('info', 'WORKSPACE_AUTH_MODE is unset: the dev server uses loopback mock sign-in; a built Worker (pnpm start) will deny owner access.');
  else report('error', 'WORKSPACE_AUTH_MODE is missing (expected "sites" or "token"). Built Workers deny all owner access without it.');
} else if (mode === 'sites') {
  const ids = present('WORKSPACE_OWNER_IDS'), emails = present('WORKSPACE_OWNER_EMAILS');
  if (!ids && !emails) report(target === 'local' ? 'warn' : 'error', 'sites mode needs WORKSPACE_OWNER_IDS or WORKSPACE_OWNER_EMAILS (both missing).');
  else report('ok', `sites mode owner allowlist set (${[ids && 'WORKSPACE_OWNER_IDS', emails && 'WORKSPACE_OWNER_EMAILS'].filter(Boolean).join(', ')}).`);
  report('info', 'sites mode trusts oai-authenticated-user-* headers: deploy only behind the Sites dispatch. Use token mode on any other host.');
  if (present('WORKSPACE_ACCESS_TOKEN')) report('warn', 'WORKSPACE_ACCESS_TOKEN is set but unused in sites mode; remove it from this environment.');
} else if (mode === 'token') {
  if (!present('WORKSPACE_ACCESS_TOKEN')) report('error', 'token mode needs WORKSPACE_ACCESS_TOKEN (missing).');
  else if (env.WORKSPACE_ACCESS_TOKEN.length < 32) report('error', 'WORKSPACE_ACCESS_TOKEN is shorter than 32 characters.');
  else if (PLACEHOLDER.test(env.WORKSPACE_ACCESS_TOKEN)) report('error', 'WORKSPACE_ACCESS_TOKEN looks like a placeholder; generate one with `openssl rand -base64 32`.');
  else report('ok', 'WORKSPACE_ACCESS_TOKEN is set and at least 32 characters.');
  if (present('WORKSPACE_OWNER_IDS') || present('WORKSPACE_OWNER_EMAILS')) report('warn', 'Owner allowlists are ignored in token mode.');
} else report('error', 'WORKSPACE_AUTH_MODE has an unsupported value (expected "sites" or "token").');

// ── Bindings and migrations ─────────────────────────────────────────────────
try {
  const hosting = JSON.parse(readFileSync('.openai/hosting.json', 'utf8'));
  if (hosting.d1 === 'DB') report('ok', '.openai/hosting.json declares the D1 binding DB.');
  else report('error', '.openai/hosting.json must declare "d1": "DB".');
} catch { report('error', '.openai/hosting.json is missing or invalid.'); }
const migrations = readdirSync('drizzle').filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
const numbers = migrations.map(f => Number(f.slice(0, 4)));
if (numbers.some((n, i) => n !== i)) report('error', `Migration numbering has gaps or duplicates: ${migrations.join(', ')}`);
else report('ok', `Apply migrations in order: ${migrations.join(' → ')}`);

// ── Secret hygiene ──────────────────────────────────────────────────────────
try {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
  const leaked = tracked.filter(f => /(^|\/)(\.dev\.vars|\.env)(\.|$)/.test(f) || /\.pem$/.test(f));
  if (leaked.length) report('error', `Secret-bearing files are tracked by git: ${leaked.join(', ')}`);
  else report('ok', 'No .env, .dev.vars or .pem files are tracked by git.');
} catch { report('warn', 'Could not run git ls-files; secret-file check skipped.'); }
if (target !== 'local' && existsSync('dist/server/.dev.vars')) report('warn', 'dist/server/.dev.vars exists (local-only secrets). Build release artifacts from a clean checkout.');
if (target === 'production') report('info', 'Production: confirm a verified backup (docs/OPERATIONS.md) and a passed staging acceptance run before migrating.');

// ── Output (names and checks only) ──────────────────────────────────────────
const icon = { ok: 'OK   ', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };
console.log(`EduRadius preflight — target: ${target}${envFile ? ` (overlay: ${envFile})` : ''}`);
for (const r of results) console.log(`${icon[r.level]} ${r.message}`);
const errors = results.filter(r => r.level === 'error').length;
console.log(errors ? `\n${errors} blocking issue(s).` : '\nNo blocking issues.');
process.exit(errors ? 1 : 0);
