# Workspace API (owner reads)

Every endpoint below is **owner-only**:

- **Anonymous or invalid credentials:** 401.
- **Authenticated non-owner (sites mode):** 403.
- **Access mode not configured:** 503.

Responses carry `Cache-Control: no-store` and an `x-request-id`. Writes are unchanged; see [WORKFLOW.md](WORKFLOW.md) and [CONTRACTING.md](CONTRACTING.md).

Since schema 3, the workspace never downloads every record at once. Clients compose views from the endpoints below.

| Endpoint | Returns | Bound |
| --- | --- | --- |
| `GET /api/workflow` | Summary (`schema: 3`): `today`, `businessTimeZone`, unread `notifications` (≤ 50) and `unreadNotifications`, recent `activity` (≤ 20), `owners` (≤ 100), `opportunityStatusCounts`, `recentOpportunities` (5; card fields only), `counts` per type, `followUpsDue`. It also runs the idempotent legacy import. | No record collections and no notes or contact details |
| `GET /api/records/:type` | One page of records (see below) | `limit` ≤ 100 |
| `GET /api/records/:type/:id` | One record (`inquiry`, `opportunity` or any record type) | 1 |
| `GET /api/context/:type/:id` | A detail view's record and related records: `opportunity`, `project`, `organization`, `inquiry` | ≤ 500 per child type; `totals` reports larger sets |
| `GET /api/evidence-links?subjectType=&ids=` | Links and linked evidence for up to 100 records of one type | 100 ids |
| `GET /api/followups?kind=all\|inquiry\|opportunity&owner=<name>\|none` | Follow-up buckets with complete `total`s | ≤ 100 items per bucket |
| `GET /api/reports` | Operational metrics over **all** records, computed on the server | complete `count`; ≤ 100 `items` (`truncated` flag) |
| `GET /api/organizations/duplicates` | Active organizations sharing a normalized name or website domain | ≤ 50 groups |
| `GET /api/export` | The complete workspace (schemaVersion 2 plus `manifest`) | All rows, or 413; never partial |

## Lists: `GET /api/records/:type`

Types: `inquiry`, `opportunity` and every record type in `lib/records.ts` (`organization`, `contact`, `requirement`, `evidence`, `proposal`, `proposalVersion`, `submission`, `teamingPartner`, `project`, `projectBaseline`, `milestone`, `deliverable`, `projectLog`, `deliverableVersion`, `changeRequest`, `closeout`, `experience`, `proposalTemplate`).

| Parameter | Rule |
| --- | --- |
| `limit` | Whole number from 1 to 100 (default 25). |
| `sort` | `created` (newest first, default), `oldest`, `updated` (most recently changed), `title` (case-insensitive A–Z), `due` (earliest first; no date sorts last), each where the type supports it. |
| `q` | Up to 100 characters and at most 5 terms. Every term must match at least one of the type's allowlisted text columns (case-insensitive substring). `%`, `_` and `\` are literal. |
| `<filter>=<value>` | Equality on the type's enum fields (values validated), reference fields (an id, or `none` for "not linked") and booleans (`true`/`false`). Special filters: `open` (inquiry, opportunity, project); `assignee`/`owner` (a name, or `none`); evidence `state` (`current`, `unreviewed`, `expired`, `rejected`, `usable`, against the business date). Each filter may appear once. |
| `ids` | Up to 100 comma-separated ids, used to resolve references. Ignores `cursor` and `limit`. |
| `cursor` | Opaque token from the previous page. |

Any other parameter, or an invalid value, returns **400** with `code: invalid_parameter`. An unknown type returns **404**.

Every value is a bound SQL parameter. Only allowlisted column names and fixed sort expressions reach the SQL text.

Response shape:

```json
{ "items": [ … ], "page": { "limit": 25, "total": 312, "hasMore": true, "nextCursor": "…", "sort": "created" } }
```

Some list items carry computed, read-only annotations prefixed with `_`:

| Type | Annotations |
| --- | --- |
| organization | `_contacts`, `_related` |
| contact | `_organizationName` |
| evidence | `_linkedTypes` |
| project | `_clientName`, `_milestones`, `_milestonesComplete`, `_deliverables`, `_deliverablesAccepted` |

### Why keyset (cursor) pagination

The views page forward through recent records ("Load more") and search. Offset paging would repeat or skip rows whenever records are created between requests, which happens constantly through public intake. Keyset pagination orders by the sort expression and then by `id`, a unique tie-breaker, so equal timestamps or titles never cause duplicates or gaps. Indexes from migration 0007 support each sort.

A cursor holds the last row's sort value and id, plus a fingerprint of the type, `sort`, `q` and filters:

- A malformed cursor returns **400** `invalid_cursor`.
- A cursor reused with different search, filters or sort returns **400** `stale_cursor`.
- The client restarts from the first page in both cases.
- Changing `limit` keeps a cursor valid.
- A cursor stays valid if its anchor row is later deleted.

### Consistency during concurrent changes

Each page and its `total` are read in one D1 batch, which is a consistent snapshot. Successive pages are separate reads.

| Change between page requests | Effect |
| --- | --- |
| A record is created | With `created` (newest first) it is not returned mid-walk; it appears when the list is refreshed. With `oldest` it appears at the end. `total` reflects it on the next page. |
| A record is edited | With `created`/`oldest`/`due` (on unchanged dates), its position is stable and the next page shows its new values. With `updated` it moves to the front, so a walk already past the front will not return it again, and a walk that has not reached it will skip it. With `title`, a rename moves it likewise. |
| A record or link is deleted | It no longer appears; nothing else shifts. Only evidence links are deleted by the application; records are merged or closed, not deleted. |

No record that exists for the whole walk is returned twice. The UI refetches the loaded window after every change the owner makes, and on "Refresh".

## Detail contexts: `GET /api/context/:type/:id`

The response is `{ record, records: { type: [...] }, evidenceLinks, scopes, linkScopes, totals, opportunities?, inquiries?, activity? }`.

`scopes` and `linkScopes` name the parent keys this response is complete for. A client replaces those cached collections instead of merging, so deleted links disappear.

| Type | Includes |
| --- | --- |
| `opportunity` | Requirements, proposals and their versions, submissions, teaming partners, the project, evidence links on the opportunity, requirements and proposals, all referenced evidence (links, award evidence, proposal section references), the linked organization/contact and partner organizations/contacts, and up to 100 proposal templates. |
| `project` | Milestones, deliverables and their versions, risks and issues, change requests, baselines, closeouts, experience, evidence links on the project, deliverables and experience, and all referenced evidence, plus the source opportunity, submission, proposal version and client organization. |
| `organization` | Contacts (≤ 500), linked requests and opportunities (≤ 100 each, with `totals`), and the merge target. |
| `inquiry` | The request, its activity (≤ 100), the converted opportunity, and the linked organization/contact. |

## Reports: `GET /api/reports`

The metric definitions are shared with `lib/reports.ts`. The server reads only rows that can meet a definition (filtered in SQL), applies the shared definitions, and reports per metric:

- `count`: the complete number;
- `noData`: computed from whole-table counts;
- `unavailable`: rows that could not be evaluated, for example evidence without a review date across the whole register;
- `items`: at most 100, with `truncated` set when more exist.

A test compares every metric with the definitions applied to the complete export.

## Export: `GET /api/export`

Returns `exportBundle()` (schemaVersion 2): the workspace document, inquiries, opportunities, activity, every record type and evidence links. It also includes `manifest`:

```json
{ "counts": { "inquiries": 1200, "opportunities": 400, "…": 0 }, "consistency": "single-transaction snapshot", "workspaceRevision": 3 }
```

- **Consistency:** every table, and the workspace document, is read in **one D1 batch**. D1 runs a batch as a single transaction, so the export is a consistent snapshot even while owners keep editing. An edit lands either wholly before or wholly after the export.
- **Completeness:** nothing is truncated. The previous export silently capped requests and opportunities at 2,000 and activity at 50,000. If the workspace holds more than 200,000 rows, or the response would exceed 60 MB, the request fails with **413** (`code: export_too_large`, with counts) and nothing is downloaded. Use a database backup instead.
- **The download from the workspace UI** replaces `workspace` with the planning document shown on the page, so unsaved edits are included. The records come from the server snapshot.
- **Logging:** each export logs `workspace.export` with its counts only.

## Error codes

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_parameter` | Unsupported parameter, value, limit, sort, filter or search length |
| 400 | `invalid_cursor` | Malformed cursor |
| 400 | `stale_cursor` | Cursor from a different search, filter or sort |
| 404 | — | Unknown type or record |
| 413 | `export_too_large` | Export refused instead of truncated |
| 503 | — | Database unavailable (logged as `workflow.error` with the request ID) |
