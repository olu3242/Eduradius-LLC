# Staging handoff

This is the operator checklist for certifying the release candidate on an **isolated** staging target. Nothing here has been run against a hosted environment: no staging target is authorized yet.

## 1. Candidate

| | |
| --- | --- |
| Candidate commit | **`6ba656ccabc2826a6f947cecdf669c62a77d000a`** (branch `claude/focused-archimedes-t13ibf`, draft PR #1) |
| Build identity reported by `/api/health` | `6ba656ccabc2` |
| Candidate archive | `eduradius-6ba656ccabc2-dist.tar.gz`, **SHA-256 `bb6449e70eaf84371c4cc33ba3d60ad0b2bdc684199861e75740bb1d3563c022`** |
| How it was built | `node scripts/release/build-candidate.mjs 6ba656c` on a clean worktree with `pnpm install --frozen-lockfile` and `BUILD_COMMIT=<sha> pnpm build` |
| Archive checks | Build identity embedded and served (local Worker reported `6ba656ccabc2`); no `.env`, `.dev.vars` or `.pem` files; no credential patterns |
| Toolchain | Node 22.23.4, pnpm 11.25.0, Wrangler 4.157.0, vinext 1.4.4, linux-x64 |
| Migrations | `drizzle/0000`–`0008` (SHA-256 of each file in the archive's `manifest.json`) |

**Reproducibility.** Two clean builds of the same commit produce the same 339 files, with the same names once content hashes are normalized, but they are **not** byte-identical. vinext embeds per-build random preview-mode credentials, a Server Actions key and an RSC build identity.

- Deploy **exactly the recorded archive**, after checking its SHA-256. Do not rebuild for staging or production.
- The archive contains those framework keys. Store it privately.
- The archive lives under `outputs/release/` on the build machine and is not committed. To recreate an equivalent candidate, run the build command above and record the new checksum.

Documentation-only commits after the candidate do not change the deployed code (`git diff --stat 6ba656c..HEAD -- . ':!docs'` is empty for them).

## 2. Choose one supported staging route

| | **A. Cloudflare Worker, token mode** | **B. Isolated Sites (Sign in with ChatGPT)** |
| --- | --- | --- |
| What it certifies | The Worker, D1 schema and migrations, API boundaries, the journeys, and backup/restore, using shared-key (`token`) authentication | The same application behaviour, **plus Sites authentication** (owner allowlist, non-owner 403) and the Sites-managed D1 |
| What it does **not** certify | Sites sign-in or the owner allowlist; the Sites-managed backup and migration tracking (K2, K3) | Cloudflare token mode |
| Target | A new Worker (name containing `staging`) and its own D1 database in a named Cloudflare account | A new, non-production Site with its own D1 database |
| Certification tooling | `staging-config.mjs`, `staging-certify.mjs` (48 HTTP checks), browser journeys | Browser journeys signed in with ChatGPT; `staging-certify.mjs` is **not** usable (it signs in with a token) |
| Cost | Workers and D1 usage on that account (owner to confirm the plan) | Per the Sites plan |

Route A cannot stand in for B's authentication results, and B cannot stand in for A's.

## 3. Target identifiers to record before starting (non-secret)

**Route A:**

- Cloudflare account id (32 hex characters)
- Worker name, for example `eduradius-staging`
- D1 database name, for example `eduradius-staging`
- D1 database id (UUID from `wrangler d1 create`)
- the resulting `*.workers.dev` hostname

**Route B:**

- staging Site project id and URL (they must differ from production)
- the staging owner's Sites user id

**Production identifiers that tooling refuses** are listed in `scripts/production-identity.json`: the production hostname, the Sites project id, the Worker name, and the D1 name/id placeholders.

## 4. Configuration names (values never in files, tickets or chat)

| Name | Route | Kind | Purpose |
| --- | --- | --- | --- |
| `WORKSPACE_AUTH_MODE` | A: `token`; B: `sites` | variable | Access mode |
| `WORKSPACE_ACCESS_TOKEN` | A | **secret** (`wrangler secret put`) | 32+ character staging-only key; never reused from production |
| `WORKSPACE_OWNER_IDS` / `WORKSPACE_OWNER_EMAILS` | B | variable | Staging owner allowlist |
| `DB` | both | D1 binding | The staging database |
| `CLOUDFLARE_API_TOKEN` | A | operator secret store | Wrangler authentication on the operator machine only |
| `STAGING_CLOUDFLARE_ACCOUNT_ID`, `STAGING_WORKER_NAME`, `STAGING_D1_DATABASE_NAME`, `STAGING_D1_DATABASE_ID`, `STAGING_CONFIRM_TARGET` | A | shell variables | Inputs to `staging-config.mjs` (complete target confirmation) |
| `STAGING_BASE_URL`, `STAGING_CONFIRM_HOST`, `STAGING_ACCESS_TOKEN` | A | shell variables (token from the secret store) | Inputs to `staging-certify.mjs` |

## 5. Minimum permissions

| Permission | Route | Why |
| --- | --- | --- |
| Account → Workers Scripts: **Edit** | A | Upload the staging Worker, set its secret, delete it at teardown |
| Account → D1: **Edit** | A | Create the staging database, run read-only inspection, apply migrations, export, time travel |
| Account → Workers Tail: Read (optional) | A | Read staging logs during certification |
| Sites project owner on the **staging** Site only | B | Publish the candidate, set runtime variables, sign in as the staging owner |

No permission on the production Site, its database or its access policy is needed or wanted. Scope the API token to the staging account, and revoke it after certification.

## 6. Isolation checks (stop if any fails)

1. The target hostname, Worker name, database name and database id all differ from `scripts/production-identity.json`. Both scripts enforce this.
2. `staging-config.mjs` accepted the **complete** confirmation `<account>/<worker>/<database name>/<database id>`.
3. The staging database is empty at first inspection, or holds only synthetic records from earlier staging runs.
4. No production export, record or credential is copied to staging. Data is synthetic (`SYNTHETIC-STAGING-…`, `example.test`).
5. `WORKSPACE_ACCESS_TOKEN` was generated for staging (`openssl rand -base64 32`) and is stored only in the secret store.

## 7. Backup checkpoint

Before the first migration, and again before any re-run:

```sh
npx wrangler d1 export <staging-db> --remote --output staging-before-6ba656c.sql
npx wrangler d1 time-travel info <staging-db>        # record the bookmark
```

Rehearse a restore once (section 10).

## 8. Migration inspection and execution (route A; route B uses the platform's publish step)

```sh
npx wrangler d1 execute <staging-db> --remote --json --command "$(node scripts/migration-status.mjs --print-query)" > schema.json
node scripts/migration-status.mjs --wrangler-json schema.json --empty-database-ok     # empty database only
```

- Apply **only** the files listed, in order:
  ```sh
  npx wrangler d1 execute <staging-db> --remote --config dist/server/wrangler.staging.json --file drizzle/<file>
  ```
- Re-inspect and expect `Up to date`.
- If the tool refuses, stop and resolve the cause; do not override it:
  - a partial file → use `--resume-sql` per [OPERATIONS.md](OPERATIONS.md);
  - unrecognised objects → you are pointed at the wrong database;
  - `d1_migrations` that disagrees with the schema → reconcile first;
  - a failed query → fix access.
- **Upgrade rehearsal:** on a second staging database, apply 0000–0006, add synthetic records, inspect (it must prescribe only 0007 and 0008), apply, and re-inspect.

For route B, confirm with the platform how publishing applies migrations and tracks them (K2). Inspect before and after publishing in the same way.

## 9. Deployment (route A)

```sh
sha256sum -c SHA256SUMS                                    # in the directory holding the archive
git checkout 6ba656ccabc2826a6f947cecdf669c62a77d000a      # scripts and migrations of the same commit
rm -rf dist && mkdir dist && tar -xzf <path>/eduradius-6ba656ccabc2-dist.tar.gz -C dist   # the archive holds dist/'s contents
STAGING_CLOUDFLARE_ACCOUNT_ID=<id> STAGING_WORKER_NAME=eduradius-staging STAGING_D1_DATABASE_NAME=eduradius-staging \
  STAGING_D1_DATABASE_ID=<uuid> STAGING_CONFIRM_TARGET=<id>/eduradius-staging/eduradius-staging/<uuid> node scripts/staging-config.mjs
npx wrangler deploy --dry-run --config dist/server/wrangler.staging.json   # review bindings: DB + WORKSPACE_AUTH_MODE=token only
npx wrangler secret put WORKSPACE_ACCESS_TOKEN --config dist/server/wrangler.staging.json
npx wrangler deploy --config dist/server/wrangler.staging.json
curl -s https://<staging-host>/api/health          # build must be 6ba656ccabc2
curl -s https://<staging-host>/api/health/ready    # 200
```

## 10. Hosted acceptance tests

| # | Test | Route | Pass condition |
| --- | --- | --- | --- |
| 1 | `STAGING_BASE_URL=https://<host> STAGING_CONFIRM_HOST=<host> STAGING_ACCESS_TOKEN=… node scripts/staging-certify.mjs --expect-build 6ba656ccabc2826a6f947cecdf669c62a77d000a` | A | 48/48. The script stops before creating records if the build or readiness check fails |
| 2 | `contracting-journey.mjs`, `journey.mjs`, `pagination-ui.mjs`, `recovery-ui.mjs` against the staging URL (token sign-in dialog for A; Sign in with ChatGPT for B) | A, B | All checks pass; failures keep `diag.json` and traces (`DIAG_DIR`) |
| 3 | Anonymous: `/api/workspace`, `/api/workflow`, `/api/records/inquiry`, `/api/export` return 401; `/api/site` excludes synthetic records | A, B | As stated |
| 4 | Non-owner signed in with ChatGPT gets 403; owner gets 200 | **B only** | As stated |
| 5 | Export manifest counts equal every collection; summary under 64 KiB | A, B | As stated |
| 6 | Restore rehearsal: export, then `d1 execute --file` into a **new** staging database; the owner export from both is identical | A (B: platform procedure) | Identical |
| 7 | Rollback rehearsal: deploy the previous release `e07844b` against the staging data, confirm it reads every record, redeploy the candidate | A, B | Reads all records; candidate healthy again |
| 8 | Logs during the run contain no token, cookie or contact email | A, B | None found |

## 11. Recovery procedure (staging)

- **Failed deploy:** redeploy the previous Worker version (`wrangler rollback`, or deploy `e07844b`). Migrations stay applied because they are additive; this release and `e07844b` both read them.
- **Failed migration:** inspect, then `--resume-sql`, or `wrangler d1 time-travel restore <db> --bookmark=<recorded>`.
- **Damaged data:** restore the section 7 export into a new database and point the binding at it.
- **Teardown** (after certification, with the target confirmed):
  ```sh
  npx wrangler delete --config dist/server/wrangler.staging.json
  npx wrangler d1 delete <staging-db>
  ```
  Then revoke the API token.

## 12. Evidence required to declare staging certified

Record all of the following against commit `6ba656c` and archive SHA-256 `bb6449e7…c022`:

- [ ] Target identifiers (non-secret) and the isolation checks of section 6
- [ ] Backup export file name, its checksum and the time-travel bookmark
- [ ] Migration inspection output before and after (`Up to date`), plus the upgrade rehearsal output
- [ ] `/api/health` build `6ba656ccabc2`; `/api/health/ready` 200
- [ ] `staging-certify.mjs` JSON summary 48/48 (route A)
- [ ] Browser suite results, with a `run-series.mjs` summary for any repeated runs; every failed attempt kept
- [ ] Route B only: owner 200, non-owner 403, anonymous 401 with Sign in with ChatGPT
- [ ] Restore and rollback rehearsal results
- [ ] Log review result (no secrets or contact details)
- [ ] The route used and, explicitly, what it did **not** certify (see section 2)

Production stays **not recommended** until route B (or a confirmed equivalent for the Sites-managed production database) has certified authentication, backup/restore and migration tracking.
