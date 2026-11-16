#!/usr/bin/env bash
# End-to-end suite: builds the web app for production into its own dist dir (never touches the dev `.next`), builds the API,
# then runs Playwright, which starts the API on :4100 and the web app on :3200 itself (the ports are fixed so they cannot clash with
# dev servers on 4000/3100). Needs: Postgres/Redis/MinIO/ClamAV from `pnpm infra:up`, a migrated database, `.env`, and Google Chrome.
# Usage: scripts/e2e.sh [playwright args, e.g. tests/02-leads.spec.ts --repeat-each=2]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env (copy .env.example and fill the secrets; see docs/setup-guide.md)"; exit 1; }

echo "== build API and the shared packages the web app imports"
pnpm exec turbo run build --filter=@leadpilot/api --filter=@leadpilot/validation --filter=@leadpilot/shared-types
echo "== build web for e2e (API at http://localhost:4100)"
NEXT_DIST_DIR=node_modules/.cache/next-e2e NEXT_PUBLIC_API_URL=http://localhost:4100 pnpm --filter @leadpilot/web exec next build
echo "== run Playwright"
exec pnpm exec playwright test --config e2e/playwright.config.ts "$@"
