# Contracting and delivery workflow (Stages 3–4)

Opportunity → requirements → evidence → proposal → owner review → submission record → confirmed award → project → milestones → deliverables → acceptance → change control → closeout → reusable experience.

Earlier stages are described in [WORKFLOW.md](WORKFLOW.md) (inquiries, conversion, follow-ups).

## Architecture

- **Declarative record engine.** [`lib/records.ts`](../lib/records.ts) defines every record type: its fields, kinds, limits, references, read-only and immutable flags. Both the UI and the server validate against these definitions.
- **Generic persistence.** [`lib/server/records-store.ts`](../lib/server/records-store.ts) handles every type:
  - one table per type, which is the authoritative source;
  - version-checked edits (409 on a stale version);
  - references that must exist, must not point to merged records, and must share the declared parent (for example, the same project);
  - per-type rules (hooks);
  - activity with a server-derived actor and timestamp.
- **Explicit workflow actions.** Every workflow transition is an explicit action in [`lib/server/actions.ts`](../lib/server/actions.ts), served at `POST /api/actions/:name`. Generic edits are rejected for fields marked `readOnly`. Each action is a single D1 batch (transaction); follow-on writes are guarded on the request ID of the first write, and unique indexes back up every "exactly once" rule.
- **Owner-only routes.** Every route here is owner-only: same-origin writes, capped JSON bodies, and the existing Sites/token access model. Public endpoints (`/api/site`, `POST /api/inquiries`) expose none of these records.

| Route | Purpose |
| --- | --- |
| `GET /api/records/:type`, `GET /api/context/:type/:id`, `GET /api/export` | Paged records, a detail view's related records, and the complete export ([API.md](API.md)). `GET /api/workflow` no longer returns record collections |
| `POST /api/records/:type` | Create a record (types that allow generic create) |
| `PATCH /api/records/:type/:id` | `{ version, changes }` edit; read-only fields rejected |
| `POST /api/actions/:name` | Workflow action (table below) |

## Record types and rules

| Type (table) | Key rules |
| --- | --- |
| Organization (`organizations`) | Type (Prospective client, Government buyer, Prime contractor, Delivery partner, Teaming partner, Other), relationship owner, source, notes. Duplicates are detected by normalized name or website domain; saves return candidates and require "use existing" or `confirmDistinct`. |
| Contact (`contacts`) | Belongs to an active organization. Duplicates are detected by email. Names never appear in activity summaries. |
| Requirement (`requirements`) | Description, category, required/optional, owner, due date, status, reviewer notes. **Evidence needed** (proof not yet shown) is distinct from **Not met** (confirmed gap or ineligibility, reason required). **Met** needs verified, unexpired linked evidence or reviewer notes. Go/no-go stays a manual decision. |
| Evidence (`evidence`, `evidence_links`) | Title, category, version, owner, review status, expiration/review date, a private location reference or an approved `https` link. **No uploads**: no private storage binding is configured (`.openai/hosting.json` `r2: null`). Links to opportunities, requirements, proposals, projects, deliverables and experience are validated. |
| Teaming partner (`teaming_partners`) | Partner organization (the contact must belong to it), proposed role, work package, capability fit, relationship owner, discussion status, next action. Only **Agreement signed** (which requires a reference) indicates agreed participation. One record per partner per opportunity. |
| Proposal (`proposals`, `proposal_versions`, `proposal_templates`) | Nine sections, each with a stated basis: Draft text, Illustrative (not a verified claim), or Verified (must cite evidence). Templates only create new proposals. |
| Submission (`submissions`) | References the exact approved version (one submission per version). Captures date, method and reference. The outcome is manual. |
| Project (`projects`, `project_baselines`) | Created only from a confirmed award (see below); one per opportunity. Scope and planned completion come from the active baseline and change only through approved change requests. |
| Milestone (`milestones`) | Owner, planned and actual dates, completion criteria, same-project dependencies. Cycles are rejected. Completing one requires an actual date and completed dependencies. Completed work is locked unless reopened with a reason. |
| Deliverable (`deliverables`, `deliverable_versions`) | Owner, due date, required flag, draft summary (location, not an upload), review state, preserved versions. |
| Log entry (`project_log`) | Risk, Issue, Decision or Action, with severity, owner and status. Resolution is required to resolve or close. |
| Change request (`change_requests`) | Requested change, reason, scope/schedule/cost (narrative) impact, decision owner, agreement reference. Kept exactly as recorded once decided. |
| Closeout (`project_closeouts`) | Checklist snapshot, lessons learned, final acceptance evidence, archive review, any owner exception. Every closeout is kept, because projects can be reopened. |
| Experience (`experience_records`) | Private by default. One per completed project. Provenance is snapshotted when approved for use. |

## State machines (server-enforced)

**Proposal owner review.** Approval in this single-owner workspace is described as *owner review*, not an independent second review.

```
Draft ──send for owner review──▶ Internal review ──approve──▶ Approved ──record submission──▶ Submitted
  ▲                                   │
  └──── edit ◀── Changes requested ◀──┘ (reason required)
Approved ──edit──▶ Draft (approved version preserved; a new review is required)
```

- Every "send for owner review" creates an immutable version snapshot.
- Approval re-checks that verified sections cite current evidence and supersedes any earlier approved version.
- Submission is allowed only when the approved version is also the latest version.
- Submitted proposals are locked.

**Deliverables.**

```
Draft ──submit──▶ Ready for review ──accept──▶ Accepted ──revise──▶ Draft (accepted version kept)
  ▲                      │
  └── Changes requested ◀┘ (notes required)
```

There are two kinds of acceptance:

- **Internal approval** is labelled "internal approval — not client acceptance".
- **Client acceptance** requires the accepting person's name and role, plus *verified, unexpired* acceptance evidence.

Nothing is sent to anyone.

**Projects.** Allowed transitions:

| From | To |
| --- | --- |
| Planning | Active, On hold, Cancelled |
| Active | On hold, Closing, Cancelled |
| On hold | Active, Planning, Cancelled |
| Closing | Active, Cancelled |
| Closed | Active |
| Cancelled | Planning |

- A reason is required for cancellation, holds and every reopening.
- **Closed** is reached only through closeout.
- Closed and cancelled projects lock their plan (milestones, deliverables, log and changes).

**Experience use.** `Private → Ready for owner review → Approved for capability statement → Withdrawn` (withdrawal requires a reason). Any edit after approval returns the record to Private.

## Award → project

`project.createFromAward` requires all of the following:

1. a submission whose outcome is **Awarded**, recorded with explicit written-award confirmation, a date and award evidence (`submission.recordOutcome`);
2. `confirm: true` after reviewing the client, scope, owner, dates and initial deliverables;
3. valid dates, with planned completion on or after the start.

The project then:

- links the opportunity, proposal, approved version, submission and award evidence;
- records baseline 1 ("Award baseline");
- links the award evidence to the project.

Retries and concurrent requests return the existing project (unique `projects.opportunity_id`), and the submission outcome is locked once a project exists. Proposal approval or submission is never treated as an award.

## Change control

Recording a decision does **not** create or modify a legally binding agreement; the agreement is referenced separately. A decision requires a rationale.

- **Rejected or Withdrawn:** the baseline is unchanged.
- **Approved:** creates baseline *n+1* (new scope and/or planned completion), sets it active and updates the project, all in the same transaction. Earlier baselines remain.

## Closeout checklist

These checks are shared between the UI and the server (`closeoutChecklist`):

1. Required deliverables accepted.
2. No unresolved risks or issues (Open or Monitoring).
3. No outstanding actions, incomplete milestones, undecided changes or project next action.
4. Final acceptance evidence that is verified and unexpired.
5. Lessons learned recorded.
6. Archive and retention reviewed.

The project must be in **Closing**. If any item is open, the closeout is blocked (409, with the checklist) unless the owner records an **exception reason**. The exception is stored with the checklist snapshot and noted in the project's status reason. Cancellation is a separate status and never produces an experience record.

## Experience records and provenance

`experience.createFromProject` works only for projects closed as completed. It prefills:

- the actual scope, from the active baseline;
- the start and completion dates;
- lessons learned;
- a snapshot of accepted deliverables, including the acceptance kind and evidence.

Measured outcomes are entered by the owner. Approval for capability-statement use requires:

- a client description (generic unless permission allows naming the client);
- at least one accepted deliverable;
- verified evidence linked to the record for any stated outcomes;
- client permission, as verified evidence or a reference.

Approval records provenance: the project, opportunity, approved proposal version, submission, award evidence, closeout and any exception, accepted deliverables, outcome evidence, permission, approver and time.

Approved records appear only in the **workspace capability statement draft**; nothing is published to the public website. The UI and docs warn against adding unevidenced endorsements, ratings, savings, revenue, contract values, certifications or government past performance. The software cannot detect invented claims; the owner review is the control.

## Workflow actions

| Action | Body (besides `id`/`version` where applicable) |
| --- | --- |
| `organization.merge` / `contact.merge` | `sourceId`, `targetId`, `sourceVersion`. The target keeps its values; conflicts are returned; the source is retained as Merged. |
| `organization.linkExisting` | none. Links requests and opportunities by exact normalized name or email; bounded batches; safe to rerun. |
| `inquiry.link` / `opportunity.link` | `organizationId`, `contactId` (the contact must belong to that organization) |
| `evidence.link` / `evidence.unlink` | `evidenceId`, `subjectType`, `subjectId` |
| `proposal.create` | `opportunityId`, `title`, `templateId?` |
| `proposal.submitForReview` / `proposal.approve` | — |
| `proposal.requestChanges` | `reason` |
| `proposal.recordSubmission` | `submittedOn`, `method`, `reference?`, `notes?` |
| `proposal.saveTemplate` | `name` |
| `submission.recordOutcome` | `outcome`, `outcomeDate`, `outcomeNotes?`; for Awarded also `awardEvidenceId` and `confirmAward: true` |
| `project.createFromAward` | `submissionId`, `confirm`, `title`, `scope`, `owner?`, `clientOrganizationId?`, `startDate?`, `plannedEndDate?`, `deliverables[]` |
| `project.transition` | `to`, `reason?` |
| `deliverable.submitForReview` | — |
| `deliverable.requestChanges` | `notes` |
| `deliverable.accept` | `acceptanceKind`; for client acceptance also `acceptanceAuthority` and `acceptanceEvidenceId` |
| `changeRequest.decide` | `decision` (Approved, Rejected or Withdrawn), `reason` |
| `project.closeout` | `lessonsLearned`, `finalAcceptanceEvidenceId`, `archiveReviewed`, `retentionNotes`, `actualEndDate`, `exceptionReason?` |
| `experience.createFromProject` | `projectId` |
| `experience.review` | `to`, `reason?` |

## Operational reports

Reports are computed by `operationalReport` in [`lib/reports.ts`](../lib/reports.ts) over business dates (America/Chicago, `YYYY-MM-DD`). They are operational tracking only, not accounting, invoicing or financial reporting. Each metric reports one of three states:

- **No records yet:** the source table is empty, which is different from a count of zero.
- **Unavailable:** the number of records that could not be evaluated (for example, a missing date). These are never counted as on time.
- **A count:** the items that meet the definition.

| Metric | Definition | Source |
| --- | --- | --- |
| Opportunities awaiting requirements or evidence | Open opportunities without a project that have no requirements, requirements marked Evidence needed, or unreviewed/expired linked evidence | opportunities, requirements, evidence, evidence_links |
| Proposals awaiting owner review | Status Internal review | proposals |
| Submitted proposals awaiting an outcome | Outcome Pending | submissions |
| Active projects | Planning, Active, On hold, Closing | projects |
| Overdue milestones | Incomplete milestones in open projects with planned date before today (due today is not overdue); undated counted as unavailable | milestones |
| Deliverables awaiting review | Ready for review | deliverables |
| Changes awaiting decision | Proposed | change_requests |
| Projects approaching closeout | Closing, or Active with planned completion within 14 days or past; Active without a date counted as unavailable | projects |
| Unresolved risks and issues | Risk or Issue, Open or Monitoring, on open projects | project_log |
| Evidence expired or due for review | Review date before today or within 28 days; undated counted as unavailable | evidence |

## AI assistance: integration boundary (not implemented)

No AI provider integration exists in this repository: there is no SDK, model call or provider credential. Per the deterministic-first rule, **no AI feature is implemented, simulated or claimed**. A future integration must:

- run server-side only, behind `ownerWrite`, with the provider key stored as a Worker secret and the feature disabled by default (failing closed without the key);
- start only from an explicit owner action, such as "Draft summary" on a deliverable or "Suggest missing information" on requirements;
- send only the minimum fields needed (no contact details or evidence contents by default) and return the IDs of the source records used;
- store outputs as clearly labelled drafts (`ai_drafts`: source references, model, prompt version, status), never written into records until the owner explicitly accepts them;
- never award, approve, accept, publish, submit or send anything;
- be tested against a stubbed provider, asserting that no network call happens while it is disabled.

## Not implemented (by design or pending infrastructure)

- **File uploads.** There is no private storage binding. Evidence and deliverables record locations or approved links only.
- **Messaging.** No messages, invitations, submissions, approvals or acceptance requests are ever sent from the workspace.
- **Public publication.** Experience records are not published to the public website.
- **Deletions.** Records are not deleted. Workflow statuses (Merged, Withdrawn, Cancelled, Closed) preserve history instead.
