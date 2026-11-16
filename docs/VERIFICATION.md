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
