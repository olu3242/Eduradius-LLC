# Vercel deployment

Vercel runs the complete Next.js application with PostgreSQL. The existing Sites
build continues to use vinext, Cloudflare Workers and D1 through the Vite platform
alias. The deployments do not share data. No existing D1 data is imported.

## Build and configuration

- Node 24, pnpm 11.25.0, `pnpm build:vercel` (native Next.js).
- `DATABASE_URL`: pooled PostgreSQL URL, stored as a Vercel secret.
- `WORKSPACE_AUTH_MODE=token`: the existing portable owner-session flow.
- `WORKSPACE_ACCESS_TOKEN`: at least 32 random characters, server-only.
- `BUILD_COMMIT` is optional; hosted health responses also read Vercel's commit SHA.

All three settings are scoped to the deployment branch's Preview environment.
Sites identity headers are explicitly rejected by the Node adapter. Vercel
Deployment Protection remains enabled. The owner key can be retrieved/replaced
privately in the project's Environment Variables settings, then a new deployment
is required to apply a replacement. Never put it in a URL or client-side variable.

## Database

The isolated Neon project is `eduradius-vercel` (`soft-hill-26700917`), branch
`vercel-preview` (`br-soft-shadow-bbrnaohx`), database `eduradius`, US East.
The baseline in `postgres/0000_baseline.sql` covers D1 migrations 0000–0008.
It adds a private insertion-order column, SQLite-compatible JSON/aggregate
functions and the indexes used by lists. The adapter removes that private column
from returned records and preserves mixed-case projection aliases.

For another **empty, isolated** PostgreSQL database, provide `DATABASE_URL` and
`DATABASE_CONFIRM_HOST` (the exact hostname), then run `pnpm db:vercel`. The
transactional installer refuses a nonempty database, checks the baseline checksum
on rerun, and does not run automatically in the build. Existing databases require
reviewed forward migrations. Never run D1 migrations directly against PostgreSQL.

Atomic batches use repeatable-read transactions and retry serialization/deadlock
conflicts. User values remain bound parameters; unique conflicts keep the existing
409 responses. Connections are bounded to three per function process and expire
after five idle seconds. A pooled Neon connection limits upstream connections.

## Validation and limits

- Native Next.js production build and TypeScript check.
- All 131 local tests (128 existing plus three adapter checks).
- 24 PostgreSQL checks covering the adapter, proposals, projects, delivery,
  acceptance, closeout and private experience records using PGlite.
- Six existing pagination/search/relationship tests against PostgreSQL. SQLite
  EXPLAIN-plan tests and synchronous bulk-fixture helpers remain SQLite-only.
- Hosted verification must check health/readiness, auth/session, public content,
  owner access, a synthetic write/reload, and an export against the actual deployment.

Preview uses a new empty database. Existing Cloudflare records, settings and
production domains remain untouched. Evidence uploads are still reference/link
only. Sites connector capabilities are unavailable outside the Sites dispatcher.
Large exports are subject to Vercel Function response limits; the application's
60 MB export ceiling alone does not guarantee delivery on Vercel. Hosted database
restore and human accessibility review remain separate release tasks.
