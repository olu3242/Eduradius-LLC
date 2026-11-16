# Workspace performance: before and after pagination

These are **local measurements only**. They are not targets, and they say nothing about hosted performance.

## Method

Both versions were measured on the same synthetic dataset:

1. The dataset was seeded once with `scripts/perf/fresh-local-state.sh`.
2. The resulting local D1 state was copied unchanged for each run. The candidate also had migration 0007 applied (indexes only).
3. `tests/perf/compare.mjs` drove the workspace in Chromium against the local dev server and recorded every `/api/*` response.

Each version was run twice. Both values are shown as `run 1 / run 2`; run 1 includes cold dev-server compilation.

| | Baseline | Candidate |
| --- | --- | --- |
| Commit | `e07844b` (previous release candidate, separate worktree) | `af555c9` |
| Server | `pnpm dev` (vinext/Vite dev server with Miniflare D1) on 127.0.0.1 | same |
| Machine | Linux container, Node 22.23.4, Chromium (Playwright) | same |
| Date | 2026-11-16 | 2026-11-16 |

**Dataset.** It was written through the real store and route code:

- 1,200 public requests;
- 400 opportunities;
- 400 organizations and 600 contacts;
- 1,800 requirements (30 on each of 60 opportunities);
- 301 evidence records with 960 evidence links;
- 30 awarded pursuits, each with a proposal and version, a submission, a project with a baseline, 5 deliverables and 8 milestones;
- 6,131 activity events and 1,200 notifications.

## Results

| Scenario | Baseline | Candidate |
| --- | --- | --- |
| **`GET /api/workflow`** (median of 5; loaded on every workspace load and refresh) | **6,060,842 bytes**, 6,451 records, 243–275 ms | **22,101 bytes**, 70 summary items (no record collections), 28–32 ms |
| **Initial workspace load**: `/api/*` requests, bytes, time to network idle | 3 requests, **6,061,023 bytes**, 2,783 / 1,179 ms | 3 requests, **22,282 bytes**, 2,348 / 919 ms |
| Open Opportunities | 0 requests (preloaded), 400 cards rendered, 497 / 446 ms | 1 request, 53,361 bytes, 25 cards (one page), 238 / 143 ms |
| Open Organizations | 0 requests, 400 cards, 256 / 271 ms | 2 requests (page plus duplicate groups), 39,227 bytes, 25 cards, 92 / 89 ms |
| Search opportunities for the last-seeded record | 0 requests (in-memory filter), 66 / 68 ms | 1 request, 2,212 bytes, 433 / 417 ms (includes the 250 ms input debounce) |
| Search organizations for the newest record | 0 requests, 44 / 31 ms | 1 request, 1,652 bytes, 328 / 322 ms (includes the debounce) |
| Search organizations for the **oldest** record (beyond the first page) | 0 requests, 18 / 18 ms | 1 request, 1,651 bytes, 305 / 314 ms (includes the debounce) |
| Open a pursuit with 30 requirements (search, open, Requirements tab) | 0 requests, 519 / 588 ms | 2 requests (search plus context), 73,160 bytes, 1,020 / 1,024 ms (includes the debounce) |
| Export: the request, and the complete download checked against database counts | 1 request (`/api/workflow?activity=all`), 7,963,173 bytes; complete; 821 / 593 ms | 1 request (`/api/export`), 7,949,512 bytes; **complete** (every collection equals its table count); 686 / 579 ms |

**Server time per request (candidate, from browser timing, run 1 / run 2):**

| Request | Time |
| --- | --- |
| Summary | 125 / 31 ms (run 1 is cold) |
| List page | 21–83 ms |
| Pursuit context | 66 / 39 ms |
| Export of about 7.9 MB | 343 / 266 ms |

The baseline's single `/api/workflow` request took 204 ms server time in its second run.

## Interpretation

- **Load cost:** the bytes transferred on every workspace load fell from 6.06 MB to 22 KB (about 275 times less) on this dataset. Before the change they grew with every record; now they are bounded by the page size and the summary limits.
- **Per-view cost:** list views now issue one request each for one bounded page. Opening a pursuit is one context request (51.6 KB here), instead of keeping every record of every type in browser memory.
- **Searching is slower to feel:** an in-memory filter over preloaded data (about 20–70 ms) is faster than a server search (about 300–450 ms, of which 250 ms is the deliberate input debounce). That trade buys bounded loading, and search now covers records the page has not loaded. A slower, superseded search response is discarded (browser check).
- **Request pattern:** the first candidate build issued 32 requests (758 KiB) when opening a pursuit, because each requirement's evidence picker loaded its choices on mount. Pickers now load only when focused or typed into (2 requests, 73 KB). A browser check asserts that pickers make no requests until used.
- **Export completeness:** both exports were complete at this size. The baseline export silently stopped at 2,000 requests, 2,000 opportunities and 50,000 activity entries. The candidate reads every table in one transaction and refuses with 413 rather than truncating. Unit tests cover 2,100 opportunities and both refusal limits.

## Earlier measurements

The previous release package recorded 1.3 MiB for 80 organizations, 80 opportunities, 50 requirements and 60 evidence records, and 2.5 MiB for roughly double. That came from `tests/browser/volume.mjs` on candidate `36ce7a1` and is kept in [RELEASE.md](RELEASE.md) history. The same volume script on `af555c9` measured `GET /api/workflow` at 22 KiB and 24 ms, with 14/14 checks passing.

## Reproduce

```sh
scripts/perf/fresh-local-state.sh             # stop dev servers first; local state only
pnpm dev
D1_FILE=$(ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | grep -v metadata) \
  BASE=http://127.0.0.1:5173 node tests/perf/compare.mjs
```
