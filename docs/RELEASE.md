# Release decision package

| | |
| --- | --- |
| Release candidate | **`af555c9e97bd097d02358782b4e6793c88d88560`** on `claude/focused-archimedes-t13ibf` (draft PR #1) |
| Previous candidate | `36ce7a1a3de6cd9f06a26894383d7e3c6fb55ac8`. Its evidence is kept in the history section at the end and is not reused below |
| Commits since `e07844b` | `55bb85c` dependencies · `f92557e` local datasets and measurement · `ff143a1` pagination · `af555c9` migration inspection and recovery |
| Evidence date | 2026-11-16 (business date America/Chicago) |
| Environment | Linux container, Node 22.23.4, pnpm 11.25.0 (corepack), Wrangler 4.92.0, Chromium via Playwright; isolated local D1 (Miniflare) only |

The commit that adds this document changes only documentation. Every result below was produced against the candidate commit's code, unless a row names another commit.

## Decisions

| Decision | Outcome | Basis |
| --- | --- | --- |
| **Local readiness** | **Ready** | On the candidate: 115/115 unit and integration tests, 2/2 built-Worker smoke tests, 48/48 certification checks against the built Worker, and browser suites of 30, 27, 16 and 14 checks. Migration inspection, interrupted-migration resume, backup/restore with Wrangler's export, previous-release compatibility and the v5 rollback round trip are verified locally. |
| **Isolated hosted staging readiness** | **Not certified (blocked)** | No explicitly authorized, isolated staging target, account or credential exists (K1). Tooling and runbook are rehearsed locally ([STAGING.md](STAGING.md)). |
| **Production release readiness** | **Not recommended yet** | Requires hosted staging certification (K1), a confirmed backup/restore and migration-tracking procedure for the Sites-managed D1 (K2), and configured access variables with verified hosted sign-in (K3). The dependency blocker (K4) is resolved: production audit 0. This is a recommendation, not deployment authorization. |

## What changed in this candidate

1. **Dependencies ([DEPENDENCIES.md](DEPENDENCIES.md)).**
   - The deployed Worker bundled React Server Components 19.2.6, which had a critical RCE advisory; the earlier triage had missed it.
   - React, React DOM and `react-server-dom-webpack` are now 19.2.9, `next` and `eslint-config-next` 16.4.5, `vite` 8.1.6 and `zod` 4.6.7, with same-major overrides for patched transitive packages.
   - `pnpm audit --prod`: 23 → **0**. `pnpm audit`: 86 → 4, all in development or build tooling.
2. **Pagination ([API.md](API.md), [PERFORMANCE.md](PERFORMANCE.md)).**
   - `/api/workflow` is now a bounded summary.
   - Lists use keyset cursors with validated, allowlisted search, filters and sorts. Detail views load one context; reports aggregate on the server; the export is complete and consistent, or refused.
   - Pickers search the server lazily. Server-side whole-table scans in actions were removed.
   - Migration 0007 adds indexes.
3. **Migrations and recovery ([OPERATIONS.md](OPERATIONS.md)).**
   - `scripts/migration-status.mjs` inspects before anything is prescribed and resumes interrupted files.
   - Fresh install and upgrade are now separate procedures.
   - Backup/restore was verified with `wrangler d1 export`.
   - The previous release was confirmed compatible with the new data.
   - A code-only rollback to Site v5 after the import was shown to be unsafe, and was replaced by a tested legacy-document rebuild (`scripts/recovery/legacy-document.mjs`).

## Requirements-to-evidence matrix

Status values: Implemented / Partially implemented / Missing / Blocked / Not verified. "Hosted" behavior is **Not verified** everywhere, because no staging environment exists.

| Area | Status | Code | Automated evidence | Browser evidence | Remaining |
| --- | --- | --- | --- | --- | --- |
| Authentication and owner access | Implemented locally; hosted Not verified | `lib/server/access.ts`, `owner-route.ts` | access (34); every new read endpoint denies anonymous and wrong-token callers (pagination test); certify 48/48 | journey 30/30 | Hosted Sign in with ChatGPT and owner allowlist (K3) |
| Public website and briefing submission | Implemented | `app/page.tsx`, `api/inquiries`, `api/site` | intake, limits, public projection tests | journey; contracting journey | — |
| Inquiry review, follow-ups, conversion | Implemented | `lib/workflow.ts`, `workflow-store.ts`, `summary.ts` | workflow (20); follow-up buckets in SQL with totals (pagination) | journey 30/30 | — |
| Organizations, contacts, teaming | Implemented | `records-store.ts`, `actions.ts`, `context.ts` | records (10); duplicate groups over the whole table | contracting journey | — |
| Requirements and evidence | Partially implemented | specs; `evidence_links` | records; evidence state filters | contracting journey | **File uploads: Blocked** (no private storage) |
| Proposals, submission, award, project | Implemented (owner review) | `actions.ts` | proposals (8), projects (5) | contracting journey 27/27 | Independent second reviewer: Missing by design |
| Delivery, change control, closeout, experience | Implemented | `actions.ts` (parent-scoped reads) | delivery (8) | contracting journey | — |
| **Pagination, search, filters, relationships** | **Implemented** | `listing.ts`, `data.ts`, `list-ui.tsx` | pagination (14): limits, invalid inputs, equal sort values, cursor binding, concurrent inserts/edits/deletes, search beyond page 1, LIKE escaping, every allowlisted sort/filter, relationships beyond page 1, indexes used | pagination-ui 16/16; volume 14/14 | Substring search (no full-text index) (K12) |
| **Reports** | **Implemented (server-side)** | `report-store.ts` | every metric equals the shared definition over the full export | — | — |
| **Exports** | **Implemented (complete or refused)** | `export.ts` | 2,100 opportunities exported (the old cap was 2,000); 413 on both limits; manifest counts | perf: complete vs database counts | Very large workspaces need a database backup instead |
| Operations (health, logs, correlation) | Implemented | `health.ts`, `request-context.ts` | release (7) | contracting journey | Alerts prepared, not activated |
| **Migrations and recovery** | **Implemented; hosted Not verified** | `drizzle/0000–0007`, `scripts/migration-status.mjs`, `scripts/recovery/` | recovery (5): status, partial/out-of-order, resume, no-0007 compatibility, interrupted import, v5 round trip; release (7) | manual: Wrangler export/restore, previous release on new data, original v5 handler | Sites-managed backup and migration tracking (K2) |
| **Dependencies** | **Remediated** | `package.json`, `pnpm-workspace.yaml` | audit: prod 0; 4 dev/build advisories documented | journeys on upgraded deps (`55bb85c`) | vinext/wrangler upgrade (backlog) |

## Automated results (candidate `af555c9`)

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | pass |
| `pnpm exec tsc --noEmit` | pass |
| `pnpm lint` | pass: 0 errors, the same 13 `<img>` warnings |
| `pnpm test` | **115/115**: access 34, workflow 20, pagination 14, records 10, proposals 8, delivery 8, release 7, projects 5, recovery 5, preflight 4 |
| `pnpm build` | pass; build identity `af555c9e97bd` embedded |
| `pnpm test:worker` | **2/2** (built Worker, every migration, paginated list) |
| `scripts/staging-certify.mjs` against the built Worker (fresh 0000–0007 database, token mode) | **48/48**; reported build `af555c9e97bd` matched; token and synthetic email absent from output and Worker log |
| `wrangler deploy --dry-run` with a generated staging config | pass: 1,185.38 KiB (329.46 KiB gzipped); bindings `DB`, `WORKSPACE_AUTH_MODE` |
| `pnpm audit --prod` | **0** advisories |
| `pnpm audit` (all) | 4 (1 low, 3 moderate), development and build tooling only ([DEPENDENCIES.md](DEPENDENCIES.md)) |
| GitHub CI (`verify`) | `55bb85c`: see PR checks · `ff143a1`: **pass** · candidate: see the PR checks for the docs commit that follows it (code identical) |

## Browser results (candidate `af555c9`, Chromium, local dev server)

| Suite | Result | Covers |
| --- | --- | --- |
| `tests/browser/journey.mjs` (fresh database with a legacy document) | **30/30** | Briefing → review → convert; legacy import; follow-ups; dialogs; persistence; export |
| `tests/browser/contracting-journey.mjs` | **27/27** in 5 of 6 runs. One run aborted; its output was not captured and the failure did not recur in 4 further runs, including the same fresh-database sequence (K11) | Briefing → opportunity → requirements/evidence → proposal review → submission → award → project → acceptance → change → closeout → experience → export → reload, with pickers searched beyond the first 20 choices |
| `tests/browser/pagination-ui.mjs` (synthetic dataset) | **16/16** | A slower superseded search response is discarded; empty state and filter reset; error and retry with state kept; Enter on "Load more" keeps focus; polite live count; pickers make no requests until used; keyboard search and selection beyond the first 20 choices; accessible names for every control; no overflow at 390 px |
| `tests/browser/volume.mjs` | **14/14** | Long unbroken text, desktop and mobile; one bounded page then "Load more"; server search reaching the oldest record; summary under 64 KiB |

These are **automated observations**, not manual testing and not a formal accessibility conformance assessment.

## Performance (same synthetic dataset, local)

See [PERFORMANCE.md](PERFORMANCE.md) for method and every scenario. The headline figure is the payload on every workspace load:

| | Baseline `e07844b` | Candidate `af555c9` |
| --- | --- | --- |
| `GET /api/workflow` | 6,060,842 bytes, 6,451 records | 22,101 bytes, 70 summary items |
| Initial load `/api/*` bytes | 6,061,023 | 22,282 |

Searches are server round trips: about 300–450 ms, including the 250 ms debounce, against about 20–70 ms in memory before. The export is complete in both at this size; the baseline cap at 2,000 is gone.

## Migrations, backup and recovery

| Scenario | Result | Commit |
| --- | --- | --- |
| Empty database, all of 0000–0007 (real Wrangler) | Applied; status `Up to date` | `af555c9` |
| Status on a 0006 database | Prescribes only 0007 | `af555c9` |
| Partial 0007 (7 of 18 indexes); partial 0003 (tables without columns, data present) | Detected as partial; whole-file rerun fails; resuming the missing statements completes it; data preserved | `af555c9` (test) |
| Out of order (0006 without 0005) | Detected; nothing prescribed | `af555c9` (test) |
| This code without 0007 | Lists, context, reports, summary and export work | `af555c9` (test) |
| Interrupted legacy import | No partial rows, snapshot or document change; the retry imports once | `af555c9` (test) |
| Backup with `wrangler d1 export --local`, restore into an empty state | Owner export identical before and after (document, all records, ids, versions, links, counts) | `af555c9` |
| Previous candidate `e07844b` on this release's data (0007 applied) | Reads every record identically; its contracting journey passes 27/27 | `e07844b` on `af555c9` data |
| Code-only rollback to Site v5 after the import | **Unsafe:** v5 GET shows no requests or opportunities; v5 save returns 400 | original v5 handler (`2af4266`) |
| v5 rollback with the legacy-document tool, then forward | v5 read 3 requests, 3 opportunities and 1 legacy activity entry; its save returned 200. Forward again: only the v5-period request was added; nothing was duplicated; every contracting record was identical | `af555c9` + v5 handler |
| Legacy-document tool on 1,200 requests | Refused (1.94 M characters is over v5's 700,000 limit) | `af555c9` |
| Hosted D1 backup/restore, Sites migration tracking | **Not verified** (K2) | — |

## Security and data boundaries (verified locally)

- **New reads:** every new endpoint (`/api/records/:type` GET, `/api/records/:type/:id` GET, `/api/context`, `/api/followups`, `/api/reports`, `/api/export`, `/api/evidence-links`, `/api/organizations/duplicates`) returns 401 for anonymous and wrong-token callers, with no record content (test).
- **Injection:** search and filters are bound parameters, and only allowlisted columns reach SQL. Quote, comment and wildcard payloads are treated literally (test).
- **Prototype keys:** a `__proto__` type returns 404 (found and fixed in this candidate).
- **Summary:** `/api/workflow` carries no notes, scopes or contact emails and stays under 20 KB in tests. `recentOpportunities` holds card fields only.
- **Earlier boundaries hold:** CSRF, body limits, rate limits, public-intake field rejection, server-side actors and public projection (unchanged tests).
- **Logs:** exports log counts only. No token or contact email appeared in rehearsal output or Worker logs.
- **Accountability:** token mode is a shared credential with no individual attribution ([OPERATIONS.md](OPERATIONS.md)).

## Acceptance evidence (candidate `af555c9`)

| Requirement | Scenario | Expected and observed | Evidence |
| --- | --- | --- | --- |
| Bounded loading | Workspace load on 1,200 requests and 400 opportunities | 22 KB summary; 25-record pages | perf; volume |
| Pagination limits | `limit` 0, 101, `abc`, 2.5; unknown sort, filter or parameter; long `q`; more than 100 ids | 400 `invalid_parameter` | pagination test |
| Equal sort values | 37 rows with identical timestamps and titles | Every row exactly once, id order | pagination test |
| Concurrent changes during paging | Insert, edit, and delete the cursor anchor between pages | No duplicates; no original row skipped | pagination test |
| Stale responses | A slower earlier search | Discarded | pagination-ui |
| Relationships beyond page 1 | Contact on an organization only in the last page; picker beyond the first 20 choices | Linked and selectable | pagination test; pagination-ui; contracting journey |
| Complete reports | 131 expired evidence records and more | Count 131+, 100 items, `truncated` | pagination test |
| Complete export | 2,100 opportunities | All exported; manifest matches | pagination test; perf |
| Export refusal | Row or byte limit exceeded | 413; nothing downloaded | pagination test |
| Recovery | See the table above | As listed | recovery test; manual runs |

**Human acceptance still required:**

- owner sign-off on wording and branding;
- hosted Sites sign-in;
- screen-reader and cross-browser review;
- the business rules;
- whether search should become full-text.

## Known issues and blockers

| ID | Issue | Severity | Impact | Workaround | Owner / decision | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| K1 | No authorized isolated staging target | **Blocker** (hosted and production) | Hosted behavior uncertified | Local rehearsal only | Owner | Authorize a staging Worker and D1 (or an isolated Site) and a scoped credential; follow [STAGING.md](STAGING.md) |
| K2 | Sites-managed D1: backup/restore and migration tracking unconfirmed | **Blocker** (production) | A failed or replayed migration may be unrecoverable | Inspect with `migration-status` before publishing; take an owner export | Owner/platform | Confirm both procedures and rehearse on staging |
| K3 | Hosted Sign in with ChatGPT and owner allowlist not verified; no runtime variables set on the Site | **Blocker** (production on Sites) | Workspace locked (503) after deploy | Token mode on another host | Owner | Set `WORKSPACE_AUTH_MODE=sites` and `WORKSPACE_OWNER_IDS`; verify owner, non-owner and anonymous |
| K4 | Dependency advisories | **Resolved** for production (audit 0) | 4 development/build advisories remain, documented | — | Engineering | Upgrade vinext and wrangler in a dedicated change (backlog) |
| K5 | `/api/workflow` unpaginated | **Resolved** | — | — | — | — |
| K6 | Shared-credential accountability in token mode | Medium | Activity cannot identify individuals | Use `sites` mode | Owner | Decide the auth mode per environment |
| K7 | No file uploads | Low (by design) | References and links only | Private drive | Owner | Authorize R2 if needed |
| K8 | Accessibility checks are structural only | Medium | Not a WCAG claim | — | Owner | Screen-reader and contrast audit |
| K9 | vinext is beta (`1.0.0-beta.5`) | Medium | Framework defects possible | Pinned lockfile; CI | Engineering | Track releases |
| K10 | Open tabs during deploy get 409 on save | Low (expected) | Reload | — | — | In the checklist |
| K11 | One unexplained contracting-journey abort in 6 runs | Low | Possible local flake | Rerun | Engineering | Capture full output on any recurrence |
| K12 | Search is substring matching (`LIKE`) without a full-text index | Low at current scale | Search cost grows with table size | Filters narrow results | Engineering | Measure on staging; consider FTS5 |
| K13 | v5 rollback only fits while the legacy document is ≤ 700,000 characters | Medium (recovery) | Larger workspaces cannot roll back to v5 | Fix forward or restore a backup | Owner | Decide whether a v5 rollback must remain possible |
| K14 | The client cache grows with the records viewed in a session | Low | Memory in very long sessions | Reload | Engineering | Bound or evict if needed |

## Configuration (names and placeholders only)

| Name | Kind | Placeholder |
| --- | --- | --- |
| `WORKSPACE_AUTH_MODE` | variable | `sites` or `token` |
| `WORKSPACE_OWNER_IDS` / `WORKSPACE_OWNER_EMAILS` | variable (sites) | `<comma-separated>` |
| `WORKSPACE_ACCESS_TOKEN` | **secret** (token) | `<openssl rand -base64 32>` |
| `DB` | D1 binding | `<staging or production database>` |
| `BUILD_COMMIT` | build-time env (optional) | `<release commit SHA>` |
| `STAGING_BASE_URL`, `STAGING_CONFIRM_HOST`, `STAGING_ACCESS_TOKEN` | certification script | `<staging URL>`, `<staging hostname>`, `<from secret store>` |
| `STAGING_WORKER_NAME`, `STAGING_D1_DATABASE_NAME`, `STAGING_D1_DATABASE_ID` | staging config script | `eduradius-staging`, `eduradius-staging`, `<uuid>` |

No new configuration was added in this candidate.

## Migration order

Inspect first with `node scripts/migration-status.mjs`, then apply only the pending files, in order: 0000 → 0001 → … → 0007. Every file is additive; 0007 is indexes only. Compatibility, interrupted-migration resume and rollback are in [OPERATIONS.md](OPERATIONS.md).

## Production acceptance checklist

- [ ] K1–K3 resolved; staging certification (48 checks and the browser journeys) passed on the exact release commit
- [ ] CI green on the release commit; `pnpm preflight --target production` passes
- [ ] Production backup taken; restore procedure confirmed and rehearsed on staging
- [ ] `migration-status` on production; only the listed files applied; `Up to date`
- [ ] Access variables set
- [ ] The [OPERATIONS.md](OPERATIONS.md) production release checklist is completed

## Production deployment steps (after authorization only)

1. Freeze the release commit and build with `BUILD_COMMIT=<sha> pnpm build`.
2. Take a production backup (platform procedure) and an owner export.
3. Inspect migrations, then apply exactly the pending files through the supported workflow, and re-inspect.
4. Configure access variables and secrets.
5. Deploy the matching artifact.
6. Verify `/api/health` reports the release commit and `/api/health/ready` returns 200.
7. Run anonymous checks: owner APIs return 401 and `/api/site` excludes private data. Have the owner sign in once (the legacy import runs) and verify counts against the snapshot.
8. Ask owners to reload open tabs. Watch the prepared signals manually (alerts are not active).
9. Rollback: choose from the rollback table in [OPERATIONS.md](OPERATIONS.md). Never redeploy the pre-workflow Site v5 code without first rebuilding its document.

## History: previous candidate `36ce7a1` (evidence kept as recorded)

These results apply to `36ce7a1` only. They are kept for traceability and are not evidence for `af555c9`.

### Automated results (candidate `36ce7a1`)

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | pass |
| `pnpm exec tsc --noEmit` | pass |
| `pnpm lint` | pass: 0 errors, 13 pre-existing `<img>` warnings |
| `pnpm test` | **96/96** (see the per-file breakdown below) |
| `pnpm build` | pass; build identity `36ce7a1a3de6` embedded |
| `pnpm test:worker` | **2/2** (built Worker, every migration, concurrent conversion) |
| `scripts/staging-certify.mjs` against the built Worker (local rehearsal, fresh migrated DB) | **36/36**; reported build matched the candidate; token and contact email absent from output and logs |
| `wrangler deploy --dry-run` with the generated staging config | pass: 1,137 KiB (316 KiB gzipped), bindings `DB`, `WORKSPACE_AUTH_MODE` |
| `pnpm audit --prod` | 23 advisories (4 low, 9 moderate, 7 high, 3 critical); triaged as K4 |
| `pnpm audit` (all) | 86 advisories including dev tooling |
| GitHub CI | `19c0fc6`: pass. Candidate: see the PR checks for the docs commit that follows it (code identical to the candidate) |

Per-file test breakdown:

| File | Tests |
| --- | --- |
| access | 34 |
| workflow | 20 |
| records | 10 |
| proposals | 8 |
| delivery | 8 |
| release | 7 |
| projects | 5 |
| preflight | 4 |

### Browser results (candidate `36ce7a1`, Chromium, local only)

| Suite | Result | Covers |
| --- | --- | --- |
| `tests/browser/contracting-journey.mjs` | **27/27** | The full Section 5 journey from public briefing to export and reload; correlation IDs; health; public exposure; mobile 390 px on the new pages and project tabs; no console errors |
| `tests/browser/journey.mjs` | **30/30** | Stage 1–2; legacy migration; keyboard open, Tab trap, Escape and focus return; dialog labels; empty versus whitespace reason; expired session keeping edits; downloads; mobile |
| `tests/browser/volume.mjs` | **9/9** | Long unbroken text and volume, desktop and mobile; timings below |
| Session-local auth suites (dev, built token, built unconfigured) | 22/22, 30/30, 17/17 | Sign-in, tampered cookies, re-sign-in after expiry keeping unsaved edits, sign-out, rate limits |
| Session-local regression suite | 38/38 | Navigation, downloads (byte-identical), save/reload, mobile |

These browser checks are **automated observations**, not manual testing and not a formal accessibility conformance assessment.

**Measured timings.** These are observations from a local dev server in a container on this machine, not targets.

| Condition | Measurement |
| --- | --- |
| 80 organizations, 80 opportunities, 50 requirements, 60 evidence | `/api/workflow` 79–98 ms, 1.3 MiB |
| About double that data (cumulative second seeding) | 2.5 MiB |
| Workspace load to network idle | 917–944 ms |
| Page renders | 99–250 ms |
| 50 long requirements | 293–370 ms |

