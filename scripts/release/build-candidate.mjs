// Builds a release candidate from a CLEAN checkout of a commit and records a manifest.
//   node scripts/release/build-candidate.mjs <commit> [--out outputs/release]
// Steps: detached git worktree of <commit> in a temporary directory → pnpm install --frozen-lockfile
// → BUILD_COMMIT=<commit> pnpm build → checks (embedded build identity, no local configuration or
// credentials in the artifact) → deterministic archive of dist/ (sorted, fixed mtime/owner, gzip -n)
// → SHA-256 → manifest.json. Output stays under the git-ignored outputs/ directory; nothing is deployed.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const args = process.argv.slice(2), at = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed (${r.status}): ${(r.stderr || r.stdout).slice(-800)}`);
  return r.stdout.trim();
};
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const commit = run('git', ['rev-parse', '--verify', `${args[0] ?? 'HEAD'}^{commit}`], { cwd: ROOT });
const short = commit.slice(0, 12);
const outDir = resolve(ROOT, at('--out', 'outputs/release'), short);
mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), `eduradius-candidate-${short}-`));
const src = join(work, 'src');
console.log(`candidate ${commit} → clean checkout ${src}`);
run('git', ['worktree', 'add', '--detach', src, commit], { cwd: ROOT });
try {
  const env = { ...process.env, BUILD_COMMIT: commit, CI: '1' };
  delete env.WORKSPACE_ACCESS_TOKEN; delete env.CLOUDFLARE_API_TOKEN;
  // Reuse the local package store (content-addressed; the lockfile still decides every version).
  run('pnpm', ['install', '--frozen-lockfile', '--store-dir', join(ROOT, '.sites-runtime/pnpm-store')], { cwd: src, env });
  run('pnpm', ['build'], { cwd: src, env });
  const dist = join(src, 'dist');
  const files = [];
  const walk = d => { for (const name of readdirSync(d)) { const p = join(d, name); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(dist);
  // Checks: build identity and absence of local configuration / credentials.
  const identity = files.some(f => f.includes('/dist/server/') && f.endsWith('.js') && readFileSync(f, 'utf8').includes(short));
  const forbiddenNames = files.filter(f => /(^|\/)(\.dev\.vars[^/]*|\.env[^/]*|[^/]*\.pem)$/.test(f)).map(f => relative(dist, f));
  const patterns = [/WORKSPACE_ACCESS_TOKEN\s*=\s*\S{16,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /Bearer [A-Za-z0-9._~+/=-]{32,}/, /test-only-access-key-with-at-least-32-characters/, /perf-seed-only-access-key/, /CLOUDFLARE_API_TOKEN\s*=\s*\S+/];
  const secretHits = [];
  for (const f of files) { if (statSync(f).size > 20 * 1024 * 1024) continue; const text = readFileSync(f, 'utf8'); for (const p of patterns) if (p.test(text)) secretHits.push(`${relative(dist, f)}: ${p.source.slice(0, 30)}`); }
  const absolutePaths = files.filter(f => f.endsWith('.map') && readFileSync(f, 'utf8').includes(src)).map(f => relative(dist, f));
  const archive = join(outDir, `eduradius-${short}-dist.tar.gz`);
  run('bash', ['-c', `tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -cf - -C ${JSON.stringify(dist)} . | gzip -n -9 > ${JSON.stringify(archive)}`]);
  const archiveSha = sha256(readFileSync(archive));
  // Archive first, then serve: wrangler dev may write local state next to the config.
  // Serve the built Worker locally (empty local state, no configuration) and read the identity it reports.
  const served = await (async () => {
    const state = join(work, 'state'), port = 8792 + Math.floor(Math.random() * 100);
    const child = spawn(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'], { cwd: src, env, stdio: 'ignore', detached: true });
    try {
      for (let i = 0; i < 90; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return (await r.json()).build; } catch { /* starting */ } await new Promise(r => setTimeout(r, 1000)); }
      return null;
    } finally { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } }
  })();
  const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
  const migrations = readdirSync(join(src, 'drizzle')).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort().map(f => ({ file: f, sha256: sha256(readFileSync(join(src, 'drizzle', f))) }));
  const manifest = {
    candidate: commit, buildIdentity: short, builtAt: new Date().toISOString(),
    source: { cleanCheckout: true, lockfileSha256: sha256(readFileSync(join(src, 'pnpm-lock.yaml'))), packageManager: pkg.packageManager },
    toolchain: { node: process.version, pnpm: run('pnpm', ['--version'], { cwd: src }), wrangler: JSON.parse(readFileSync(join(src, 'node_modules/wrangler/package.json'), 'utf8')).version, vinext: JSON.parse(readFileSync(join(src, 'node_modules/vinext/package.json'), 'utf8')).version, platform: `${process.platform}-${process.arch}` },
    artifact: { file: relative(ROOT, archive), sha256: archiveSha, bytes: statSync(archive).size, files: files.length, sourceMaps: files.filter(f => f.endsWith('.map')).length, uncompressedBytes: files.reduce((a, f) => a + statSync(f).size, 0) },
    checks: { buildIdentityEmbedded: identity, servedBuildIdentity: served, servedMatchesCandidate: served === short, localConfigurationFiles: forbiddenNames, credentialPatterns: secretHits, sourceMapsWithAbsoluteBuildPath: absolutePaths },
    migrations,
    reproducibility: {
      bitForBit: false,
      reason: 'vinext generates per-build random values: preview-mode credentials, the Server Actions encryption key (unless NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is set) and the RSC build identity; they change chunk hashes. BUILD_ID is the commit (next.config.ts).',
      policy: 'Build once from a clean checkout, record this checksum, and deploy exactly this archive. Never rebuild for production.',
      sensitivity: 'The archive embeds those framework keys: store it privately; do not attach it to public tickets.',
    },
  };
  manifest.checks.passed = identity && served === short && !forbiddenNames.length && !secretHits.length;
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(outDir, 'SHA256SUMS'), `${archiveSha}  ${relative(outDir, archive)}\n`);
  console.log(JSON.stringify({ candidate: commit, archive: manifest.artifact.file, sha256: archiveSha, checks: manifest.checks }, null, 1));
  if (!manifest.checks.passed) process.exitCode = 2;
} finally {
  spawnSync('git', ['worktree', 'remove', '--force', src], { cwd: ROOT });
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}
