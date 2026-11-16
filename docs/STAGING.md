# Isolated staging: preparation and certification

**Operator checklist for the current candidate: [STAGING_HANDOFF.md](STAGING_HANDOFF.md)** (candidate SHA, archive checksum, routes, permissions, acceptance tests, evidence).

**Status: prepared, not deployed.** No explicitly authorized, isolated staging target exists for this repository. This session has no Cloudflare account, API token or staging Site, and the only hosted deployment is the live Site, which must not be used as staging. Nothing in this document has been run against a hosted environment.

## Isolation requirements

| Item | Staging must have | Production (existing Site) |
| --- | --- | --- |
| Application identity / URL | Its own Worker name containing `staging` (e.g. `eduradius-staging`) and its own URL | `eduradius-contract-workspace.olufemi-adey-1577.chatgpt.site` |
| Database | Its own D1 database (name containing `staging`) | Sites-managed D1 |
| File storage | None (this release stores no files) | None |
| Authentication | `WORKSPACE_AUTH_MODE=token` with a staging-only `WORKSPACE_ACCESS_TOKEN` secret; or an isolated Site in `sites` mode with a staging owner allowlist | `sites` mode (to be configured) |
| Secrets | Generated for staging only; never copied from production | Separate |
| Records | Synthetic only (`SYNTHETIC-STAGING-…` labels); no production data | Real |

Guards in the tooling:

- `scripts/staging-config.mjs`:
  - requires the account id, the Worker and database names (containing `staging`), the database UUID, and `STAGING_CONFIRM_TARGET=<account>/<worker>/<database name>/<database id>` exactly;
  - refuses identifiers listed in `scripts/production-identity.json` and the local placeholder database;
  - fails without a build, and never writes secrets.
- `scripts/staging-certify.mjs`:
  - refuses the production host and any host not typed exactly in `STAGING_CONFIRM_HOST`;
  - requires HTTPS for non-local targets and `--expect-build <sha>`;
  - checks liveness, the deployed build and readiness **before** creating any record, and exits 2 without writing if any fails;
  - never prints the token.
- Both are tested against local fixtures and a mock server (`tests/staging-tools.test.mjs`).

## What the owner must provide (blocking)

1. Authorization to create a staging Worker and D1 database in a named Cloudflare account. Workers and D1 can incur usage charges; confirm the plan before provisioning.
2. A Cloudflare API token scoped to that account (Workers Scripts: Edit, D1: Edit), stored in the operator's secret store and **not** in this repository.
3. **Or**, for Sites-native staging: an isolated, non-production Site with its own D1, its runtime variables, and a staging owner account for testing Sign in with ChatGPT.

## Deployment (Cloudflare Workers, token mode)

Confirm the target account and names before every command.

```sh
# Use the recorded candidate archive (STAGING_HANDOFF.md §1, §9); do not rebuild.
git checkout <candidate commit SHA> && rm -rf dist && mkdir dist && tar -xzf <archive> -C dist
npx wrangler d1 create eduradius-staging        # once; note the database_id
STAGING_CLOUDFLARE_ACCOUNT_ID=<account id> STAGING_WORKER_NAME=eduradius-staging STAGING_D1_DATABASE_NAME=eduradius-staging \
  STAGING_D1_DATABASE_ID=<database_id> STAGING_CONFIRM_TARGET=<account id>/eduradius-staging/eduradius-staging/<database_id> \
  node scripts/staging-config.mjs
npx wrangler deploy --dry-run --config dist/server/wrangler.staging.json   # review bindings
```

Back up the database before migrating (staging starts empty, but rehearse the procedure):

```sh
npx wrangler d1 export eduradius-staging --remote --output staging-before-$BUILD_COMMIT.sql
```

Inspect the database, apply exactly the files the status check lists (all of 0000–0008 for a new, empty database), confirm, then set the secret and deploy:

```sh
npx wrangler d1 execute eduradius-staging --remote --json --config dist/server/wrangler.staging.json --command "$(node scripts/migration-status.mjs --print-query)" > schema.json
node scripts/migration-status.mjs --wrangler-json schema.json --empty-database-ok   # lists the files to apply
for f in <files listed above>; do npx wrangler d1 execute eduradius-staging --remote --config dist/server/wrangler.staging.json --file "drizzle/$f"; done
# re-run the two status commands and expect: Up to date
npx wrangler secret put WORKSPACE_ACCESS_TOKEN --config dist/server/wrangler.staging.json   # paste a fresh 32+ char value
npx wrangler deploy --config dist/server/wrangler.staging.json
```

Verify the deployed build matches the candidate:

```sh
curl -s https://<staging-host>/api/health        # "build" must equal the first 12 characters of $BUILD_COMMIT
curl -s https://<staging-host>/api/health/ready  # 200 with database, schema and access all ok
```

## Certification

```sh
STAGING_BASE_URL=https://<staging-host> STAGING_CONFIRM_HOST=<staging-host> \
  STAGING_ACCESS_TOKEN=<from secret store> node scripts/staging-certify.mjs --expect-build "$BUILD_COMMIT"
BASE=https://<staging-host> node tests/browser/contracting-journey.mjs   # needs token sign-in adaptation; see below
```

`staging-certify.mjs` checks 48 things through HTTP:

- **Health:** liveness, readiness and build identity.
- **Access boundaries:** anonymous access, forged Sites headers, invalid bearer and tampered cookie are all denied on private routes; cross-origin and anonymous writes are rejected.
- **Public intake:** internal fields are rejected and the response makes no email claim.
- **Owner journey:** review, stale-version and invalid-transition rejection, qualification, concurrent conversion, requirement rules, proposal review and revision, the submission-before-approval guard, award with evidence, the project-before-award guard, concurrent project creation, client acceptance rules, an approved change, the closeout guard and completion, and a private experience record.
- **Persistence and exposure:** records persist across a new session, and the public site excludes them.
- **Bounded reads:** lists return bounded pages with a working cursor, invalid limits and cursors are rejected, reports are computed on the server, and the export manifest matches every collection. The access-boundary checks also cover `/api/records/inquiry` and `/api/export`.

The browser journeys use the loopback mock sign-in and run only against a local dev server. On a token-mode staging host, sign in through the workspace dialog. On an isolated Site, use Sign in with ChatGPT; the browser steps are otherwise unchanged.

## Local rehearsal (performed)

**Candidate `6ba656c`, exact archive.** The run used the extracted candidate archive (SHA-256 `bb6449e7…c022`, verified), served by `wrangler dev`, with a fresh database migrated 0000–0008 and token mode:

- certification **48/48**; build `6ba656ccabc2` matched;
- no token or synthetic email in the output or the Worker log;
- `staging-config` with a complete target confirmation, then `wrangler deploy --dry-run`: 1,411.76 KiB (404.64 KiB gzipped), bindings `DB` and `WORKSPACE_AUTH_MODE=token`.

This is a rehearsal, **not hosted certification**.


**Candidate `af555c9` (historical).** The run used the **built Worker** (`wrangler dev` on the production bundle), a database freshly migrated with 0000–0007, token mode and a throwaway local token:

- the certification script passed **48/48**;
- the reported build `af555c9e97bd` matched the candidate;
- the token and the synthetic contact email appeared in neither the output nor the Worker log.

A generated staging config passed `wrangler deploy --dry-run`: 1,185.38 KiB upload (329.46 KiB gzipped), with bindings `DB` (staging D1) and `WORKSPACE_AUTH_MODE=token`. This is a rehearsal, **not hosted certification**.

**Previous candidate `36ce7a1` (historical).** Against the **built Worker** (`wrangler dev` on the production bundle) with a freshly migrated database (0000–0006) and token mode, the certification script passed 36/36. Its output and the Worker logs contained neither the token nor the synthetic contact details. The staging config was generated and passed `wrangler deploy --dry-run`: 1,137 KiB upload (316 KiB gzipped), with bindings `DB` (staging D1) and `WORKSPACE_AUTH_MODE=token`. This is a rehearsal, **not hosted certification**.

## Teardown

```sh
npx wrangler delete --config dist/server/wrangler.staging.json
npx wrangler d1 delete eduradius-staging
```

Run teardown only after confirming the target. Synthetic staging records are disposable.
