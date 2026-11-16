# EduRadius LLC

Company website and reusable contracting workspace, with the approved Radius identity and downloadable brand assets.

## Included
- AI consulting, AI governance, AI adoption, training and education
- Service intake, NAICS/PSC reference and editable primary-code selection
- SAM/CAGE/UEI tracking, SF-330 notes, annual receipts input
- Opportunity qualification, checklists, statuses and readiness dashboard
- Illustrative service/sector imagery and editable six-stage engagement lifecycle
- SVG/PNG logos, brandbook, templates and full brand package

## Run locally
Use Node.js >=22.13 and the pnpm version pinned in package.json.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The clean-clone default is the portable runtime. The URL is printed by the dev server. The workspace API requires the local D1 schema: build once, then apply each migration in `drizzle/` in order to the local `DB` binding (see [runtime notes](docs/SITES_RUNTIME.md) for preview, bindings and build details):

```sh
for f in drizzle/0*.sql; do   # every migration, in numeric order
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$f"
done
```

In `pnpm dev`, open `/workspace` and choose **Sign in** (the loopback-only mock sign-in). For `pnpm start` (built Worker), configure access in `dist/server/.dev.vars` after each build (see below).

```sh
pnpm exec tsc --noEmit
pnpm build
```

## Hosting and access
The existing Site is hosted privately at https://eduradius-contract-workspace.olufemi-adey-1577.chatgpt.site. This GitHub import does not configure automatic deployment. The .openai/hosting.json file retains the existing Site identity.

No hosted records, credentials, local database state or registration submissions are included in this repository.

## Workspace access protection
The API enforces access server-side; it no longer depends only on the host policy.

| Route | Access | Purpose |
|---|---|---|
| `GET/PUT /api/workspace` | Owner only | Full workspace read/save (optimistic revisions) |
| `GET /api/site` | Public | Only the fields the company site renders; no inquiries, opportunities, documents, receipts or notes |
| `POST /api/inquiries` | Public, append-only | Validated intake into the `inquiries` table; internal fields rejected; 5 per 10 min per client; honeypot |
| `GET /api/workflow`, `PATCH /api/inquiries/:id`, `POST /api/inquiries/:id/convert`, `POST/PATCH /api/opportunities[/:id]`, `POST /api/notifications` | Owner only | Connected intake → opportunity workflow ([docs/WORKFLOW.md](docs/WORKFLOW.md)) |
| `POST /api/records/:type`, `PATCH /api/records/:type/:id`, `POST /api/actions/:name` | Owner only | Organizations, evidence, requirements, proposals, submissions, projects, delivery, closeout and experience ([docs/CONTRACTING.md](docs/CONTRACTING.md)) |
| `GET/POST/DELETE /api/auth/session` | Public | Session status; token sign-in (10 attempts per 10 min); sign-out |

Configure with Worker variables/secrets:

| Variable | Notes |
|---|---|
| `WORKSPACE_AUTH_MODE` | `sites` or `token`. **Unset: built Workers deny all owner access (503).** The Vite dev server defaults to `sites` with mock sign-in. |
| `WORKSPACE_OWNER_IDS` / `WORKSPACE_OWNER_EMAILS` | `sites` mode, comma-separated; required outside dev. Trusts `oai-authenticated-user-*` headers, so use `sites` **only** behind the Sites dispatch, which strips client-supplied copies. |
| `WORKSPACE_ACCESS_TOKEN` | `token` mode secret, at least 32 characters (`openssl rand -base64 32`). Exchanged for a 12-hour HMAC-signed `HttpOnly; SameSite=Strict` cookie (`Secure` on HTTPS); `Authorization: Bearer` also accepted. Rotating it revokes all sessions. Store it as a secret, never a plain var. |

Every environment, including production, must apply migrations in order: `0001_access_protection.sql` (`rate_limits`; intake and token sign-in fail closed without it), then `0002_connected_workflow.sql` through `0006_delivery_closeout.sql` (workflow, contracting and delivery tables; all additive). Existing inquiries, opportunities and activity move out of the workspace document automatically on the first owner load, with a snapshot of the original. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for environments, backup/restore, recovery and release checklists, and run `pnpm preflight --target <local|staging|production>` to check configuration without printing values.

## Connected workflow
**Client requests** lets the owner review, assign, schedule follow-ups, qualify or close requests, with a recorded reason and history. A qualified request converts into exactly one linked opportunity through an editable review step. **Follow-ups** lists overdue, due-today, unassigned, ready-to-convert and stalled-opportunity items in Central Time (America/Chicago), alongside new-request notifications and recent activity. Notifications are in-app only; no email is sent. Details: [docs/WORKFLOW.md](docs/WORKFLOW.md). Stages 3–4 connect the work end to end. The flow runs from an opportunity through requirements, evidence, the proposal with owner review, the submission record and a confirmed award, then into the project, milestones, deliverable acceptance, change control and closeout, ending with private experience records and operational reports. See [docs/CONTRACTING.md](docs/CONTRACTING.md).

The workspace never sends messages, submits proposals or uploads files; evidence is reference-only until private storage is configured. Remaining work is listed in [docs/BACKLOG.md](docs/BACKLOG.md).

## Brand downloads
- `public/brand/radius-v2/EduRadius_Premium_Brand_System.zip`: complete brand package, including website assets
- `public/brand/radius-v2/EduRadius_Premium_Brandbook.pdf`: 21-page identity guidelines
- `public/brand/radius-v2/eduradius-logo-kit.zip`: SVG/PNG logo variants
- `public/brand/website-v3/EduRadius_Website_Assets.zip`: illustrative imagery, approved tokens and editable workflow

Images are illustrative AI-generated concepts, not verified clients, team, facilities or past performance. Recommendations and code candidates remain tentative/editable; classifications and official registration evidence require owner review.

## Import provenance and validation
Imported from published Site source commit `c94dec275b4be820cc1eb2725dd57f8a48613290`. TypeScript and production build passed before publication; the lifecycle layout and website-asset download were checked in preview. This repository import preserves application behavior and adds repository-specific documentation.

## Pull-request validation

Use **Node.js 24** for the checked-in test harness (Node's module hooks, native
TypeScript stripping, and SQLite adapter) and the pinned **pnpm 11.25.0**.

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
pnpm test:worker
pnpm preflight --target local
# optional, local only (needs a locally installed Playwright; not run in CI):
BASE=http://127.0.0.1:5173 node tests/browser/journey.mjs
BASE=http://127.0.0.1:5173 node tests/browser/contracting-journey.mjs
```

`pnpm test` runs the production route handlers and access helpers with an isolated
Worker environment. Both production SQL migrations run against in-memory SQLite;
only the D1 transport interface is adapted. It covers owner access, signed
sessions, CSRF checks, public-data projection, append-only intake, rate limits,
optimistic concurrency, and streaming UTF-8 request size limits.

`pnpm test:worker` runs the built Worker through local Wrangler using temporary
D1 state and test-only authentication values. It verifies the public and workspace
routes, token sign-in, intake persistence, save/reload, private-data exclusion,
oversize-request recovery, and fail-closed access with no valid auth mode. The
temporary servers and databases are cleaned up afterward. These are HTTP smoke
tests, not browser interaction or hosted deployment certification.

`.github/workflows/ci.yml` runs these checks on pull requests and pushes to `main`.
It does not deploy or connect to a live database. Browser checks previously
reported in the PR description are separate from this reproducible test suite.

The existing direct-image lint advisories remain warnings; authored application
code must pass all lint error rules. Public content uses an explicit field
allowlist, including `siteContent`; private or newly added fields are not
implicitly published. Request-body limits are enforced while streaming, in UTF-8
bytes, before parsing JSON.
