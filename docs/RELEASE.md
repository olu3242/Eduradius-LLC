# Release decision package

| | |
| --- | --- |
| Release candidate | **`36ce7a1a3de6cd9f06a26894383d7e3c6fb55ac8`** on `claude/focused-archimedes-t13ibf` (draft PR #1) |
| Starting commit for release work | `19c0fc6dd77d27a55f1b5bac424d164d4061af3d` |
| Evidence date | 2026-11-16 (business date America/Chicago) |
| Environment | Linux container, Node 22.23.4, pnpm 11.25.0 (corepack), Wrangler 4.92.0, Chromium via Playwright; isolated local D1 (Miniflare) only |

The commit that adds this document changes only documentation. Every result below was produced against the candidate commit's code.

## Decisions

| Decision | Outcome | Basis |
| --- | --- | --- |
| **Local readiness** | **Ready** | All CI gates, 96 unit and integration tests, 2 built-Worker smoke tests, 36 HTTP certification checks against the built Worker and 173 browser checks pass on the candidate. The empty database, the earliest version (0000), the interrupted-transaction case and backup/restore are verified. |
| **Isolated hosted staging readiness** | **Not certified (blocked)** | No explicitly authorized, isolated staging target, account or credential exists. Tooling and runbook are prepared and rehearsed locally ([STAGING.md](STAGING.md)). |
| **Production release readiness** | **Not recommended yet** | This requires hosted staging certification, confirmed backup/restore for the production D1, configured access variables, and hosted verification of Sites sign-in. A dependency upgrade is also recommended. This is a recommendation, not deployment authorization. |

## Requirements-to-evidence matrix

Status values: Implemented / Partially implemented / Missing / Blocked / Not verified. "Hosted" behavior is **Not verified** everywhere, because no staging environment exists.

| Area | Status | Code | Automated evidence | Browser evidence | Remaining |
| --- | --- | --- | --- | --- | --- |
| Authentication and owner access | Implemented locally; hosted Not verified | `lib/server/access.ts`, `owner-route.ts` | access.test (34), workflow/records authorization tests, release readiness test, `staging-certify` (forged headers, invalid bearer, tampered cookie) | e2e-auth dev 22/22, built-token 30/30, unconfigured 17/17 | Hosted Sign in with ChatGPT and owner allowlist |
| Public website and briefing submission | Implemented | `app/page.tsx`, `api/inquiries`, `api/site` | intake validation, internal-field rejection, rate limit, size limit, honeypot, public projection tests | regression 38/38; journey (briefing → stored) | — |
| Inquiry review, assignment, follow-up | Implemented | `lib/workflow.ts`, `workflow-store.ts`, `workflow.tsx` | transitions, reasons, follow-ups, timezone/DST, actor integrity | journey 30/30; contracting journey | — |
| Inquiry → opportunity conversion | Implemented | `convertInquiry` | mapping, duplicate and concurrent conversion, retries | both journeys | — |
| Organizations, contacts, teaming | Implemented | `lib/records.ts`, `records-store.ts`, `actions.ts` | duplicate detection, explicit merge with conflicts, link-existing rerun, cross-org contact rejection, teaming rules | contracting journey; increment smoke checks | — |
| Requirements and evidence | Partially implemented | requirement and evidence specs; `evidence_links` | Evidence needed vs Not met, Met requires current evidence, https-only links, link validation | contracting journey | **File uploads: Blocked** (no private storage binding); reference-only by design |
| Proposal versions, review, submission | Implemented (owner review) | proposal actions | immutable versions, invalid transitions, edit-after-approval, verified sections, exact-version submission, duplicate submission | contracting journey (request changes → revise → approve v2 → submit) | Independent second reviewer: Missing by design |
| Award confirmation and project creation | Implemented | `submission.recordOutcome`, `project.createFromAward` | award prerequisites, concurrent/duplicate creation, outcome lock, interrupted-batch rollback | contracting journey | — |
| Milestones, deliverables, acceptance | Implemented | delivery specs and actions | cycles, cross-project refs, completed-work lock, version preservation, internal vs client acceptance, verified evidence | contracting journey (revision → v2 client acceptance) | — |
| Change control and closeout | Implemented | `changeRequest.decide`, `project.closeout` | approved vs rejected baselines, decided-once, blocked closeout, exceptions, reopen keeps closeouts, cancellation separate | contracting journey | — |
| Private experience records | Implemented | `experience.*` | completed-only, private default, permission and outcome evidence, provenance, edit withdraws approval | contracting journey | Public publication: Missing by design |
| Reporting and exports | Implemented; known scaling issue | `lib/reports.ts`, `exportBundle` | metric definitions, zero vs no data vs unavailable, horizon boundaries, export completeness | contracting journey; volume 9/9 | `/api/workflow` is unpaginated (K5) |
| Operations (health, logs, correlation) | Implemented | `lib/server/health.ts`, `request-context.ts`, `worker/index.ts` | readiness states, redaction, correlation | contracting journey (x-request-id, health) | Alerts prepared, not activated |
| Migrations and recovery | Implemented; hosted Not verified | `drizzle/0000–0006` | empty DB, 0000 → 0006 upgrade, 0001 → later upgrade, legacy import rerun, interrupted operation | fresh-database loop (26 tables); local backup/restore | Hosted D1 backup/restore procedure |

## Automated results (candidate `36ce7a1`)

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

## Browser results (candidate `36ce7a1`, Chromium, local only)

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

## Migrations, backup and recovery

| Scenario | Result |
| --- | --- |
| Empty database, `drizzle/0*.sql` in order (real Wrangler, fresh state) | All 7 apply; 26 tables |
| Earliest version (0000 only, Site v5 JSON document) → 0001–0006 | Records, IDs, notes and checks preserved; legacy import; verbatim snapshot; upgraded data usable by new features (release test) |
| 0001 → later | Covered by workflow test |
| Backfills and imports rerun | Legacy import and link-existing are idempotent (tests) |
| Interrupted multi-record operation | A batch failing mid-way leaves no partial rows; the retry succeeds (release test) |
| Concurrent edits | One wins, the other gets 409 with the current record |
| Local backup/restore | Copied the database (complete synthetic journey) and restored it to a new state directory; identical counts across inquiries, opportunities, proposal versions, projects, baselines, deliverable versions, experience and activity |
| Hosted D1 backup/restore | **Not verified.** Commands documented (`wrangler d1 export --remote`, `d1 time-travel info/restore`); the Sites-managed procedure is unconfirmed |

Schema migrations are additive and are **not reversed** in recovery. Recovery means forward repair (drop the objects of a failed file and rerun it) or restoring the pre-migration backup ([OPERATIONS.md](OPERATIONS.md)).

## Security and data boundaries (verified locally)

- **Owner API denials:** anonymous, wrong-token, forged Sites headers in token mode, tampered and expired cookies, non-owner Sites identity (403), missing configuration (503) and an invalid mode are all denied on every owner API.
- **CSRF:** cross-origin writes and `sec-fetch-site: cross-site` are rejected.
- **Limits:** streaming byte limits apply to bodies; intake and sign-in are rate-limited.
- **Public intake** rejects internal fields (status, assignee, notes, IDs, version) and never claims email delivery.
- **Audit integrity:** actors and timestamps are server-generated; request-body actor and time are ignored (tested).
- **Public exposure:** `/api/site` and the public page contain no workflow, contact, proposal, evidence, project or experience data (tests and browser).
- **Logs:** sensitive keys are redacted; no token or contact email appeared in rehearsal logs. Health endpoints expose ok/not-ok and the build only.
- **Accountability:** token mode is a shared credential, attributed as `token:session` or `token:bearer`, with no individual attribution ([OPERATIONS.md](OPERATIONS.md)).
- **No private uploads exist**, so there is no private retrieval to test.

## Acceptance evidence

Each row follows the same pattern: the scenario was run against source commit `36ce7a1`, the expected behavior was observed, and the result is a pass.

| Requirement | Scenario | Expected and observed behavior | Evidence |
| --- | --- | --- | --- |
| Public submitters cannot set internal fields | POST intake with status, assignee, notes, IDs or version | 400; nothing stored | workflow.test; certify |
| Duplicate submissions and retries | Concurrent conversion and project creation | One record; the other caller gets `already*` | workflow, projects tests; certify |
| Stale revisions | PATCH with an old version | 409 with the current record | multiple tests; certify |
| Database unavailability | No D1 binding | Intake and sign-in 503; readiness `database: unavailable` | access.test; release.test |
| Missing or expired evidence | Met, approval or client acceptance with unverified or expired evidence | 400 | records, proposals, delivery tests |
| Invalid transitions | Approve a draft, submit before approval, project before award, Closed via transition | 409/400 | tests; certify |
| Session expiry during unsaved work | Clear cookies, edit, save | Sign-in dialog; edits kept; save after re-sign-in | journey 30/30; built-token 30/30 |
| Internal vs external acceptance | Internal approval vs client acceptance | Internal approval labelled not client acceptance; client acceptance needs authority and verified evidence | delivery.test; contracting journey |
| Submission is not an award | Project from a Pending submission | 409 | projects.test; certify |
| Synthetic labelling | Journey and certify data | Labels `SYNTHETIC…`, `J…`, `V…`; example.test emails | scripts |

**Human acceptance still required:**

- owner sign-off on wording and branding;
- hosted Sites sign-in;
- screen-reader and cross-browser review;
- the business rules (statuses, closeout checklist, publication criteria).

## Known issues and blockers

| ID | Issue | Severity | Impact | Workaround | Owner / decision | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| K1 | No authorized isolated staging target | **Blocker** (hosted and production) | Hosted behavior uncertified | Local rehearsal only | Owner: authorize a staging Worker + D1 (or an isolated Site) and provide a scoped credential | Follow [STAGING.md](STAGING.md); run `staging-certify.mjs` and the browser journey |
| K2 | Hosted D1 backup/restore procedure unconfirmed (Sites-managed) | **Blocker** (production) | Recovery from a bad migration is uncertain | None for Sites; documented D1 commands for Cloudflare | Owner/platform | Confirm the procedure and rehearse it on staging |
| K3 | Hosted Sign in with ChatGPT and owner allowlist not verified; the Site has no runtime variables set | **Blocker** (production on Sites) | Workspace would be locked (503) after deploy | Token mode on another host | Owner | Set `WORKSPACE_AUTH_MODE=sites` and `WORKSPACE_OWNER_IDS` on the target; verify owner, non-owner and anonymous |
| K4 | Dependency advisories: `next@16.3.4` (3 critical, 3 high), `zod@3`, `sharp`, `browserslist`, `source-map-js`, `fast-uri` | High (supply chain) | Build-artifact inspection found **no `next` package code** in the Worker or client bundles, and `zod` isn't bundled; exposure is limited to build/dev tooling | Dev server bound to loopback | Engineering | Upgrade `next`/`eslint-config-next` to ≥16.4.1 in a dedicated, fully re-tested change; evaluate `zod` 4; re-audit |
| K5 | `/api/workflow` returns all records unpaginated | Medium (scalability) | Measured 1.3–2.5 MiB at the stated volumes | Export and archive old records | Engineering | Paginate or lazy-load per section |
| K6 | Shared-credential accountability in token mode | Medium (governance) | Activity can't identify individuals | Use `sites` mode with an allowlist | Owner | Decide the hosting/auth mode per environment |
| K7 | No file uploads (no private storage) | Low (by design) | Evidence and deliverables are references or links | Store files in a private drive and reference them | Owner | Authorize R2 if uploads are needed (backlog) |
| K8 | Accessibility checks are structural only | Medium | Not a WCAG conformance claim | — | Owner | Screen-reader and contrast audit (backlog) |
| K9 | vinext is a beta framework (`1.0.0-beta.5`) | Medium | Framework defects possible | Pinned lockfile; CI | Engineering | Track vinext releases; re-verify on upgrade |
| K10 | Open workspace tabs during deploy get 409 on save | Low (expected) | Owner must reload | Reload | — | Included in the release checklist |

## Configuration (names and placeholders only)

| Name | Kind | Placeholder |
| --- | --- | --- |
| `WORKSPACE_AUTH_MODE` | variable | `sites` or `token` |
| `WORKSPACE_OWNER_IDS` / `WORKSPACE_OWNER_EMAILS` | variable (sites) | `<comma-separated>` |
| `WORKSPACE_ACCESS_TOKEN` | **secret** (token) | `<openssl rand -base64 32>` |
| `DB` | D1 binding | `<staging or production database>` |
| `BUILD_COMMIT` | build-time env (optional) | `<release commit SHA>` |
| `STAGING_BASE_URL`, `STAGING_CONFIRM_HOST`, `STAGING_ACCESS_TOKEN` | certification script | `<staging host>`, `<staging host>`, `<from secret store>` |
| `STAGING_WORKER_NAME`, `STAGING_D1_DATABASE_NAME`, `STAGING_D1_DATABASE_ID` | staging config script | `eduradius-staging`, `eduradius-staging`, `<uuid>` |

Check with `pnpm preflight --target <local|staging|production>`; it prints names only.

## Migration order

Apply 0000 → 0001 → 0002 → 0003 → 0004 → 0005 → 0006. All are additive; compatibility notes are in [OPERATIONS.md](OPERATIONS.md). Apply every migration before deploying this code, because the workflow payload reads every table. The legacy JSON import runs on the first owner load. Organization linking is an explicit owner action.

## Production acceptance checklist

- [ ] K1–K3 resolved, and staging certification passed on the exact release commit (`staging-certify.mjs` plus the browser journey on staging)
- [ ] K4 decision recorded (upgrade completed, or risk accepted in writing)
- [ ] CI green on the release commit; `pnpm preflight --target production` passes
- [ ] Production backup taken; restore procedure confirmed and rehearsed on staging
- [ ] Access variables set (`sites` + owner allowlist, or `token` + secret)
- [ ] The [OPERATIONS.md](OPERATIONS.md) production release checklist is completed

## Production deployment steps (after authorization only)

1. Freeze the release commit and build with `BUILD_COMMIT=<sha> pnpm build`.
2. Take a production backup (platform procedure; for Cloudflare, `wrangler d1 export <db> --remote --output …` and record a `d1 time-travel info` bookmark).
3. Apply migrations 0000–0006 in order to the production D1 through the supported workflow. Already-applied files are skipped by the platform's migration tracking, or by the operator.
4. Configure access variables and secrets.
5. Deploy the matching artifact.
6. Verify `/api/health` reports the release commit and `/api/health/ready` returns 200.
7. Run anonymous checks: owner APIs return 401, and `/api/site` excludes private data. Have the owner sign in once, which runs the legacy import; verify record counts against the snapshot.
8. Ask owners to reload open tabs. Watch the prepared alert signals manually for the first hours (alerts are not active).
9. Rollback: redeploy the previous artifact. Migrations stay applied because they are additive; restore from backup only if data is affected ([OPERATIONS.md](OPERATIONS.md)).
