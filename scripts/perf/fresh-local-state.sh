#!/usr/bin/env bash
# Recreates the LOCAL Miniflare D1 state (.wrangler/state) from every migration, then seeds the
# synthetic measurement dataset (default), nothing (--empty) or a legacy-shaped document (--legacy). Destroys local data only; stop dev servers first.
set -euo pipefail
cd "$(dirname "$0")/../.."
rm -rf .wrangler/state
for f in drizzle/0*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local \
    --config dist/server/wrangler.json --persist-to .wrangler/state --file "$f" >/dev/null
done
file=$(ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | grep -v metadata)
case "${1:-}" in
  --empty) ;;
  --legacy) node --no-warnings --import ./tests/register.mjs scripts/local/seed-legacy-document.mjs "$file" ;;
  *) node --no-warnings --import ./tests/register.mjs scripts/perf/seed-dataset.mjs "$file" ;;
esac
