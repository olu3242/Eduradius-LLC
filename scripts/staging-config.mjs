#!/usr/bin/env node
// Writes dist/server/wrangler.staging.json from the built Worker config for an ISOLATED
// staging deployment. Guards against targeting production; never writes secrets.
//   STAGING_WORKER_NAME=eduradius-staging STAGING_D1_DATABASE_NAME=eduradius-staging \
//   STAGING_D1_DATABASE_ID=<uuid from `wrangler d1 create`> node scripts/staging-config.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const name = process.env.STAGING_WORKER_NAME ?? '';
const dbName = process.env.STAGING_D1_DATABASE_NAME ?? '';
const dbId = process.env.STAGING_D1_DATABASE_ID ?? '';
const stop = msg => { console.error(`Refusing: ${msg}`); process.exit(2); };
if (!/staging/.test(name)) stop('STAGING_WORKER_NAME must contain "staging" so it cannot be the production Worker.');
if (!/staging/.test(dbName)) stop('STAGING_D1_DATABASE_NAME must contain "staging".');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(dbId) || dbId === '00000000-0000-4000-8000-000000000000') stop('STAGING_D1_DATABASE_ID must be the real staging database UUID.');

const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
const staging = {
  ...config,
  name, topLevelName: name,
  d1_databases: [{ binding: 'DB', database_name: dbName, database_id: dbId }],
  r2_buckets: [], // no private storage is used by this release
  vars: { WORKSPACE_AUTH_MODE: 'token' }, // the token itself is a secret: `wrangler secret put WORKSPACE_ACCESS_TOKEN`
  workers_dev: true, routes: [],
};
delete staging.dev;
writeFileSync('dist/server/wrangler.staging.json', JSON.stringify(staging, null, 2));
console.log(`Wrote dist/server/wrangler.staging.json for Worker "${name}" with D1 "${dbName}". No secrets were written.`);
