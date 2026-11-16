# Isolated staging: preparation and certification

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

- `scripts/staging-config.mjs` refuses unless the Worker and database names contain `staging` and the D1 ID is a real UUID (not the local placeholder). It never writes secrets.
- `scripts/staging-certify.mjs` refuses the production host, refuses any host not typed exactly in `STAGING_CONFIRM_HOST`, requires HTTPS for non-local targets, and never prints the token.

## What the owner must provide (blocking)

1. Authorization to create a staging Worker and D1 database in a named Cloudflare account. Workers and D1 can incur usage charges; confirm the plan before provisioning.
2. A Cloudflare API token scoped to that account (Workers Scripts: Edit, D1: Edit), stored in the operator's secret store and **not** in this repository.
3. **Or**, for Sites-native staging: an isolated, non-production Site with its own D1, its runtime variables, and a staging owner account for testing Sign in with ChatGPT.

## Deployment (Cloudflare Workers, token mode)

Confirm the target account and names before every command.

```sh
export BUILD_COMMIT=<candidate commit SHA>
git checkout "$BUILD_COMMIT" && pnpm install --frozen-lockfile && pnpm build
npx wrangler d1 create eduradius-staging        # once; note the database_id
STAGING_WORKER_NAME=eduradius-staging STAGING_D1_DATABASE_NAME=eduradius-staging \
  STAGING_D1_DATABASE_ID=<database_id> node scripts/staging-config.mjs
npx wrangler deploy --dry-run --config dist/server/wrangler.staging.json   # review bindings
```

Back up the database before migrating (staging starts empty, but rehearse the procedure):

```sh
npx wrangler d1 export eduradius-staging --remote --output staging-before-$BUILD_COMMIT.sql
```

Apply every migration in order, then set the secret and deploy:

```sh
for f in drizzle/0*.sql; do npx wrangler d1 execute eduradius-staging --remote --config dist/server/wrangler.staging.json --file "$f"; done
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

`staging-certify.mjs` checks 36 things through HTTP:

- **Health:** liveness, readiness and build identity.
- **Access boundaries:** anonymous access, forged Sites headers, invalid bearer and tampered cookie are all denied on private routes; cross-origin and anonymous writes are rejected.
- **Public intake:** internal fields are rejected and the response makes no email claim.
- **Owner journey:** review, stale-version and invalid-transition rejection, qualification, concurrent conversion, requirement rules, proposal review and revision, the submission-before-approval guard, award with evidence, the project-before-award guard, concurrent project creation, client acceptance rules, an approved change, the closeout guard and completion, and a private experience record.
- **Persistence and exposure:** records persist across a new session, and the public site excludes them.

The browser journeys use the loopback mock sign-in and run only against a local dev server. On a token-mode staging host, sign in through the workspace dialog. On an isolated Site, use Sign in with ChatGPT; the browser steps are otherwise unchanged.

## Local rehearsal (performed)

Against the **built Worker** (`wrangler dev` on the production bundle) with a freshly migrated database (0000–0006) and token mode, the certification script passed 36/36. Its output and the Worker logs contained neither the token nor the synthetic contact details. The staging config was generated and passed `wrangler deploy --dry-run`: 1,137 KiB upload (316 KiB gzipped), with bindings `DB` (staging D1) and `WORKSPACE_AUTH_MODE=token`. This is a rehearsal, **not hosted certification**.

## Teardown

```sh
npx wrangler delete --config dist/server/wrangler.staging.json
npx wrangler d1 delete eduradius-staging
```

Run teardown only after confirming the target. Synthetic staging records are disposable.
