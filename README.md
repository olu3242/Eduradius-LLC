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

The clean-clone default is the portable runtime. The URL is printed by the dev server. The workspace API requires the local D1 schema: apply `drizzle/0000_wonderful_exiles.sql` to the local `DB` binding with Wrangler before saving records. See [runtime notes](docs/SITES_RUNTIME.md) for preview, bindings and build details.

```sh
pnpm exec tsc --noEmit
pnpm build
```

## Hosting and access
The existing Site is hosted privately at https://eduradius-contract-workspace.olufemi-adey-1577.chatgpt.site. This GitHub import does not configure automatic deployment. The .openai/hosting.json file retains the existing Site identity.

The workspace API relies on the host's owner-private access policy and a D1 binding named DB. An independently deployed copy must provide equivalent authentication/authorization before exposing the API. No hosted records, credentials, local database state or registration submissions are included in this repository.

## Brand downloads
- `public/brand/radius-v2/EduRadius_Premium_Brand_System.zip`: complete brand package, including website assets
- `public/brand/radius-v2/EduRadius_Premium_Brandbook.pdf`: 21-page identity guidelines
- `public/brand/radius-v2/eduradius-logo-kit.zip`: SVG/PNG logo variants
- `public/brand/website-v3/EduRadius_Website_Assets.zip`: illustrative imagery, approved tokens and editable workflow

Images are illustrative AI-generated concepts, not verified clients, team, facilities or past performance. Recommendations and code candidates remain tentative/editable; classifications and official registration evidence require owner review.

## Import provenance and validation
Imported from published Site source commit `c94dec275b4be820cc1eb2725dd57f8a48613290`. TypeScript and production build passed before publication; the lifecycle layout and website-asset download were checked in preview. This repository import preserves application behavior and adds repository-specific documentation.
