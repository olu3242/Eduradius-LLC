# Operations runbook

## Environments

| | Local | Isolated staging | Production |
| --- | --- | --- | --- |
| Purpose | Development and automated checks | Release acceptance on hosted infrastructure | Live EduRadius site |
| Database | `.wrangler/state` (Miniflare D1) | Its own D1 database, never shared | Production D1 |
| Auth | Dev server: loopback mock sign-in. `pnpm start`: configure `dist/server/.dev.vars` | Same mode as production | `sites` (Sites dispatch) or `token` (any other Worker host) |
| Data | Clearly named test records only | Synthetic records only | Real records |
| Status | Verified (see VERIFICATION.md) | **Not yet provisioned** | Existing Site; this release not deployed |

The existing Site is **not** a staging target. Do not test this release against it.

## Configuration (placeholders only)

| Name | Where | Value |
| --- | --- | --- |
| `WORKSPACE_AUTH_MODE` | Variable | `sites` or `token` |
| `WORKSPACE_OWNER_IDS` | Variable (sites) | `<comma-separated Sites user ids>` |
| `WORKSPACE_OWNER_EMAILS` | Variable (sites) | `<comma-separated owner emails>` |
| `WORKSPACE_ACCESS_TOKEN` | **Secret** (token) | `<output of: openssl rand -base64 32>` |
| `DB` | D1 binding (`.openai/hosting.json`) | — |

Never commit values. `.env*`, `.dev.vars*` and `*.pem` are git-ignored, and the preflight fails if any are tracked. Values never reach the browser bundle: they are read only in `lib/server/*`. Exports contain records but no configuration.

```sh
pnpm preflight --target staging
pnpm preflight --target production
pnpm preflight --target local --env-file dist/server/.dev.vars
```

The preflight reports names and checks (presence, length, placeholder patterns, allowlist presence, migration order, tracked secret files). It never prints values.

## Local setup

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
for f in drizzle/0*.sql; do   # every migration, in numeric order
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local \
    --config dist/server/wrangler.json --persist-to .wrangler/state --file "$f"
done
pnpm dev
```

`pnpm dev` serves on `127.0.0.1`. Open `/workspace` and choose **Sign in** (loopback development identity).

## Migration order and compatibility

| # | File | Change | Compatible with previous code? |
| --- | --- | --- | --- |
| 0000 | `0000_wonderful_exiles.sql` | `workspaces` | — |
| 0001 | `0001_access_protection.sql` | `rate_limits` | Yes (additive) |
| 0002 | `0002_connected_workflow.sql` | `inquiries`, `opportunities`, `activity_events`, `notifications`, `workspace_snapshots` + indexes | Yes (additive; old code ignores the tables) |
| 0003 | `0003_contracting_records.sql` | `organizations`, `contacts`, `requirements`, `evidence`, `evidence_links`; `organization_id`/`contact_id` columns on `inquiries` and `opportunities` | Yes (new tables; nullable `ADD COLUMN`; earlier code selects explicit columns) |
| 0004 | `0004_proposals_and_teaming.sql` | `proposal_templates`, `proposals`, `proposal_versions`, `submissions`, `teaming_partners` | Yes (additive) |
| 0005 | `0005_projects_and_delivery.sql` | `projects`, `project_baselines`, `milestones`, `deliverables`, `project_log` | Yes (additive) |
| 0006 | `0006_delivery_closeout.sql` | `deliverable_versions`, `change_requests`, `project_closeouts`, `experience_records` | Yes (additive) |

Migrations 0003–0006 require **no data backfill**. Linking existing requests and opportunities to organizations is an explicit, rerunnable owner action (**Organizations → Link existing records**), not a migration. Because the workflow payload reads every table, apply **all** migrations before deploying code from this release.

- Never edit an applied migration; add a new numbered file (`pnpm db:generate`).
- Apply migrations **before** deploying the code that needs them. 0002 is additive, so code from before this release keeps working after it is applied.
- The legacy data move is **not** a SQL migration. It runs in the application on the first owner load, after both 0002 and the new code are in place (see WORKFLOW.md). It is transactional, idempotent and keeps a snapshot.
- After deploying, ask owners to reload open workspace tabs. Stale tabs receive a 409 on save, by design.

## Backup and restore

**Local** (verified in this iteration):

```sh
# stop pnpm dev / pnpm start first so SQLite files are consistent
cp -r .wrangler/state ".wrangler-backup-$(date +%Y%m%d%H%M)"
# restore: stop servers, then replace the directory
rm -rf .wrangler/state && cp -r .wrangler-backup-<stamp> .wrangler/state
```

`wrangler d1 export --local` reads `dist/server/.wrangler/state`, not `.wrangler/state`, so use the file copy above for local data.

**Cloudflare D1 (standalone Worker hosting)**, using commands available in the pinned Wrangler 4.92.0:

```sh
wrangler d1 export <database-name> --remote --output backup-<stamp>.sql   # logical backup before every migration
wrangler d1 time-travel info <database-name>                             # record the current bookmark
wrangler d1 time-travel restore <database-name> --bookmark=<bookmark>    # point-in-time restore
```

**Sites-managed D1:** the backup and restore procedure for the hosted Site's database is platform-managed and **has not been confirmed in this repository**. Confirm it with the hosting provider before the first production migration. If no supported export exists, do not migrate production.

Application-level backup: **Export workspace** downloads the document and every workflow record (`schemaVersion: 2`). It is useful for audits and manual recovery, but it is not a database restore.

## Recovery

**Migrations 0003–0006 fail part-way.** Each only creates tables and indexes, except that 0003 also adds two nullable columns to `inquiries` and `opportunities`. Inspect `sqlite_master` and `PRAGMA table_info(inquiries)`. Then either drop the objects the failed file created (D1 supports `ALTER TABLE … DROP COLUMN` for the 0003 columns) and rerun that file, or restore the pre-migration backup. No existing rows are modified.

**Migration 0002 fails part-way.** D1 runs a file's statements without an outer transaction. Inspect with `SELECT name FROM sqlite_master`. Because 0002 only creates objects, drop any objects it created (`DROP TABLE` / `DROP INDEX` for the five tables and their indexes) and rerun it, or restore the pre-migration backup. Existing data is untouched.

**The new release misbehaves after deploy.** Redeploy the previous build. Migration 0002 can stay, since old code ignores the new tables. Note that after the legacy import:

- the previous code no longer sees inquiries, opportunities or activity, because they now live in tables;
- the previous code writes new public requests into the workspace JSON, and the next release imports them automatically.

To fully return to the old model, restore the document from `workspace_snapshots` (`pre-workflow-r<revision>`) **and** account for any records created afterwards.

**The import conflicts repeatedly.** It retries on every owner load and is idempotent. Check the logs for `workspace.error` / `workflow.error`.

**Duplicate-conversion suspicion.** `SELECT source_inquiry_id, COUNT(*) FROM opportunities GROUP BY 1 HAVING COUNT(*) > 1` must return no rows; the unique index enforces this.

## Health, logging and alerts

**Endpoints (public, no secrets):**

- `GET /api/health` is liveness and returns `{ status: "ok", build }`.
- `GET /api/health/ready` is readiness. It returns 200 only when the database is reachable, every table the code reads exists, and an access mode is configured. Each check reports only `ok`, `incomplete`, `unavailable` or `not_configured`, plus the build commit, with no table names, modes, values or counts. `build` comes from `BUILD_COMMIT` at build time, or the local git commit.

**Logs:**

- Every response carries `x-request-id`. A well-formed incoming ID is kept; otherwise a UUID is generated.
- Every log line is one JSON object with `event`, `at` and `requestId`.
- Keys that look like personal data, credentials or document content (email, token, password, secret, authorization, cookie, phone, name, scope, notes, body, content, summary) are redacted, and long strings are truncated to 300 characters. Tests cover the redaction.
- Unhandled exceptions return a generic 500 with the request ID and log `http.exception` (method, path, message). Responses with status 500 or above log `http.error`.

**Alert rules (prepared, not activated).** Thresholds are owner decisions; no targets are assumed.

| Signal | Condition | Action |
| --- | --- | --- |
| `http.exception` / `http.error` | more than `<threshold>` in `<window>` | Inspect logs by `requestId`; roll back if the release introduced it |
| Readiness | `/api/health/ready` not 200 for `<window>` | Check the D1 binding, migrations and `WORKSPACE_AUTH_MODE` |
| `workspace.access.denied` with `reason` `not_owner` or `anonymous` | spike above `<baseline>` | Possible probing; review the access policy |
| `ratelimit.error`, `workflow.error`, `workspace.error`, `inquiry.error` | any | Database or code fault; intake and sign-in fail closed |
| `inquiry.capacity` | any | Intake reached its stored-request cap |

Deliver alerts through the hosting provider's log alerting (for example Workers Logs or Logpush to an alerting system), configured by the owner. No alerts or scheduled monitors are active.

## Identity and accountability

- **`token` mode:** one shared access key. Every action is attributed to `token:session` (browser) or `token:bearer` (API). This cannot identify an individual person, so do **not** treat activity history as individual staff attribution. Rotate the key when someone's access must end.
- **`sites` mode:** the actor is `sites:<stable Sites user id>` for allowlisted owners, which attributes actions to a signed-in account.
- **Owner review:** approvals are owner reviews in a single-owner workspace, not independent second reviews.

## Staging acceptance checklist

- [ ] Isolated staging Worker and its own D1 database provisioned (never the existing Site)
- [ ] `pnpm preflight --target staging` passes with the staging configuration
- [ ] Migrations 0000→0002 applied in order; `sqlite_master` lists all tables
- [ ] Seed a legacy-shaped document (see `tests/workflow.test.mjs`); first owner load imports it and creates a snapshot
- [ ] Anonymous visitor: `/api/workspace` and `/api/workflow` return 401 (or 503 if unconfigured)
- [ ] Authenticated **non-owner** returns 403 (sites mode)
- [ ] Owner journey: submit → review → assign → schedule follow-up → qualify → convert → open opportunity → reload
- [ ] Retrying the conversion returns `alreadyConverted`; only one opportunity exists
- [ ] Follow-ups show “Due today” against America/Chicago dates
- [ ] `/api/site` contains no request, opportunity or note content
- [ ] Mobile (390 px) Client requests, Follow-ups and dialogs have no horizontal overflow
- [ ] Export downloads `schemaVersion: 2` with all collections
- [ ] Logs contain no contact details or secrets
- [ ] Contracting journey: create opportunity → link organization/contact → requirements + evidence → proposal → request changes → revise → approve → record submission → confirm award → create project → milestones → deliverable revision → client acceptance with verified evidence → approved change (baseline 2, baseline 1 kept) → closeout → private experience record → reload (see `tests/browser/contracting-journey.mjs`)
- [ ] Retrying project creation and conversion returns the existing records; decided changes and preserved versions are read-only
- [ ] Reports show “No records yet”, zero and unavailable counts correctly for staging data
- [ ] Backup taken and a restore rehearsed on staging

## Production release checklist

- [ ] Staging acceptance checklist passed on this exact commit
- [ ] CI green on the release commit
- [ ] `pnpm preflight --target production` passes
- [ ] Production backup taken and its restore procedure confirmed for the hosting platform
- [ ] Apply migrations (0001 if not yet applied, then 0002); verify tables
- [ ] Deploy the build; confirm `/api/workflow` returns 401 anonymously
- [ ] Owner loads the workspace once (runs the import); verify counts against the snapshot
- [ ] Spot-check one migrated request, opportunity and the Follow-ups view
- [ ] Owners reload any open workspace tabs
- [ ] Rollback plan from this document reviewed
