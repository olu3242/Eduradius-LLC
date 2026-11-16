# Dependency advisories

Audited on 2026-11-16 with `pnpm audit` (pnpm 11.25.0, GitHub advisory database), before and after the remediation commit. Version choices respect the repository's `minimumReleaseAge` policy (7 days), so the newest releases were not used.

## Summary

| Audit | Before | After |
| --- | --- | --- |
| `pnpm audit --prod` | 23 (3 critical, 7 high, 9 moderate, 4 low) | **0** |
| `pnpm audit` (all) | 86 (4 critical, 35 high, 36 moderate, 11 low) | **4** (3 moderate, 1 low), all in development or build tooling only |

The earlier triage (K4) concluded that the deployed bundles held no `next` package code, and that is still true. It **missed** that the deployed Worker includes the React Server Components runtime from `react-server-dom-webpack` (`decodeAction` / `decodeReply` in `dist/server/_next/static/framework~…js`). React 19.2.6 was affected by GHSA-xqc2-xf4c-x3h3 (critical, unauthenticated RCE in Server Components) and GHSA-wx67-qw84-cm4g (high, DoS in Server Functions). Absence from the bundle is no longer used as the sole reason to dismiss an advisory.

## Upgrades (direct)

| Package | From | To | Advisories closed | Exposure before the fix |
| --- | --- | --- | --- | --- |
| `react`, `react-dom`, `react-server-dom-webpack` | 19.2.6 | 19.2.9 | GHSA-xqc2-xf4c-x3h3, GHSA-wx67-qw84-cm4g | **Deployed Worker** (RSC request decoding) |
| `next`, `eslint-config-next` | 16.3.4 | 16.4.5 | 11 `next` advisories incl. GHSA-vcvr-r3jv-pc5j, GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr | Types and lint at build time; vinext provides the runtime shims, so no `next` package code ships |
| `vite` | 8.0.13 | 8.1.6 | 7 dev-server advisories (fs.allow/deny bypass, cross-origin script, launch-editor) | Local dev server (bound to 127.0.0.1) |
| `zod` | ^3.25.76 | ^4.6.7 | GHSA-mrhx-c7xc-m3w5 | Declared but not imported by application code; not in bundles |

## Overrides (patched release within the same major line)

Declared in `pnpm-workspace.yaml` (`overrides`). The npm-style `overrides` in `package.json` mirror the runtime-relevant entries.

| Package | From → To | Reached through | Exposure |
| --- | --- | --- | --- |
| `undici` | 7.24.8 → 7.30.2 | wrangler, miniflare | Build/deploy tooling. Wrangler's API calls go through a proxy agent; the advisories include TLS-validation bypasses in proxy and agent paths, so deploy credentials in transit were exposed |
| `ws` | 8.18.0 → 8.22.1 | wrangler, miniflare, @cloudflare/vite-plugin | Local dev and inspector sockets |
| `sharp` | 0.35.4 → 0.35.5 | next (optional), miniflare | Native image tooling; not in the Worker |
| `@babel/core` 7.29.13, `browserslist` 4.29.5, `baseline-browser-mapping` 2.11.35, `source-map-js` 1.2.2 | patched | next/styled-jsx, plugin-rsc, vinext, postcss | Build time |
| `fast-uri` 3.1.9 | patched | @hookform/resolvers → ajv | Not imported by application code |
| `brace-expansion` 1.1.21 / 5.0.12, `js-yaml` 4.3.2 | patched | eslint | Lint only |
| `image-size` 2.0.3, `fflate` 0.7.5 | patched | vinext | Build-time image handling |
| `esbuild@0.28` 0.28.2 | patched | vite | Dev server |
| `zod@3` → 4.6.7 | within the declared `^3.25.0 \|\| ^4.0.0` range | eslint-plugin-react-hooks | Lint only |

## Remaining advisories (accepted, not reachable in production)

| Advisory | Package | Path | Why it remains | Exposure |
| --- | --- | --- | --- | --- |
| GHSA-67mh-4wv8-2f99 (moderate) | esbuild 0.18.20 | drizzle-kit → @esbuild-kit | The fix needs esbuild ≥0.25, which @esbuild-kit's API does not allow | Exploitable only through `esbuild serve`, which drizzle-kit never starts. Used only for `pnpm db:generate` |
| GHSA-g7r4-m6w7-qqqr (low) | esbuild 0.27.3 | wrangler | 0.28 is a breaking line for wrangler 4.92 | Windows-only dev-server file read; development runs on Linux/macOS |
| GHSA-wx4j-mvgx-mqwp (moderate) | satori 0.16.0 | vinext → @vercel/og | The fix is satori 0.33 (a breaking line for @vercel/og 0.8) | `next/og` is not used; satori is absent from `dist/` |
| GHSA-g3hv-75wg-m249 (moderate) | minimatch 10.2.5 | eslint-config-next → typescript-estree | The fix is minimatch 11 (outside the declared range) | Lint globs come only from repository configuration |

**Recommended follow-up:** upgrade vinext and wrangler / @cloudflare/vite-plugin in a dedicated change. Both moved many releases ahead, which removes the remaining pins. That upgrade changes the framework and local runtime, so it needs its own full verification.

## Compatibility evidence (this change only, local)

Run on Node 22.23.4 with pnpm 11.25.0 and the upgraded lockfile:

- `tsc --noEmit`: pass.
- Lint: 0 errors (the same 13 `<img>` warnings).
- `pnpm test`: 96/96.
- `pnpm build`: pass; the bundle carries React 19.2.9 and no 19.2.6.
- `pnpm test:worker`: 2/2.
- Browser journeys on a fresh database:
  - Stage 1–2 journey with a legacy-shaped document (`scripts/perf/fresh-local-state.sh --legacy`): 30/30.
  - Contracting journey: 27/27.

Re-run the audits with:

```sh
pnpm audit --prod
pnpm audit
```
