# EduRadius LLC — Application Source Export

Source: EduRadius LLC · Contracting Workspace, version 5
Commit: c94dec275b4be820cc1eb2725dd57f8a48613290

This package preserves the tracked source from the latest saved Site version,
including the company website, contracting workspace, API, database schema and
migration, UI components, dependency lockfile, and bundled brand/website assets.
The only added file is this START_HERE.md guide.

## Local development

Use Node.js >=22.13.0 and pnpm 11.25.0 (the package.json pin).
Extract the ZIP, open a terminal in EduRadius_Source_Code, then run:

    pnpm install --frozen-lockfile
    pnpm run dev

Open the URL printed by the development server (normally http://localhost:5173).
For a production build, run:

    pnpm run build

For local database persistence, build first, then apply the included migration:

    node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_wonderful_exiles.sql

See README.md for framework, local-preview, database, and hosting details.

## Hosting dependencies

This application uses Vinext/React and Cloudflare Workers with a D1 binding named
DB. The .openai/hosting.json file preserves the existing Site identity and binding
declaration. Publishing through another provider requires suitable configuration
for the Worker, D1, and access control. The current API relies on the Site access
policy to protect the shared workspace; preserve equivalent protection when
hosting elsewhere. The ZIP does not configure a new hosting account.

## Scope and verification

Live database records, user-entered workspace data, credentials, installed
node_modules, Git history, and generated build output are not part of this source
export. Existing brand ZIPs and PDFs under public/ are included as tracked assets.
Archive integrity and byte equality with the tracked checkout were verified.
Dependencies were not installed and a new application build was not run for this
export.
