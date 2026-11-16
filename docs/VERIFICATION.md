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
