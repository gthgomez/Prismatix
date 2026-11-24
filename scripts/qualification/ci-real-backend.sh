#!/usr/bin/env bash
# End-to-end real-backend qualification on an isolated Linux runner.
#
# Boots the actual Supabase stack (Postgres/GoTrue/PostgREST/Storage/Edge),
# applies every migration through the real runner, serves the Edge functions
# against the deterministic provider substitute, then runs the acceptance,
# account-isolation and browser suites. No live provider is contacted.
#
# Usage: bash scripts/qualification/ci-real-backend.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# The CLI is pinned: 2.98.2 is the version used for the recorded qualification
# evidence, and newer CLIs have a Windows host regression in `start` (secret
# copy). Bump deliberately, with a full run.
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.98.2}"
export SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
export STUB_URL="${STUB_URL:-http://127.0.0.1:8899}"
export PLAYWRIGHT_PORT="${PLAYWRIGHT_PORT:-4174}"
export QUALIFICATION_ENVIRONMENT=local

log() { printf '\n[ci-real-backend] %s\n' "$*"; }

cleanup() {
  set +e
  if [[ -n "${FUNCTIONS_PID:-}" ]]; then kill "$FUNCTIONS_PID" 2>/dev/null; fi
  if [[ -n "${STUB_PID:-}" ]]; then kill "$STUB_PID" 2>/dev/null; fi
  npx --yes "supabase@${SUPABASE_CLI_VERSION}" stop >/dev/null 2>&1
}
trap cleanup EXIT

log "provider substitute (no outbound network)"
STUB_HOST=0.0.0.0 STUB_ALLOW_NETWORK_BIND=1 \
  node scripts/qualification/stub-provider.mjs > /tmp/stub-provider.log 2>&1 &
STUB_PID=$!
for _ in $(seq 1 100); do
  if curl -fsS "${STUB_URL}/__health" >/dev/null 2>&1; then break; fi
  sleep 0.2
done
curl -fsS "${STUB_URL}/__health" >/dev/null

log "Supabase stack + migrations (CLI ${SUPABASE_CLI_VERSION})"
npx --yes "supabase@${SUPABASE_CLI_VERSION}" start
npx --yes "supabase@${SUPABASE_CLI_VERSION}" db reset --no-seed

STATUS_ENV="$(npx --yes "supabase@${SUPABASE_CLI_VERSION}" status -o env)"
status_value() {
  printf '%s\n' "$STATUS_ENV" \
    | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" \
    | head -n 1
}
export SUPABASE_ANON_KEY="$(status_value ANON_KEY)"
export SUPABASE_SERVICE_ROLE_KEY="$(status_value SERVICE_ROLE_KEY)"
if [[ -z "$SUPABASE_ANON_KEY" || -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo "could not read local API keys from 'supabase status -o env'" >&2
  printf '%s\n' "$STATUS_ENV" >&2
  exit 1
fi

PROJECT_ID="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -n 1)"
NETWORK="supabase_network_${PROJECT_ID}"
GATEWAY="$(docker network inspect "$NETWORK" -f '{{(index .IPAM.Config 0).Gateway}}')"
if [[ -z "$GATEWAY" ]]; then
  echo "could not resolve the Docker gateway for $NETWORK" >&2
  exit 1
fi
log "Edge runtime reaches the stub at http://${GATEWAY}:8899"

# Non-secret fixture key/ciphertext shared with seed-local.mjs.
cat > supabase/functions/.env <<EOF
OPENROUTER_BASE_URL=http://${GATEWAY}:8899/v1
BYOK_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
ALLOWED_ORIGIN=http://127.0.0.1:${PLAYWRIGHT_PORT}
ENABLE_ANTHROPIC=false
ENABLE_OPENAI=false
ENABLE_GOOGLE=false
ENABLE_OPENCODE=false
ENABLE_NVIDIA=false
ENABLE_DEEPINFRA=false
EOF

log "Edge functions"
npx --yes "supabase@${SUPABASE_CLI_VERSION}" functions serve \
  --env-file supabase/functions/.env > /tmp/functions-serve.log 2>&1 &
FUNCTIONS_PID=$!
for _ in $(seq 1 180); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "${SUPABASE_URL}/functions/v1/router" || true)"
  if [[ "$code" == "200" ]]; then break; fi
  sleep 1
done
code="$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "${SUPABASE_URL}/functions/v1/router" || true)"
if [[ "$code" != "200" ]]; then
  echo "router did not become ready (HTTP $code)" >&2
  tail -n 50 /tmp/functions-serve.log >&2 || true
  exit 1
fi

log "seed disposable identities"
node scripts/qualification/seed-local.mjs > /tmp/seed.log

log "API acceptance gate (assertions, not diagnostics)"
node scripts/qualification/smoke-router.mjs

log "account isolation"
node scripts/qualification/isolation-check.mjs

log "real-backend browser journeys"
npx playwright install --with-deps chromium
node scripts/qualification/run-real-e2e.mjs

log "real-backend qualification passed"
