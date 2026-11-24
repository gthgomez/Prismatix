# Local full-stack qualification

This is the reproducible, isolated environment used for the November 2026
reliability campaign. It runs the **actual** Supabase stack locally — Postgres,
GoTrue Auth, PostgREST/RLS, Storage and the Edge runtime — so browser and API
journeys exercise real boundaries instead of HTTP mocks.

It never contacts a live AI provider. The router is pointed at
`scripts/qualification/stub-provider.mjs` through its supported
`OPENROUTER_BASE_URL` seam.

## Safety contract

- Everything below is local (`127.0.0.1`). The seed script refuses any
  non-loopback `SUPABASE_URL` unless `ALLOW_NONLOCAL_QUALIFICATION=1` is set.
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
(`supabase/migrations`, 33 files at this commit). To replay from scratch:

```powershell
npx --yes supabase@2.98.2 db reset
```

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
| `npm run qual:smoke` | Auth → RLS insert → router → stub → settled receipt → cost log → persisted messages |
| `npm run qual:isolation` | 14 cross-account / anonymous / service-role boundary checks against real RLS |
| `npm run qual:e2e` | Builds against the local stack and runs `tests/e2e-real/` in Chromium (persistence, mid-stream stop, account isolation, mobile) |
| `npm run qual:screens` | Desktop/mobile light+dark screenshots under `docs/engineering/campaigns/evidence/` |

The real E2E config (`playwright.real.config.ts`) sets
`reuseExistingServer: false` so it always serves a freshly built bundle on
port 4174.

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
