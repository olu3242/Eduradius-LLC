# Operations runbook

## Environments

| | Local | Isolated staging | Production |
| --- | --- | --- | --- |
| Purpose | Development and automated checks | Release acceptance on hosted infrastructure | Live EduRadius site |
| Database | `.wrangler/state` (Miniflare D1) | Its own D1 database, never shared | Production D1 (Sites-managed) |
| Auth | Dev server: loopback mock sign-in. `pnpm start`: configure `dist/server/.dev.vars` | Same mode as production | `sites` (Sites dispatch) or `token` (any other Worker host) |
| Data | Clearly named test records only | Synthetic records only | Real records |
| Status | Verified (see [VERIFICATION.md](VERIFICATION.md)) | **Not yet provisioned** | Existing Site (pre-workflow code); this release not deployed |

The existing Site is **not** a staging target. Do not test this release against it.

## Configuration (placeholders only)

| Name | Where | Value |
| --- | --- | --- |
| `WORKSPACE_AUTH_MODE` | Variable | `sites` or `token` |
| `WORKSPACE_OWNER_IDS` | Variable (sites) | `<comma-separated Sites user ids>` |
| `WORKSPACE_OWNER_EMAILS` | Variable (sites) | `<comma-separated owner emails>` |
| `WORKSPACE_ACCESS_TOKEN` | **Secret** (token) | `<output of: openssl rand -base64 32>` |
| `DB` | D1 binding (`.openai/hosting.json`) | — |

Never commit values:

- `.env*`, `.dev.vars*` and `*.pem` are git-ignored, and the preflight fails if any are tracked.
- Values never reach the browser bundle; they are read only in `lib/server/*`.
- Exports contain records but no configuration.

```sh
pnpm preflight --target staging
pnpm preflight --target production
pnpm preflight --target local --env-file dist/server/.dev.vars
```

## Migrations

| # | File | Creates | Data change |
| --- | --- | --- | --- |
| 0000 | `0000_wonderful_exiles.sql` | `workspaces` | — |
| 0001 | `0001_access_protection.sql` | `rate_limits` | — |
| 0002 | `0002_connected_workflow.sql` | `inquiries`, `opportunities`, `activity_events`, `notifications`, `workspace_snapshots` + indexes | — |
| 0003 | `0003_contracting_records.sql` | `organizations`, `contacts`, `requirements`, `evidence`, `evidence_links`; nullable `organization_id`/`contact_id` on `inquiries` and `opportunities` | — |
| 0004 | `0004_proposals_and_teaming.sql` | `proposal_templates`, `proposals`, `proposal_versions`, `submissions`, `teaming_partners` | — |
| 0005 | `0005_projects_and_delivery.sql` | `projects`, `project_baselines`, `milestones`, `deliverables`, `project_log` | — |
| 0006 | `0006_delivery_closeout.sql` | `deliverable_versions`, `change_requests`, `project_closeouts`, `experience_records` | — |
| 0007 | `0007_list_indexes.sql` | 18 indexes for paginated lists, parent filters and follow-ups | — |
| 0008 | `0008_import_conflicts.sql` | `import_conflicts` + 2 indexes (rollback-window edits awaiting an owner decision) | — |

Every file only creates tables, indexes or nullable columns. Each statement creates exactly one object. No migration rewrites rows.

**Additive schema is not the same as old code reading new data.** Here is what each code version can do with each schema and data state:

| Code | Schema/data state | Works? | Evidence |
| --- | --- | --- | --- |
| This release (`6ba656c`) | All of 0000–0008 | Yes | All suites |
| This release | 0000–0008 without 0007 | Yes, without the list indexes (slower lists) | `recovery.test` |
| This release | Without 0008 | **No.** Readiness reports the schema `incomplete`, and the summary fails. Apply 0008 before deploying | `health.ts` lists `import_conflicts` |
| Previous candidate `e07844b` (Stage 3–4) | Data written by `af555c9` with 0007 applied | Yes: reads every record identically and its full contracting journey passes (27/27). **Not re-run** against 0008 data; 0008 only adds a table that older code ignores | [VERIFICATION.md](VERIFICATION.md) |
| Pre-workflow Site v5 | **Before** the first owner load of 0002+ code | Yes (nothing has moved yet) | — |
| Pre-workflow Site v5 | **After** the legacy import | **No.** Requests, opportunities and activity are no longer in the document, and its save rejects the document (`400 Invalid workspace.`), because v5 requires an `opportunities` array | Verified locally with the original v5 handler; see Rollback |

### Fresh install (empty database)

```sh
corepack enable && pnpm install --frozen-lockfile && pnpm build
for f in drizzle/0*.sql; do   # every migration, in numeric order (empty database only)
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local \
    --config dist/server/wrangler.json --persist-to .wrangler/state --file "$f"
done
pnpm dev     # 127.0.0.1; open /workspace and choose Sign in (loopback development identity)
```

`scripts/perf/fresh-local-state.sh [--empty|--legacy]` does the same for local work and destroys only local state. It seeds a synthetic dataset by default, or a legacy-shaped document (`--legacy`) to exercise the import.

### Existing database: inspect first, then apply only what is pending

**Never replay migrations that are already applied.** The CREATE statements fail with "already exists". Determine the state first. The check is read-only and looks only at `sqlite_master`:

```sh
# Local file
node scripts/migration-status.mjs --sqlite .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite
# Hosted D1 (read-only query; Cloudflare-managed D1 that you operate)
wrangler d1 execute <database> --remote --json --command "$(node scripts/migration-status.mjs --print-query)" > schema.json
node scripts/migration-status.mjs --wrangler-json schema.json
```

The tool lists each file as `applied`, `pending` or `partial`. It prints the files to apply, in order, only when the applied files form a clean prefix and the target's state is unambiguous.

| Exit | Meaning |
| --- | --- |
| 0 | Consistent; the listed files (or none) are pending |
| 1 | Inspection failed, unreadable or malformed; or an empty result without `--empty-database-ok` (use that flag only for a database you just created) |
| 2 | Partial or out-of-order file; objects that no migration creates (wrong database?) unless `--allow-unrecognised`; or Wrangler migration tracking (`d1_migrations`) that disagrees with the schema. Pass `--d1-migrations-json` from `SELECT name FROM d1_migrations ORDER BY id` when that table exists |

CLI tests cover empty, previous-release (0006), fully migrated, partial, failed and ambiguous targets (`tests/migration-preflight.test.mjs`).

Then:

1. Take a backup (below).
2. Apply each pending file, in order, with `wrangler d1 execute <database> --remote --file drizzle/<file>`.
3. Re-run the status check and confirm `Up to date`.

On the Sites-managed production database, publishing applies migrations ([SITES_RUNTIME.md](SITES_RUNTIME.md)). Confirm with the platform how already-applied files are tracked before the first publish of this release (blocker K2).

### Interrupted migration

A partial file is reported with its missing objects. Each statement creates one object, so the safe completion is to apply only the missing statements:

```sh
node scripts/migration-status.mjs --wrangler-json schema.json --resume-sql 0007_list_indexes.sql > resume.sql   # review it
wrangler d1 execute <database> --remote --file resume.sql
```

Re-run the status check afterwards. Rerunning the whole file instead fails at the first object that already exists. Tests cover a half-applied 0007 and a 0003 whose tables exist but whose columns are missing, with data preserved. If anything else looks wrong, restore the pre-migration backup.

### Data moves that are not migrations

- **The legacy JSON import** runs in the application on the first owner load after 0002 and the new code are in place ([WORKFLOW.md](WORKFLOW.md)).
  - It is one D1 batch, so an interruption leaves no partial rows, snapshot or document change (tested).
  - It is idempotent: existing ids and already-imported legacy activity are skipped.
  - It keeps a snapshot `pre-workflow-r<revision>` of the original document for each run.
- **Linking organizations** is an explicit, rerunnable owner action.
- After deploying, ask owners to reload open workspace tabs. Stale tabs receive a 409 on save, by design.

## Backup and restore

| Method | Scope | Verified |
| --- | --- | --- |
| **Logical backup** (`wrangler d1 export`) | Schema and data as SQL | **Locally, with the real tool.** A database holding the complete synthetic journey and a rollback round trip was exported (95 rows, 167 statements) and restored into an empty state with `d1 execute --file`. The owner export before and after was **identical**: document, every record, ids, versions, links and manifest counts. |
| File copy of `.wrangler/state` | Local only | Locally (used throughout testing) |
| D1 time travel (`wrangler d1 time-travel info/restore`) | Point-in-time, Cloudflare D1 that you operate | Not verified (no hosted database) |
| Sites-managed D1 | Platform procedure | **Not confirmed.** Blocker K2: confirm with the hosting provider before the first production migration; if no supported export exists, do not migrate production |
| **Owner export** (`GET /api/export`, the workspace "Export" button) | Every record, in one consistent snapshot | Complete at 2,100+ opportunities; refuses rather than truncates. It is an audit and recovery aid, **not** a database restore. |

```sh
# Cloudflare D1 that you operate (before every migration)
wrangler d1 export <database> --remote --output backup-<stamp>.sql
wrangler d1 time-travel info <database>                                   # record the bookmark
# Restore into a NEW, empty database (never over a live one), verify, then switch the binding:
wrangler d1 execute <new-database> --remote --file backup-<stamp>.sql
node scripts/migration-status.mjs --wrangler-json <schema of new-database>   # expect "Up to date"
```

Local: `wrangler d1 export --local` reads the state next to the config (`dist/server/.wrangler/state`). Copy `.wrangler/state` there first, or use a file copy, with dev servers stopped.

## Rollback

Choose by what was deployed and what happened since. Schema migrations are additive and are **not reversed**.

| Situation | Safe action | Not safe |
| --- | --- | --- |
| This release misbehaves; the previous release was `e07844b` or later | **Preferred.** Redeploy the previous artifact and leave migrations applied. Verified: `e07844b` read `af555c9` data identically and passed its journey; open rollback conflicts (0008) simply wait until this release returns | Dropping 0007 or 0008 objects (no need) |
| A migration failed part-way | Inspect, then resume the missing statements, or restore the pre-migration backup | Re-running the whole file; dropping tables that hold data |
| Must return to **pre-workflow Site v5 after the legacy import** (only when the previous release cannot be used) | Rebuild the legacy document (below), then redeploy v5; treat existing records as read-only while v5 is live | Redeploying v5 alone. It hides every request and opportunity, and its save fails with 400 (verified with the original v5 handler) |
| Data damaged by the release | Restore the pre-release backup into a new database, then reconcile records created since from an owner export taken before the restore | Restoring over the live database without an export of newer records |

### Returning to Site v5 after the import (tested locally)

1. Take a database backup and an owner export: `GET /api/export` saved as `export.json`.
2. Run:
   ```sh
   node scripts/recovery/legacy-document.mjs --from-export export.json --out rollback/ --confirm-v5-rollback
   ```
   This rebuilds the legacy document from the **current** tables:
   - every request and opportunity keeps its id; requests created after the import are included;
   - statuses are mapped back (an unchanged imported request regains its exact original status);
   - assignee and next action are appended to the request notes;
   - the original legacy activity entries are restored.

   It writes `legacy-workspace.json` (with a `_rollback` marker fingerprinting every item handed to v5) and `apply-legacy-workspace.sql`, and applies nothing.

   | Exit | Refused because |
   | --- | --- |
   | 2 | The export is incomplete (manifest counts differ from its collections) |
   | 2 | The document, including the marker, would exceed v5's 700,000-character save limit (the synthetic dataset of 1,200 requests produced about 1.94 M characters) |
   | 3 | `--confirm-v5-rollback` was not given. It first lists the records v5 cannot show |

   If the document is too large, do not roll back to v5: redeploy the previous release, fix forward, or restore a backup.
3. Apply `apply-legacy-workspace.sql`. It updates only if the document is still at the exported revision. Then redeploy v5.
4. **While v5 is live (maintenance procedure):**
   - Treat existing requests and opportunities as read-only where possible. Record new information as new notes after the forward move instead.
   - Workflow activity, organizations, contacts, requirements, evidence, proposals, projects and experience records stay in their tables, untouched and not shown by v5.
   - New public requests go into the document.
5. **Going forward again**, the first owner load imports the document:
   - records added under v5 are inserted;
   - existing ids and legacy activity are not imported over the tables;
   - any existing request or opportunity **changed** under v5 is compared with what was handed over (the marker's fingerprint, or the previous import snapshot when there is no marker). It is recorded as an open **rollback conflict** instead of being dropped;
   - the v5 document is kept in a new `pre-workflow-r<revision>` snapshot.
6. **Owner decisions.** Follow-ups → *Rollback conflicts — decision required* shows each conflict's fields: the current value (kept) beside the legacy edit. The navigation count includes open conflicts.
   - **Keep current** or **Apply legacy edit**. A reason is required.
   - Each decision is made once, version-guarded, and recorded in activity (`import.conflict_kept`, `import.conflict_applied`).
   - Applying is refused (409) if the record was edited after the conflict was found. Review it and decide again.
   - A converted request's status cannot be changed.

Verified locally:

- unit tests (`recovery.test`, 9):
  - the round trip, with requests converted after the import, a project, a requirement on a legacy opportunity and an organization link;
  - rollback-window edits becoming conflicts;
  - reason-required, version-guarded and decided-once decisions, with retries and re-imports;
  - refusal when the record changed after detection;
  - snapshot-baseline detection without a marker;
  - the tool's refusals;
- browser (`recovery-ui.mjs`): conflicts listed with field differences; buttons disabled until a reason is given; keep and apply decisions recorded with activity; no overflow at 390 px;
- a manual run on the dev stack after both browser journeys: export → legacy document → SQL applied → the original v5 GET read 3 requests, 3 opportunities and 1 legacy activity entry, and its PUT (owner save) returned 200 → forward again.

Results of the manual run, forward again:

- the one request added under v5 was imported;
- nothing was duplicated;
- every contracting and delivery record (ids, versions, links) was identical.

## Health, logging and alerts

**Endpoints (public, no secrets):**

- `GET /api/health` is liveness and returns `{ status: "ok", build }`.
- `GET /api/health/ready` returns 200 only when the database is reachable, every table the code reads exists, and an access mode is configured.
  - Each check reports only `ok`, `incomplete`, `unavailable` or `not_configured`, plus the build commit.
  - Readiness does not check indexes; use the migration status check.

**Logs:**

- Every response carries `x-request-id`, and every log line is one JSON object with `event`, `at` and `requestId`.
- Keys that look like personal data, credentials or document content are redacted, and long strings are truncated.
- Unhandled exceptions return a generic 500 with the request ID (`http.exception`); responses with status 500 or above log `http.error`.
- Exports log `workspace.export` with counts only.

**Alert rules (prepared, not activated).** Thresholds are owner decisions.

| Signal | Condition | Action |
| --- | --- | --- |
| `http.exception` / `http.error` | more than `<threshold>` in `<window>` | Inspect logs by `requestId`; roll back if the release introduced it |
| Readiness | `/api/health/ready` not 200 for `<window>` | Check the D1 binding, migrations and `WORKSPACE_AUTH_MODE` |
| `workspace.access.denied` with `reason` `not_owner` or `anonymous` | spike above `<baseline>` | Possible probing; review the access policy |
| `ratelimit.error`, `workflow.error`, `workspace.error`, `inquiry.error` | any | Database or code fault; intake and sign-in fail closed |
| `inquiry.capacity` | any | Intake reached its stored-request cap |
| `workspace.export` with `ok: false` | any | The workspace exceeded the export limits; use a database backup |

No alerts or scheduled monitors are active.

## Identity and accountability

- **`token` mode:** one shared access key.
  - Every action is attributed to `token:session` (browser) or `token:bearer` (API). This **cannot identify an individual person**; do not treat activity as individual staff attribution.
  - Rotate the key when someone's access must end.
- **`sites` mode:** the actor is `sites:<stable Sites user id>` for allowlisted owners.
- **Owner review:** approvals are owner reviews in a single-owner workspace, not independent second reviews.

## Staging acceptance checklist

- [ ] Isolated staging Worker and its own D1 database provisioned (never the existing Site)
- [ ] `pnpm preflight --target staging` passes with the staging configuration
- [ ] `migration-status` on the empty staging database, then 0000–0008 applied in order; status reports `Up to date`
- [ ] Rehearse an upgrade: a second staging database at 0006 with synthetic data; status prescribes only 0007 and 0008; apply them; status reports `Up to date`
- [ ] Seed a legacy-shaped document (`scripts/local/seed-legacy-document.mjs` shows the shape); the first owner load imports it and creates a snapshot
- [ ] Anonymous visitor: `/api/workspace`, `/api/workflow`, `/api/records/*`, `/api/export` return 401 (or 503 if unconfigured); an authenticated **non-owner** gets 403 (sites mode)
- [ ] `scripts/staging-certify.mjs` passes on the exact candidate (48 checks, including pagination, cursor validation, reports and export completeness)
- [ ] Browser journeys: `journey.mjs`, `contracting-journey.mjs`, `pagination-ui.mjs` (sign in through the token dialog or Sign in with ChatGPT)
- [ ] Follow-ups show "Due today" against America/Chicago dates
- [ ] Mobile (390 px): lists, pickers and dialogs have no horizontal overflow
- [ ] Export downloads `schemaVersion: 2` with `manifest.counts` matching every collection
- [ ] Logs contain no contact details or secrets
- [ ] Backup taken with the platform's tool and a restore rehearsed into a new database; the owner export is identical before and after
- [ ] Rollback rehearsal: redeploy the previous artifact against the new data and confirm it reads everything

## Production release checklist

- [ ] Staging acceptance checklist passed on this exact commit; CI green on it
- [ ] `pnpm preflight --target production` passes
- [ ] Production backup taken and its restore procedure confirmed for the hosting platform (K2)
- [ ] `migration-status` on production; apply exactly the pending files it lists; status reports `Up to date`
- [ ] Deploy the build; `/api/health` reports the release commit; `/api/health/ready` is 200; `/api/workflow` returns 401 anonymously
- [ ] Owner exports the workspace **before** the first load of the new release, if the document is still in legacy format
- [ ] Owner loads the workspace once (runs the import); counts match the snapshot
- [ ] Spot-check one migrated request, opportunity and the Follow-ups view
- [ ] Owners reload any open workspace tabs
- [ ] Rollback table above reviewed; the legacy-document tool tried on the pre-release export (and its size checked against 700,000)
