#!/usr/bin/env node
// Writes dist/server/wrangler.staging.json from the built Worker config for an ISOLATED
// Cloudflare token-mode staging deployment. Never writes secrets; never deploys.
//   STAGING_CLOUDFLARE_ACCOUNT_ID=<32-hex account id> STAGING_WORKER_NAME=eduradius-staging \
//   STAGING_D1_DATABASE_NAME=eduradius-staging STAGING_D1_DATABASE_ID=<uuid from `wrangler d1 create`> \
//   STAGING_CONFIRM_TARGET=<account id>/<worker name>/<database name>/<database id> node scripts/staging-config.mjs
// Refuses: missing values, names without "staging", the local placeholder database, anything in
// scripts/production-identity.json, a confirmation that is not the exact complete target, and a
// missing build.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const stop = msg => { console.error(`Refusing: ${msg}`); process.exit(2); };
const production = JSON.parse(readFileSync(new URL('./production-identity.json', import.meta.url), 'utf8'));
const account = process.env.STAGING_CLOUDFLARE_ACCOUNT_ID ?? '', name = process.env.STAGING_WORKER_NAME ?? '';
const dbName = process.env.STAGING_D1_DATABASE_NAME ?? '', dbId = process.env.STAGING_D1_DATABASE_ID ?? '', confirm = process.env.STAGING_CONFIRM_TARGET ?? '';
const missing = Object.entries({ STAGING_CLOUDFLARE_ACCOUNT_ID: account, STAGING_WORKER_NAME: name, STAGING_D1_DATABASE_NAME: dbName, STAGING_D1_DATABASE_ID: dbId, STAGING_CONFIRM_TARGET: confirm }).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) stop(`set ${missing.join(', ')}.`);
if (!/^[0-9a-f]{32}$/.test(account)) stop('STAGING_CLOUDFLARE_ACCOUNT_ID must be the 32-character hexadecimal account id.');
if (!/staging/.test(name) || !/^[a-z0-9-]{1,63}$/.test(name)) stop('STAGING_WORKER_NAME must be a valid Worker name containing "staging".');
if (!/staging/.test(dbName)) stop('STAGING_D1_DATABASE_NAME must contain "staging".');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(dbId)) stop('STAGING_D1_DATABASE_ID must be a database UUID.');
if (production.workerNames.includes(name) || production.d1DatabaseNames.includes(dbName) || production.d1DatabaseIds.includes(dbId)) stop('the target matches a production or placeholder identifier.');
const target = `${account}/${name}/${dbName}/${dbId}`;
if (confirm !== target) stop('STAGING_CONFIRM_TARGET must repeat the complete target exactly: <account id>/<worker name>/<database name>/<database id>.');
if (!existsSync('dist/server/wrangler.json')) stop('dist/server/wrangler.json is missing; build the candidate first (BUILD_COMMIT=<sha> pnpm build).');

const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
const staging = {
  ...config,
  account_id: account, name, topLevelName: name,
  d1_databases: [{ binding: 'DB', database_name: dbName, database_id: dbId }],
  r2_buckets: [], // no private storage is used by this release
  vars: { WORKSPACE_AUTH_MODE: 'token' }, // the token itself is a secret: `wrangler secret put WORKSPACE_ACCESS_TOKEN`
  workers_dev: true, routes: [],
};
delete staging.dev;
writeFileSync('dist/server/wrangler.staging.json', JSON.stringify(staging, null, 2));
console.log(`Wrote dist/server/wrangler.staging.json for ${target} (token mode). No secrets were written.`);
