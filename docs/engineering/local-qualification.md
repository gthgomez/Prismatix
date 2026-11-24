# Local full-stack qualification

This is the reproducible, isolated environment used for the November 2026
reliability campaign. It runs the **actual** Supabase stack locally — Postgres,
GoTrue Auth, PostgREST/RLS, Storage and the Edge runtime — so browser and API
journeys exercise real boundaries instead of HTTP mocks.

It never contacts a live AI provider. The router is pointed at
`scripts/qualification/stub-provider.mjs` through its supported
`OPENROUTER_BASE_URL` seam.

## Safety contract

All qualification scripts resolve their target through
`scripts/qualification/env-contract.mjs`:

- loopback (`127.0.0.1` / `localhost` / `::1`) is allowed automatically;
- a hosted target is allowed **only** when its hostname is a
  `<project-ref>.supabase.co` identity whose ref is listed in
  `QUALIFICATION_ALLOWED_PROJECT_REFS` **and**
  `QUALIFICATION_ENVIRONMENT=staging|preview`;
- the production ref is denied unconditionally, even if allowlisted;
- a remote stub provider requires `QUALIFICATION_ALLOWED_STUB_HOSTS`;
- the router endpoint must share the Supabase host;
- a boolean such as `ALLOW_NONLOCAL_QUALIFICATION` is never sufficient.

`npm run qual:env` runs the negative controls for this contract (14 cases,
including production, production subdomains, malformed URLs, embedded
credentials, router-host mismatch and remote stubs). Run it before any hosted
qualification.

- `OPENROUTER_BASE_URL` is set only in `supabase/functions/.env`, which is
  gitignored. Never copy it into hosted secrets.
- Do not reuse these credentials or fixtures in a hosted project. Production
  authorization is a separate, explicit decision.
- Test data is disposable: users `qual-a@example.test` / `qual-b@example.test`,
  a fake BYOK credential, and local-only rows.

## Prerequisites

- Docker Desktop (working daemon; verified with 29.x)
- Node 20.19+/22.12+/24 and npm 10+
- Supabase CLI. Pinned for this campaign: **2.98.2**
  (`npx --yes supabase@2.98.2 …`). On the Windows host used here, CLI 2.114.0
  failed with `failed to copy secret file into container: Access is denied`;
  2.98.2 starts the stack reliably. Re-test before upgrading.
- Shell defaults: run unit tests with `NODE_ENV=test`. The ambient environment
  may set `NODE_ENV=production`, which swaps React to its production build and
  produces false `act(...) is not supported` failures.

## Bring the stack up

```powershell
# 1. Start the local stack (applies all migrations through the CLI).
npx --yes supabase@2.98.2 start

# 2. Export the local keys for the shell.
npx --yes supabase@2.98.2 status -o env
# copy ANON_KEY / SERVICE_ROLE_KEY / API_URL into the environment
```

Migrations are applied by `supabase start` through the real migration runner
(`supabase/migrations`, 34 files at this commit, including the cost-log
breakdown-provenance migration). To replay from scratch:

```powershell
npx --yes supabase@2.98.2 db reset
```

**Start a full browser run from a clean database.** Every turn reserves budget
(up to `$0.10` per execution) against the test user's `$0.50` daily grant.
Failed or cancelled turns can leave `pending_reconcile` holds, and repeated runs
without a reset eventually produce `402 insufficient_budget` — which looks like
a broken app but is fixture exhaustion. `db reset` + `qual:seed` is the
deterministic setup the CI job uses.

## Seed identities and provider material

```powershell
$env:SUPABASE_URL='http://127.0.0.1:54321'
$env:SUPABASE_ANON_KEY='<ANON_KEY>'
$env:SUPABASE_SERVICE_ROLE_KEY='<SERVICE_ROLE_KEY>'
npm run qual:seed
```

The script creates two confirmed Auth users, writes an enabled OpenRouter BYOK
row through the service-role RPC, sets the default provider, and verifies that
the signup trigger created an access grant. It prints the user ids and the
non-secret BYOK encryption key.

## Deterministic provider substitute

```powershell
node scripts/qualification/stub-provider.mjs
```

- Binds `127.0.0.1:8899`, performs no outbound I/O, records request metadata
  (never credential values).
- Scenarios: `default`, `slow`, `streaming` (interruptible), `error`,
  `malformed`, `empty`, `no-usage`, `zero`.
- Control: `POST /__control {"scenario":"streaming"}`, `GET /__requests`,
  `POST /__reset`.

## Edge functions

Create `supabase/functions/.env` (gitignored):

```dotenv
OPENROUTER_BASE_URL=http://host.docker.internal:8899/v1
BYOK_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
ALLOWED_ORIGIN=http://127.0.0.1:4174
ENABLE_ANTHROPIC=false
ENABLE_OPENAI=false
ENABLE_GOOGLE=false
ENABLE_OPENCODE=false
ENABLE_NVIDIA=false
ENABLE_DEEPINFRA=false
ENABLE_VIDEO_PIPELINE=false
```

```powershell
npx --yes supabase@2.98.2 functions serve --env-file supabase/functions/.env
```

The Edge runtime is a container: `127.0.0.1` inside it is the container, not
the host. That is why the stub uses `host.docker.internal`. `ALLOWED_ORIGIN`
must match the preview origin — the router locks CORS to it.

## Run the qualification checks

| Command | Proves |
|---|---|
| `npm run qual:env` | 14 negative controls for the shared environment contract |
| `npm run qual:smoke` | Acceptance gate: fixture content, execution identity, settled receipt, 40/12 provider tokens, independently computed `$0.000075` total, components reconcile, exactly one chat call, two messages, no duplicate settlement — plus 10 negative controls that must be rejected and the `pending/estimated` and `settled/confirmed-zero` breakdown states |
| `npm run qual:isolation` | 14 cross-account / anonymous / service-role boundary checks against real RLS |
| `npm run qual:e2e` | Builds against the local stack and runs `tests/e2e-real/` (persistence, mid-stream stop, account isolation, provider-readiness race, mobile) |
| `npm run qual:screens` | Desktop/mobile light+dark screenshots under `docs/engineering/campaigns/evidence/` |
| `npm run qual:ci` | The whole sequence above on a Linux host (used by the `real-backend` CI job) |

The smoke gate fails with a non-zero exit and a labelled failure list when a
business invariant is wrong; it is not a diagnostic printer. Expected money is
derived from the reviewed tariff constant and the stub fixture, not from the
implementation under test.

The real E2E config (`playwright.real.config.ts`) sets
`reuseExistingServer: false` so it always serves a freshly built bundle on
port 4174. Its `beforeAll` warms the Edge runtime once so a cold module compile
is not mistaken for a stuck generation. Call counts exclude the separately
metered background memory extraction (`stream_options.include_usage`).

## CI

`.github/workflows/ci.yml` runs:

- `Migrations · fresh + existing install` — fresh replay, the cron-surface
  replay, and `tests/integration/run-main-upgrade.sh`, which builds a baseline
  from **origin/main's actual migration set**, seeds historical/invalid rows,
  then upgrades with `supabase migration up --db-url` and verifies history,
  NOT VALID guards, preserved totals and preserved reservations.
- `Environment isolation` — the Vercel guard plus the qualification contract
  negative controls.
- `Real backend · Supabase + Edge + browser` — boots the stack, applies
  migrations, serves the Edge functions against the stub, seeds identities,
  runs the acceptance gate, isolation checks and the real Chromium suite.

## Cleanup

```powershell
# stop the preview / stub / functions processes you started
npx --yes supabase@2.98.2 stop
```

## What this environment does not prove

- Hosted Supabase behavior (managed Auth policy, PostgREST grants, Edge
  deployment versions, `pg_cron`/Vault privileges) — those require a
  nonproduction hosted project.
- Live provider streaming, billing and real tariffs.
- Physical-device keyboards, screen readers, and native browser zoom on mobile.
- Vercel preview behavior; the isolation guard intentionally refuses a preview
  built against the production project.
