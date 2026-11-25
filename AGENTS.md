# AGENTS.md — Prismatix

This is the repository's sole agent-instruction file. Do not add vendor-specific
or nested instruction files. Product facts and architecture belong in
`docs/PROJECT_CONTEXT.md` and `docs/prismatix_PROJECT_CONTEXT.md`; read the
relevant context before changing unfamiliar areas.

## Project map

- `src/`: React/Vite client, authentication, provider settings, and chat UX.
- `supabase/functions/router/`: provider resolution, request payloads, SSE
  normalization, persistence, and cost accounting.
- `supabase/functions/provider-settings/` and `supabase/functions/_shared/`:
  per-user provider configuration and BYOK secret handling.
- `supabase/migrations/`: persistence, ownership, and policy contracts.

## Security and correctness invariants

- Preserve authenticated user ownership and row-level scoping on every read and
  write. Verify the actual query/RPC path before changing an auth or data boundary.
- Keep provider credentials out of frontend code, logs, and client responses.
  BYOK keys are encrypted server-side at rest; provider settings return metadata,
  never plaintext keys. Preserve the encryption and per-user key isolation path.
- Preserve normalized SSE behavior across providers and align cost records with
  the provider/model that actually ran. Do not fabricate settled usage or cost.
- Treat provider payloads and routing rules as provider-specific contracts.
  Inspect the owning router/provider files; do not guess fields or broaden a
  localized fix into an unrelated routing refactor.
- Treat migrations as compatibility-sensitive contracts. Before changing one,
  identify affected tables and callers, compatibility implications, and rollback
  considerations. Do not apply or deploy migrations unless the active task
  authorizes that target and effect.
- Follow the applicable workspace independent-review policy and repository
  protections. Local checks do not waive required review or release gates.

## Routes and local environment

- `/demo` and `/about` render the public `ResumeDemo` without loading
  `AuthenticatedApp`; they do not require Supabase configuration.
- Other paths load the authenticated app and Supabase client. For real auth and
  backend behavior, provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
  `VITE_ROUTER_ENDPOINT` is optional: the client derives the router URL from the
  Supabase URL unless a same-host endpoint is supplied. Missing settings can
  fall back to mock configuration, so a page rendering is not proof that auth
  or backend requests work.
- `.nvmrc` selects Node 22.12.0; `package.json` accepts Node `^20.19.0` or
  `>=22.12.0` and npm 10+. CI currently uses Node 20 and Deno 2.x. These are
  repository-supported versions; do not rely on one agent VM's installed paths
  or patch versions.
### Babel Local Mode

For tasks that require the Babel prompt stack, find the authorized checkout
that owns `BABEL_BIBLE.md` (`babel-private` in the managed workspace catalog,
or a user-provided location). Follow its Bible and `PROJECT_CONTEXT.md` to
resolve the relevant stack. If that checkout is unavailable, report the
dependency and continue work that does not require it.

## Verification

- Frontend changes: `npm run type-check` and `npm run build`.
- Frontend behavior changes: run relevant Vitest tests with `npm run test`.
- Router, provider, or BYOK changes: run the relevant tests and
  Deno check for the affected Edge Function, for example
  `deno check --config supabase/functions/deno.json supabase/functions/router/index.ts`.
  Run `deno lint supabase/functions/router/` for router edits. For BYOK changes,
  verify encrypted-at-rest storage and that plaintext stays server-side.
- Stream or payload changes: inspect adjacent router and client parsing code for
  contract alignment; test the affected provider path when available.
- Migration changes: report impacted tables/callers and rollback considerations,
  and verify compatibility before any separately authorized application.
- Run `npm run lint` for lint-relevant source changes. CI also runs
  `npm run type-check`, `npm run lint`, `npm run test`, `npm run build`, Deno
  checks for Edge Function entrypoints, and Playwright acceptance tests.

Useful repository checks:

```sh
npm ci
npm run type-check
npm run lint
npm run test
npm run build
deno check --config supabase/functions/deno.json supabase/functions/router/index.ts
deno check --config supabase/functions/deno.json supabase/functions/provider-settings/index.ts
npx playwright install chromium
npx playwright test --project=chromium
```

On a fresh Linux setup without browser system dependencies, CI uses
`npx playwright install --with-deps chromium`.

Report the exact files and checks actually used, their results, and any
unverified behavior. State the highest observed delivery stage; passing local
checks does not establish CI, review, migration application, or deployment.
