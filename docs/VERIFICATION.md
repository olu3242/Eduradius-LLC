# EduRadius verification and preview readiness

## Iteration 2: desktop browser verification

Verified in the managed browser against the PR source and an isolated local D1
database. Only clearly named test records were entered; no live database or
hosted runtime settings were changed.

| Flow | Result | Evidence |
| --- | --- | --- |
| Capability tab selection | Passed | Governance tab selects and displays its matching panel |
| Sector briefing CTA | Fixed and passed | Previously produced a rejected sector-specific request kind; now selects Project briefing and preserves the selected sector |
| Public briefing submission | Passed | Success feedback shown; submitted test request visible in owner Client requests |
| Owner access prompt | Passed locally | Anonymous workspace shows sign-in; local development sign-in opens owner workspace |
| Sign-in keyboard focus | Fixed and passed | Focus starts in dialog; Shift+Tab and Tab wrap between its controls |
| Owner follow-up notes | Passed | Edited notes saved, then confirmed after full-page reload |
| Opportunity creation | Passed | Added a test opportunity, set one qualification check, applied and saved |
| Opportunity persistence | Passed | Saved title and 1/5 qualification state confirmed after full-page reload |
| Sign-out | Passed locally | Sign-out returns to company page; workspace requires sign-in again |

The browser sign-in above uses the documented loopback development identity.
It does not certify hosted Sign in with ChatGPT or hosted owner allowlisting.
Mobile layouts, all downloads, and full accessibility conformance were not
certified in this iteration.

## Reproducible checks

- `pnpm test`: 34 route/helper tests, including all six shared request kinds and
  sector persistence. Runs both SQL migrations against isolated SQLite.
- `pnpm test:worker`: two HTTP smoke tests against the built Worker and local D1.
- `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm build` are the remaining CI gates.
- Lint currently has 13 non-blocking direct-image advisories and zero errors.

See README.md for commands. Browser observations above are manual evidence,
not an additional automated test count.

## Hosted preview gate

The existing Site's runtime variable inventory was read during this iteration;
it contained no entries. The configuration interface is available, but these
required values are not set:

- `WORKSPACE_AUTH_MODE=sites`
- At least one owner allowlist: `WORKSPACE_OWNER_IDS` or `WORKSPACE_OWNER_EMAILS`

Before publishing this revision, configure the intended environment and apply
`drizzle/0001_access_protection.sql` to its database through the supported hosting
workflow. Verify the owner account, an authenticated non-owner, an anonymous
visitor, public intake, and persistence on that isolated hosted target.

For non-Sites Worker hosting, use token mode with a securely generated access key
and equivalent protection. Never trust client-supplied Sites identity headers on
a standalone public origin.

The existing Site is not an isolated staging target. This iteration did not
publish, merge the draft PR, modify its audience, set runtime variables, or apply
any hosted migrations. Hosted certification remains pending.

## Iteration 3: connected intake and opportunity workflow (local only)

The checks below ran against this revision on Node 22.23.4 with pnpm 11.25.0, with an isolated local D1 database (`.wrangler/state`) seeded with a **legacy-shaped document**. That document had one inquiry with status `Tentative`, one opportunity and one activity entry, all written in the pre-workflow format. No hosted environment, live database or runtime setting was used or changed.

| Check | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | Passed |
| `pnpm lint` | Passed: 0 errors, 13 existing direct-image warnings (unchanged) |
| `pnpm test` | 58/58: access (34), workflow (20), preflight (4) |
| `pnpm build` | Passed; new routes `/api/workflow`, `/api/inquiries/:id`, `/api/inquiries/:id/convert`, `/api/opportunities[/:id]`, `/api/notifications` |
| `pnpm test:worker` | 2/2 against the built Worker with every migration applied, including a concurrent double conversion (one 201, one 200 `alreadyConverted`, one opportunity) |
| `tests/browser/journey.mjs` (dev server, Chromium) | 30/30 |
| Additional browser regression suites (dev server and built Worker in token/unconfigured modes) | 38/38, 22/22, 30/30, 17/17 |
| Local backup/restore (file copy of `.wrangler/state`) | Restored copy returned identical record counts |

The browser journey covered:

- **Public submission:** a request submitted through the public form, with no claim that email was sent.
- **Legacy migration:** the seeded request appeared with status `Tentative` mapped to `Reviewing`.
- **Keyboard dialog:** opened with Enter, Tab trapped, Escape closed it and returned focus.
- **Labels:** every dialog control has a label.
- **Review:** assign, schedule a follow-up due today in Central Time, then qualify. An empty reason was blocked by the form; a whitespace-only reason was rejected by the server with a visible alert.
- **History:** recorded reviewed, assignment, follow-up and status events.
- **Follow-ups:** the item appeared under Due today and under Ready to convert.
- **Conversion:** the review was prefilled, the success state showed, and the resulting opportunity opened with the carried-over contact.
- **Retry:** returned the existing opportunity; exactly one is linked.
- **Persistence:** after a reload, the converted request and the migrated legacy opportunity both remained.
- **Export:** `schemaVersion: 2` containing every collection.
- **Public data:** `/api/site` has no workflow content.
- **Downloads:** five brand downloads byte-identical to the published files.
- **Mobile (390 px):** the menu reaches Follow-ups, there is no horizontal overflow, and the review dialog fits.
- **Console:** no unexpected errors.

**Not verified in this iteration:**

- hosted Sites sign-in and owner allowlisting;
- any staging or production deployment;
- the hosted D1 backup and restore procedure;
- screen-reader output (only structural checks: labels, dialog naming, focus, live regions);
- browsers other than Chromium;
- a formal WCAG conformance assessment.

The browser journey is a local script, not part of CI.

## Iterations 4–5: Stages 3–4 and the release candidate (local only)

Stages 3–4 (contracting and delivery) were built in four committed increments (`0c8c293`, `83c0564`, `f204304`, `56ab3f2`) and documented in [CONTRACTING.md](CONTRACTING.md). The release candidate **`36ce7a1`** adds health and readiness checks, request correlation, log redaction and staging tooling.

Results for the candidate, including the requirements-to-evidence matrix, acceptance evidence, known issues and readiness decisions, are in [RELEASE.md](RELEASE.md). In summary:

- 96/96 tests, 2/2 built-Worker smoke tests, and 36/36 certification checks against the built Worker (a local rehearsal).
- 173 automated browser checks.
- Lint clean (0 errors) and the build passes.
- Empty-database, earliest-version and interrupted-transaction migration tests pass, and local backup/restore is verified.

Hosted staging is **not certified**: no authorized isolated target exists ([STAGING.md](STAGING.md)).

## Iteration 6: dependencies, pagination and recovery (candidate `af555c9`, local only)

Environment: Linux container, Node 22.23.4, pnpm 11.25.0, Wrangler 4.92.0, Chromium (Playwright), local Miniflare D1. No hosted environment, live database or runtime setting was used or changed.

| Check | Commit | Result |
| --- | --- | --- |
| Dependency audit before / after | `e07844b` → `55bb85c` | prod 23 → 0; all 86 → 4 (dev/build only); [DEPENDENCIES.md](DEPENDENCIES.md) |
| tsc, lint, 96 tests, build, worker smoke, journeys 30/30 and 27/27 on the upgraded dependencies | `55bb85c` | pass |
| Type check, lint (0 errors), `pnpm test` 115/115, build, `pnpm test:worker` 2/2 | `af555c9` | pass |
| Certification rehearsal against the built Worker (fresh 0000–0007, token mode) | `af555c9` | 48/48; build matched; no token or email in output or logs |
| Staging dry-run deploy | `af555c9` | 1,185.38 KiB (329.46 KiB gzipped) |
| Browser: `journey.mjs` (legacy document) | `af555c9` | 30/30 |
| Browser: `contracting-journey.mjs` | `af555c9` | 27/27 in 5 of 6 runs; one aborted run not reproduced (K11) |
| Browser: `pagination-ui.mjs`, `volume.mjs` (synthetic dataset) | `af555c9` | 16/16, 14/14 |
| Before/after measurements, same dataset | `e07844b` vs `af555c9` | [PERFORMANCE.md](PERFORMANCE.md) |
| Migration status: local file, and Wrangler `--json` output from the local D1 | `af555c9` | correct on 0007-applied and 0006 databases. A `pragma_table_info` query was found to be refused by D1 (`SQLITE_AUTH`), so the tool reads only `sqlite_master` and fails closed on errors |
| Backup with `wrangler d1 export --local`, restore into an empty state | `af555c9` | owner export identical before and after |
| Previous candidate on this release's data | `e07844b` code, `af555c9` data | identical records; contracting journey 27/27 |
| Code-only v5 rollback after the import (original v5 handler from `2af4266`) | — | v5 sees no requests or opportunities; its save returns 400 |
| v5 rollback with `scripts/recovery/legacy-document.mjs`, then forward | `af555c9` | v5 read and saved (200); forward import added only the v5-period request; no duplicates; contracting records identical |

Defects found and fixed during this iteration:

- the evidence `state=usable`/`rejected` filters bound an unused parameter (D1 rejected the query);
- `__proto__` as a list type returned 503 instead of 404;
- the summary carried full opportunity notes;
- every evidence picker loaded on mount (32 requests when opening a pursuit);
- the migration status tool advised applying every file when given a failed query result.

## Iteration 7: reliability, recovery, preflight and reproducible candidate (candidate `6ba656c`, local only)

Environment: Linux container, Node 22.23.4, pnpm 11.25.0, Wrangler 4.157.0 (Miniflare 5), vinext 1.4.4, Chromium (Playwright). No hosted environment was used.

| Check | Commit | Result |
| --- | --- | --- |
| Contracting-journey abort reproduced on clean databases (diagnostics and traces captured) | `310110b` | 3 of 5 aborted: a workspace crash after an aborted list request |
| Same series after the fix | `f9b2eb5` | 6/6 |
| Upgrade (vinext 1.4.4, wrangler 4.157.0): tsc, lint, 115 tests, build, worker smoke, `db:generate`, staging dry run | `3000478` | pass; `pnpm audit`: no known vulnerabilities |
| Unit suite | `6ba656c` | 128/128. 9 recorded full runs while preparing the candidate: 1 failure (timing-dependent assertion, fixed in `0c7c724`) |
| Built-Worker smoke | `6ba656c` | 2/2 |
| Candidate archive from a clean worktree | `6ba656c` | SHA-256 `bb6449e7…c022`; served identity `6ba656ccabc2`; no configuration or credential files |
| Certification rehearsal on the extracted archive | `6ba656c` | 48/48; no token or email in output or logs |
| Browser: contracting clean ×6 / repeated ×6 / repeated ×5 | `6ba656c` / `6ba656c` / `5d2be8e` (same code) | 6/6 / 5/6 (one 429 from the intake limit by design) / 5/5 |
| Browser: Stage 1–2 ×2, pagination UI, volume, recovery UI | `6ba656c` / `5d2be8e` (same code) | 2/2, 16/16, 14/14, 8/8 |
| `migration-status` against Wrangler `--json` on Miniflare 5 | `6ba656c` | correct; no unrecognised objects |

Defects found and fixed:

- The workspace crashed after an aborted mid-body response.
- The series harness misattributed an earlier server's exit to the next attempt.
- A pagination test assumed creation order within one millisecond.
- The recovery browser check read the list before it had loaded.
- The release build id was random.
- The candidate builder looked for the identity in the wrong file, and archived after serving.
