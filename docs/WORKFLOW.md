# Connected intake and opportunity workflow

## Authoritative sources

| Record | Source of truth | Notes |
| --- | --- | --- |
| Planning document (profile, codes, PSC, registrations, SF-330, receipts, documents, site content, recommendations) | `workspaces.data` (JSON, optimistic `revision`) | Unchanged behavior. Saved with **Save changes**. |
| Inquiries | `inquiries` table | Public intake inserts here. Owner edits are per record with an integer `version`. |
| Opportunities | `opportunities` table | Created manually or by conversion. `source_inquiry_id` is unique. |
| Activity history | `activity_events` table | Append-only. Actor and timestamp are always server-generated. |
| In-app notifications | `notifications` table | `dedupe_key` is unique; `email_status` is `disabled`. |
| Pre-migration document | `workspace_snapshots` table | Verbatim copy taken before legacy records are moved. |

Workflow records are **not** stored in the workspace JSON. The server deletes `inquiries`, `opportunities` and `activity` keys from any document save. Exports combine the document with every workflow record (`schemaVersion: 2`).

## Inquiry statuses and transitions

`New → Reviewing → Awaiting information → Qualified → Converted`, plus `Closed`.

| From | Allowed (owner edit) |
| --- | --- |
| New | Reviewing, Awaiting information, Qualified, Closed |
| Reviewing | New, Awaiting information, Qualified, Closed |
| Awaiting information | Reviewing, Qualified, Closed |
| Qualified | Reviewing, Awaiting information, Closed |
| Closed | Reviewing (reopen) |
| Converted | none. Only internal notes can change; the record stays for reference. |

- `Qualified` and `Closed` require a recorded reason.
- `Converted` is set only by the conversion endpoint.
- A next-action due date requires a next action.
- Field limits: assigned owner 120, next action 300, notes 8,000, reason 1,000 characters.
- Public submitters can send only `name`, `organization`, `email`, `sector`, `scope`, `kind` (plus the honeypot). Any other key, including status, assignment, notes or IDs, is rejected with 400.

### Legacy status mapping (non-destructive)

| Pre-workflow status | Workflow status | Kept as |
| --- | --- | --- |
| Awaiting review, blank or unknown | New | `legacy_status` |
| Tentative | Reviewing | `legacy_status` |
| Missing | Awaiting information | `legacy_status` |
| Complete | Closed (reason: “Marked Complete before the workflow migration.”) | `legacy_status` |

## Legacy import

The import runs automatically on the first owner load of `/api/workspace` or `/api/workflow` after migration 0002. It is one D1 batch (transaction):

1. Store the full document in `workspace_snapshots` as `pre-workflow-r<revision>`.
2. `INSERT OR IGNORE` every legacy inquiry, opportunity and activity entry by ID. Records without an ID get a deterministic content hash.
3. Remove the arrays from the document only if its revision is unchanged. This bumps the revision, so stale tabs receive a 409.

It is safe to rerun. If an outdated client writes arrays back, the next load imports any new records without duplicating existing ones.

## Conversion

`POST /api/inquiries/:id/convert` with `{ version, opportunity }`. The opportunity is the editable review draft (`conversionDraft` in `lib/workflow.ts`). It carries over the organization, contact, sector, service (from the request kind), scope, owner and next action.

One transaction inserts the opportunity, marks the inquiry `Converted` with `opportunity_id`, and appends `inquiry.converted` and `opportunity.created`. All of it is guarded by `status = 'Qualified' AND version = ? AND opportunity_id IS NULL`. The unique index on `opportunities.source_inquiry_id` is the final backstop.

- Retries and concurrent duplicates return `200 { alreadyConverted: true }` with the existing opportunity.
- Stale versions return 409.

## Follow-ups and timezone

All due dates are calendar dates (`YYYY-MM-DD`) in the **business timezone `America/Chicago`** (San Antonio). “Today” is computed with `Intl` in that zone, so it follows CST and CDT, including DST changes. The Follow-ups view groups:

- overdue (due before today)
- due today
- unassigned open requests
- qualified requests awaiting conversion
- open opportunities with no next action or an overdue one

The queue is computed when it is read. There is no cron job and nothing to retry.

## Notifications

Each public request creates one in-app notification (`dedupe_key = inquiry.created:<id>`) and records `email_status = 'disabled'`. Reviewing the request, which moves it out of `New`, marks its notification read.

**No email is sent.** There is no provider, credential or outbound call, and tests assert that `fetch` is never called. A future email adapter must:

- read pending rows by `dedupe_key`
- record delivery state per row (`pending → sent | failed`)
- stay disabled unless explicitly configured

## Activity

Event types recorded:

- `inquiry.received`, `inquiry.reviewed`, `inquiry.status_changed`, `inquiry.assigned`, `inquiry.notes_updated`, `inquiry.reason_updated`, `inquiry.converted`
- `followup.created`, `followup.updated`, `followup.completed`
- `opportunity.created`, `opportunity.updated`
- `workflow.imported`, `legacy.entry`

Actor values: `public`, `token:session`, `token:bearer`, `sites:<user id>` and `system:legacy-import`.

Activity summaries never include contact details or note contents. Opportunity updates list changed field names only.

## API (owner-only unless noted)

| Method & path | Body | Result |
| --- | --- | --- |
| `GET /api/workflow` | — | Summary only (schema 3): counts, unread notifications, recent activity, follow-up totals, `today`, `businessTimeZone`. Records are paged through `GET /api/records/:type`; the complete set is `GET /api/export` ([API.md](API.md)) |
| `PATCH /api/inquiries/:id` | `{ version, changes }` | `{ inquiry }`; 400 validation, 404, 409 stale |
| `POST /api/inquiries/:id/convert` | `{ version, opportunity }` | 201 `{ inquiry, opportunity }`, 200 `alreadyConverted`, 409 |
| `POST /api/opportunities` | `{ opportunity }` | 201 `{ opportunity }` |
| `PATCH /api/opportunities/:id` | `{ version, changes }` | `{ opportunity }`; 409 stale |
| `POST /api/notifications` | `{ ids }` or `{ all: true }` | `{ updated }` |
| `POST /api/inquiries` (public) | public fields | 201; never returns records |

Every owner write requires a same-origin request, owner authorization and a capped JSON body (16–32 KB).
