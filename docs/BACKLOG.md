# Implementation backlog (not implemented)

Nothing in this document is implemented. Stages 1–2 are complete (see WORKFLOW.md and OPERATIONS.md). Each item follows the existing conventions:

- a new numbered migration;
- shared validation in `lib/`;
- owner-only routes through `ownerWrite`/`ownerRead`;
- server-generated activity;
- tests in `tests/*.test.mjs`.

## Stage 3 — Pursuit structure

### 3.1 Organizations and contacts
- **Tasks:**
  - Create `organizations` and `contacts` tables (contact belongs to organization, with role, email and phone).
  - Backfill from inquiry and opportunity organization, contact name and contact email, de-duplicated by normalized email or domain.
  - Link inquiries and opportunities by `organization_id` and `contact_id`; keep the existing text fields until verified.
- **Acceptance:**
  - Re-running the backfill creates no duplicates.
  - Merging two organizations relinks every record and records activity.
  - Public intake still writes only inquiries.
  - `/api/site` exposes none of it.

### 3.2 Evidence attachments
- **Tasks:**
  - Add an R2 binding (`.openai/hosting.json` `r2`) and an `attachments` table (owner, subject, key, size, sha256, content type).
  - Use owner-only signed upload and download routes, with a size cap and type allowlist.
- **Acceptance:**
  - Uploads above the cap are rejected before streaming completes.
  - Anonymous and non-owner download returns 401/403.
  - Deleting a record soft-deletes and audits its attachments.
  - No public URL is guessable.

### 3.3 Proposal sections
- **Tasks:** Create `proposal_sections` per opportunity (title, body, owner, status, version), reusing capability-statement content as starting text.
- **Acceptance:**
  - Optimistic versioning returns 409 on concurrent edits.
  - Section status changes appear in activity.
  - Export includes sections.

### 3.4 Requirements checklists
- **Tasks:** Create `requirements` per opportunity (source reference, text, response owner, compliance status, evidence links).
- **Acceptance:**
  - The checklist can be filtered by status.
  - An opportunity cannot move to `Review` while any mandatory requirement is `Unknown` (enforced server-side).

### 3.5 Review approvals
- **Tasks:** Create `approvals` (subject, requested reviewer, decision, comment, decided_at); a request is required to move an opportunity to `Closed`/Go.
- **Acceptance:**
  - The approver identity comes from the authenticated session.
  - A decision is immutable once made (corrections add a new record).
  - Activity shows both the request and the decision.

### 3.6 Teaming relationships
- **Tasks:** Create `teaming_partners` per opportunity (organization, role prime/sub, workshare %, agreement status, NDA/TA dates).
- **Acceptance:**
  - Workshare totals are validated at or below 100 %.
  - Expired NDA dates surface in Follow-ups.
  - Converting a teaming inquiry can prefill a partner record.

## Stage 4 — Delivery and intelligence

### 4.1 Project milestones
- **Tasks:** Create `projects` (from a won opportunity, one per opportunity) and `milestones` (due date in the business timezone, owner, status).
- **Acceptance:**
  - Winning an opportunity creates exactly one project (same unique-index pattern as conversion).
  - Milestones appear in Follow-ups.

### 4.2 Deliverables and acceptance records
- **Tasks:** Create `deliverables` per milestone with submission and `acceptance_records` (accepted by, date, evidence attachment).
- **Acceptance:**
  - A deliverable cannot be marked accepted without an acceptance record.
  - Records are append-only with server-side actor and timestamp.

### 4.3 Operational reporting
- **Tasks:**
  - Owner-only read models: pipeline by stage and value, conversion rate, time-to-first-response, overdue follow-ups, milestone health.
  - CSV export.
- **Acceptance:**
  - Figures reconcile with record counts in tests.
  - Dates are bucketed in America/Chicago.
  - Reports contain no contact details unless explicitly requested.

### 4.4 AI-assisted summarization and drafting (human approval)
- **Tasks:**
  - Server-side drafting endpoints for inquiry summaries, qualification notes and proposal section drafts.
  - The provider key is a Worker secret.
  - Drafts are stored as `ai_drafts` with model, prompt version and status (`proposed → accepted | rejected`).
- **Acceptance:**
  - Nothing generated is saved into a record or sent externally without an explicit owner **Accept**, recorded with actor and timestamp.
  - Drafts are labelled as AI-generated in the UI.
  - The feature is disabled by default and fails closed without a key.
  - Prompts exclude unnecessary contact details.
  - Per-owner rate limits apply.
  - Tests use a stubbed provider and assert no network call when disabled.

## Next increment (recommended)

**Isolated staging deployment (blocked on infrastructure).**
1. Provision a staging Worker and D1.
2. Run `pnpm preflight --target staging`.
3. Execute the staging acceptance checklist in OPERATIONS.md.
4. Confirm the platform backup and restore procedure for the hosted D1.

This is the remaining gate before production and must precede Stage 3.
