# Implementation backlog

Stages 1–4 are implemented. See [WORKFLOW.md](WORKFLOW.md) (Stages 1–2) and [CONTRACTING.md](CONTRACTING.md) (Stages 3–4). This file lists only the remaining work. **Nothing below is implemented.**

## Release gate (next increment)

**Isolated staging deployment (blocked on infrastructure and credentials).**
1. Provision a staging Worker and its own D1 database. Never use the existing Site.
2. Run `pnpm preflight --target staging`.
3. Apply migrations 0000–0006 in order.
4. Execute the staging acceptance checklist in OPERATIONS.md, including the contracting journey.
5. Confirm the platform backup and restore procedure for the hosted D1, and rehearse a restore.
6. Verify hosted Sites sign-in with an owner allowlist, and a 403 for an authenticated non-owner.

## Remaining gaps after Stages 3–4

| Item | Tasks | Acceptance criteria |
| --- | --- | --- |
| Private file storage | Add an R2 binding; owner-only signed upload and download; a size cap and type allowlist; safe filenames; attach files to evidence and deliverable versions | Uploads above the cap or of disallowed types are rejected before storing; anonymous and non-owner access is denied; nothing is served from `public/` |
| AI assistance | Implement the boundary in CONTRACTING.md (`ai_drafts`, explicit initiation, minimum data, source references, owner acceptance) | Disabled by default; no network call when disabled (tested); no autonomous award, approval, acceptance, publication or submission |
| Email notifications | Outbox adapter reading `notifications` by `dedupe_key`, with per-row delivery state | Disabled by default; one delivery per key; failures recorded; nothing is sent in tests |
| Public experience publication | Explicit publish step for approved experience records, with a public projection that exposes provenance-backed fields only | Only "Approved for capability statement" records with permission evidence can be published; withdrawal removes them; `/api/site` tests extended |
| Multi-user review | Separate reviewer identities, with approval forbidden by the author | Approver differs from author; audit shows both |
| Archiving | Archive and restore workflow for closed records, plus a retention schedule | Archived records are excluded from active views and fully restorable |
| Accessibility audit | Screen-reader pass (NVDA/VoiceOver), colour-contrast measurement, cross-browser testing | Documented WCAG 2.2 AA assessment with fixes |
