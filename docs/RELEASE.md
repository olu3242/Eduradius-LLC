# Release decision package

| | |
| --- | --- |
| Release candidate | **`6ba656ccabc2826a6f947cecdf669c62a77d000a`** on `claude/focused-archimedes-t13ibf` (draft PR #1) |
| Candidate archive | `eduradius-6ba656ccabc2-dist.tar.gz`, SHA-256 **`bb6449e70eaf84371c4cc33ba3d60ad0b2bdc684199861e75740bb1d3563c022`** (clean-checkout build; manifest and handling in [STAGING_HANDOFF.md](STAGING_HANDOFF.md)) |
| Code commits since `af555c9` | `f9b2eb5` browser-abort fix and diagnostics · `3000478` vinext/wrangler upgrade · `f2cac81` rollback conflicts (migration 0008) · `d48d0c4` preflight and staging safeguards · `0c7c724` test timing fix · `f301160` reproducible builds and candidate builder · `ae5e7fd`, `6ba656c` builder manifest and lint |
| Commits after the candidate | Documentation (`5d2be8e` and later) and the browser-series runner `0b355ad` (`tests/browser/`, not deployed). `git diff 6ba656c..HEAD -- app lib worker db drizzle package.json pnpm-lock.yaml pnpm-workspace.yaml next.config.ts vite.config.ts scripts` is empty |
| Earlier candidates | `af555c9` and `36ce7a1`. Their evidence is in the history sections and is not reused below |
| Evidence date | 2026-11-16 (business date America/Chicago) |
| Environment | Linux container, Node 22.23.4, pnpm 11.25.0, Wrangler 4.157.0 (Miniflare 5), vinext 1.4.4, Chromium via Playwright; local D1 only |

## Decisions

| Decision | Outcome | Basis |
| --- | --- | --- |
| **Local readiness** | **Ready** | See "Results" below for the candidate's checks. The contracting-journey abort was reproduced and fixed. The one remaining failed browser attempt was the intake rate limit refusing a sixth submission by design. |
| **Isolated hosted staging readiness** | **Not certified (blocked)** | No explicitly authorized, isolated staging target, account or credential exists (K1). [STAGING_HANDOFF.md](STAGING_HANDOFF.md) is ready for route A (Cloudflare token mode) or route B (isolated Sites). |
| **Production release readiness** | **Not recommended yet** | Requires certification on route B or an equivalent for the Sites-managed database: authentication (K3), backup/restore and migration tracking (K2). Route A alone does not certify Sites authentication. This is a recommendation, not deployment authorization. |

## What changed in this candidate

1. **Browser reliability.**
   - **Cause of the unexplained abort:** an aborted list request whose body was being read was reported as a success with an empty body. The cache merge then threw inside a React state update and unmounted the workspace.
   - **Reproduction:** 3 of 5 clean-database runs on the pre-fix code, with traces.
   - **Fix:** `call()` reports aborts and unreadable bodies as failures; lists ignore responses after unmount and validate their shape; a view-level error boundary contains a failing view.
   - **Diagnostics for every run:** `tests/browser/diagnostics.mjs` (redacted `diag.json` plus a Playwright trace on failure) and `run-series.mjs` (bounded isolated runs; every attempt recorded with the server log and a classification).
2. **Dependencies.**
   - vinext 1.4.4 (React 19.3.1), wrangler 4.157.0 with `@cloudflare/vite-plugin` 1.68.0, drizzle-kit 0.31.11, and overrides for esbuild (drizzle-kit) and minimatch (lint).
   - `pnpm audit` and `pnpm audit --prod`: **no known vulnerabilities** ([DEPENDENCIES.md](DEPENDENCIES.md)).
3. **Recovery.**
   - Rollback-window edits are no longer dropped silently. They become `import_conflicts` (migration **0008**) that the owner decides explicitly in Follow-ups: a reason is required, decisions are version-guarded, decided once, and recorded in activity.
   - The v5 tool refuses incomplete exports, oversize documents and unconfirmed runs, and embeds fingerprints of every item handed over.
   - The previous release is the preferred rollback.
4. **Migration preflight.** `migration-status` now also refuses:
   - malformed or failed inspections;
   - an empty result without confirmation;
   - objects that no migration creates;
   - `d1_migrations` tracking that disagrees with the schema.
5. **Staging safeguards.**
   - `staging-config` requires the account id and an exact confirmation of the complete target, and refuses production and placeholder identifiers (`scripts/production-identity.json`).
   - `staging-certify` requires `--expect-build` and creates no records unless liveness, the deployed build and readiness all pass.
6. **Reproducible candidate.**
   - `scripts/release/build-candidate.mjs` builds from a clean worktree with the frozen lockfile, checks the embedded and served identity and the absence of configuration or credentials, and writes a deterministic archive, SHA256SUMS and manifest.
   - `next.config.ts` uses the commit as the build id.
   - Builds are **not byte-identical**: vinext embeds per-build random keys. The archive is built once, deployed exactly as recorded, and stored privately.

## Results (candidate `6ba656c`, local)

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` (clean worktree), `tsc --noEmit`, `pnpm build` | pass |
| `pnpm lint` | 0 errors; the same 13 `<img>` warnings |
| `pnpm test` | **128/128**: access 34, workflow 20, pagination 14, records 10, recovery 9, proposals 8, delivery 8, release 7, projects 5, migration-preflight 5, preflight 4, staging-tools 4 |
| Flakiness check (unit) | 9 recorded full runs while preparing the candidate: 1 failed (a timing-dependent pagination assertion, fixed in `0c7c724`), 8 passed; 1 further run on `6ba656c` passed |
| `pnpm test:worker` | **2/2** |
| `pnpm audit --prod` / `pnpm audit` | **No known vulnerabilities** / **No known vulnerabilities** |
| Candidate archive (`build-candidate.mjs`) | Built from a clean checkout. Embedded identity, and served identity `6ba656ccabc2`; no `.env`, `.dev.vars` or `.pem` files; no credential patterns. SHA-256 `bb6449e7…c022` |
| Second clean build (`ae5e7fd`, same builder) | Same 339 files and normalized names; not byte-identical (random framework values). Documented, not fixed |
| Certification rehearsal on the **extracted archive** (built Worker, fresh 0000–0008, token mode) | **48/48**; build `6ba656ccabc2` matched; token and synthetic email absent from output and Worker log |
| Staging config and `wrangler deploy --dry-run` from the archive | pass: 1,411.76 KiB (404.64 KiB gzipped); bindings `DB`, `WORKSPACE_AUTH_MODE=token` |
| `migration-status` on Wrangler `--json` output (Miniflare 5) | `Up to date`; no unrecognised objects |
| GitHub CI (`verify`) | **pass** on `6ba656c` (also `3000478`, `ae5e7fd`, `5d2be8e`); later commits: see PR checks |

## Browser attempts (every attempt reported)

| Series | Code | Result |
| --- | --- | --- |
| Contracting journey, clean database ×4 (harness bug: server exit misattributed) | `310110b` + harness | 1 pass, 3 setup failures (harness defect, fixed) |
| Contracting journey, clean ×5, **before the fix** | `310110b` + harness | **2 pass, 3 abort**: the crash described above, with traces |
| Contracting journey, clean ×6, after the fix | pre-commit tree of `f9b2eb5` | 6 pass |
| Contracting clean ×5, journey clean ×2, on the upgraded stack | `f9b2eb5` + upgrade (pre-commit tree of `3000478`) | 5 pass, 2 pass |
| Recovery UI | pre-commit tree of `f2cac81` | 7/8, then 8/8. The first attempt's check ran before the list loaded (test timing, fixed) |
| **Contracting journey, clean ×6** | `6ba656c` | **6 pass** |
| **Contracting journey, repeated use ×6** (one database) | `6ba656c` | **5 pass, 1 failure**: attempt 6's briefing was refused with **429** by the intake limit (5 per 10 minutes per address). By design; the runner now classifies it (`0b355ad`) |
| **Contracting journey, repeated use ×5** | `5d2be8e` (code = `6ba656c`) | **5 pass** |
| **Stage 1–2 journey, clean ×2** | `6ba656c` | **2 pass** (30/30 each) |
| **Pagination UI** (synthetic dataset) | `5d2be8e` (code = `6ba656c`) | **16/16** |
| **Volume and long text** | `5d2be8e` (code = `6ba656c`) | **14/14** |
| **Recovery UI** (rollback conflicts) | `5d2be8e` (code = `6ba656c`) | **8/8** |

Every connected step from public briefing to export and reload is covered by the contracting journey:

> proposal review → submission → award → project → milestones → deliverable acceptance → change → closeout → private experience record → export → reload

Run outputs (summaries, server logs, and diagnostics for failures) are under the git-ignored `outputs/browser-series/` on the build machine. They are not committed, because traces may contain synthetic page content and the loopback session cookie.

**Unresolved uncertainty:**

- The original abort reported for `af555c9` (1 of 6) has no captured output. The reproduced crash matches its step and timing, but that link is inferred, not proven.
- No unexplained failure occurred in 28 contracting attempts after the fix: 27 passed, and 1 was the by-design intake refusal.

## Performance

See [PERFORMANCE.md](PERFORMANCE.md). On the upgraded stack (`6ba656c` code, same synthetic dataset), payloads are unchanged from `af555c9`:

- summary 22,125 bytes, 43 ms median;
- initial load 3 requests, about 21.8 KiB;
- the export is complete.

## Migrations, backup and recovery (candidate `6ba656c`)

| Scenario | Result |
| --- | --- |
| Fresh install (all 0000–0008, Wrangler) | Applied; status `Up to date` |
| Preflight CLI: empty / previous release (0006) / full / partial / failed / ambiguous | Refused without confirmation / prescribes 0007–0008 only / up to date / refused with resume statements / refused / refused (tests) |
| Without 0008 | Readiness reports the schema `incomplete`. 0008 must be applied before deploying |
| Rollback-window edits | Become open conflicts; tables unchanged until decided; keep and apply recorded; stale-record apply refused; re-import idempotent (tests, browser 8/8) |
| v5 tool | Refuses incomplete exports, documents over 700,000 characters, and runs without confirmation (tests) |
| Previous candidate `e07844b` on this release's data | Verified on `af555c9` data (0007). **Not re-run on 0008 data**; 0008 only adds a table that older code does not read |
| Hosted backup/restore, Sites migration tracking | **Not verified** (K2) |

## Security and data boundaries (verified locally)

- **New endpoint:** `GET /api/import-conflicts` is owner-only like every read endpoint. Conflict decisions go through the owner-only, CSRF-protected actions route.
- **Staging tools:** they refuse production identifiers and need exact target confirmation. Certification creates no records unless the target is the expected, ready build. The token never appears in output (tests and rehearsal).
- **The candidate archive** holds no local configuration or credentials from this repository. It does hold vinext's per-build preview and Server Actions keys, so store it privately.
- Earlier boundaries are unchanged; see the history sections.

## Known issues and blockers

| ID | Issue | Severity | Next action |
| --- | --- | --- | --- |
| K1 | No authorized isolated staging target | **Blocker** (hosted and production) | Owner decision; see the end of this document and [STAGING_HANDOFF.md](STAGING_HANDOFF.md) |
| K2 | Sites-managed D1: backup/restore and migration tracking unconfirmed | **Blocker** (production) | Confirm with the platform; certify on route B |
| K3 | Hosted Sign in with ChatGPT and owner allowlist not verified; no runtime variables on the Site | **Blocker** (production on Sites) | Route B certification |
| K4 | Dependency advisories | **Resolved**: audit clean | Keep auditing per release |
| K6 | Token mode is a shared credential (no individual attribution) | Medium | Decide the auth mode per environment |
| K7 | No file uploads | Low (by design) | — |
| K8 | Accessibility checks are structural only | Medium | Screen-reader and contrast audit |
| K9 | vinext 1.x and Miniflare 5 **beta** in local tooling | Medium | Track releases; re-verify on upgrade |
| K10 | Open tabs during deploy get 409 on save | Low (expected) | In the checklist |
| K11 | The original `af555c9` abort has no captured output (see Browser attempts) | Low | Diagnostics now capture any recurrence |
| K12 | Substring search without a full-text index | Low | Measure on staging |
| K13 | v5 rollback only fits up to 700,000 characters; the previous release is preferred | Medium (recovery) | Owner decision on whether v5 must stay possible |
| K14 | The client cache grows within a session | Low | Bound if needed |
| K15 | Builds are not byte-reproducible (vinext per-build keys); the archive holds framework keys | Medium (release process) | Deploy the recorded archive only; store it privately |
| K16 | `minimatch` 11 is forced outside typescript-estree's declared `^10` range (lint only) | Low | Drop the override when typescript-eslint moves to 11 |

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

Inspect first with `node scripts/migration-status.mjs` (see the exit codes in [OPERATIONS.md](OPERATIONS.md)). Then apply only the pending files, in order: 0000 → … → 0008. All are additive. Apply 0008 before deploying this code.

## Production acceptance checklist

- [ ] K1–K3 resolved. Staging certification recorded per [STAGING_HANDOFF.md](STAGING_HANDOFF.md) §12 on `6ba656c` and archive `bb6449e7…c022`, including route B for Sites authentication
- [ ] CI green on the release commit; `pnpm preflight --target production` passes
- [ ] Production backup taken; restore confirmed and rehearsed
- [ ] `migration-status` on production; only the listed files applied; `Up to date`
- [ ] Access variables set
- [ ] The [OPERATIONS.md](OPERATIONS.md) production checklist is completed

## Production deployment steps (after authorization only)

1. Verify the archive checksum and deploy **that archive**. Do not rebuild.
2. Take a backup (platform procedure) and an owner export.
3. Inspect migrations, apply exactly the pending files, and re-inspect.
4. Configure access variables and secrets; deploy.
5. Check `/api/health` (build `6ba656ccabc2`) and `/api/health/ready` (200); run the anonymous checks; the owner signs in once (import) and verifies counts.
6. Rollback: redeploy the previous release first ([OPERATIONS.md](OPERATIONS.md)). Use the v5 path only when necessary, within its limits.

## Decision required

Choose one isolated staging route and authorize it ([STAGING_HANDOFF.md](STAGING_HANDOFF.md) §2–5):

- **Route A (Cloudflare token mode).** Name a Cloudflare account and approve its Workers and D1 usage. Create an API token limited to Workers Scripts: Edit and D1: Edit on that account, and keep it in your secret store. It certifies the application, the migrations and backup/restore, but **not** Sites sign-in.
- **Route B (isolated Sites).** Create a separate, non-production Site with its own database and a staging owner account. It certifies Sign in with ChatGPT, the owner allowlist and Sites-managed migrations and backup. It is required before production on Sites.

## History: candidate `af555c9` (evidence kept as recorded)

These results apply to `af555c9` only.

### Automated results (candidate `af555c9`)

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

### Browser results (candidate `af555c9`, Chromium, local dev server)

| Suite | Result | Covers |
| --- | --- | --- |
| `tests/browser/journey.mjs` (fresh database with a legacy document) | **30/30** | Briefing → review → convert; legacy import; follow-ups; dialogs; persistence; export |
| `tests/browser/contracting-journey.mjs` | **27/27** in 5 of 6 runs. One run aborted; its output was not captured and the failure did not recur in 4 further runs, including the same fresh-database sequence (K11) | Briefing → opportunity → requirements/evidence → proposal review → submission → award → project → acceptance → change → closeout → experience → export → reload, with pickers searched beyond the first 20 choices |
| `tests/browser/pagination-ui.mjs` (synthetic dataset) | **16/16** | A slower superseded search response is discarded; empty state and filter reset; error and retry with state kept; Enter on "Load more" keeps focus; polite live count; pickers make no requests until used; keyboard search and selection beyond the first 20 choices; accessible names for every control; no overflow at 390 px |
| `tests/browser/volume.mjs` | **14/14** | Long unbroken text, desktop and mobile; one bounded page then "Load more"; server search reaching the oldest record; summary under 64 KiB |

These are **automated observations**, not manual testing and not a formal accessibility conformance assessment.

### Migrations, backup and recovery (candidate `af555c9`)

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

