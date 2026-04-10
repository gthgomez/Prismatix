# AGENTS.md - Prismatix Antigravity Router

Purpose: quick entrypoint for agents working in Prismatix.

## Read Order

1. `..\PROJECT_SAAS_BIBLE.md`
2. `PROJECT_CONTEXT.md`
3. `prismatix_PROJECT_CONTEXT.md`
4. This file
5. If running Gemini, read `GEMINI.md`
6. Read only the exact implementation files needed for the task

## Babel Local Mode

If the user says `use Babel`, `read the Bible`, `use the Babel system`, or asks for prompt-stack assembly, layer routing, or control-plane guidance, treat Babel Local Mode as active.

Canonical entrypoint:
`C:\Workspace\Babel-private\BABEL_BIBLE.md`

In Babel Local Mode:
1. Read `BABEL_BIBLE.md`.
2. Read `C:\Workspace\Babel-private\PROJECT_CONTEXT.md`.
3. Read this repo `PROJECT_CONTEXT.md`.
4. Load only the relevant Babel layers and any repo rules or skills.
5. Follow the assembled stack before planning or acting.

Do not improvise the Babel stack from memory.

## Repo Map

- `src/` - frontend UI, auth hooks, pricing displays, and fetch logic
- `supabase/functions/router/` - routed generation, provider payloads, SSE normalization, cost accounting
- `supabase/migrations/` - schema and policy history

## High-Risk Zones

- `supabase/functions/router/index.ts`
- `supabase/functions/router/router_logic.ts`
- `supabase/functions/router/provider_payloads.ts`
- `supabase/functions/router/sse_normalizer.ts`
- `supabase/functions/router/cost_engine.ts`
- `supabase/migrations/`
- `src/lib/supabase.ts`

## Non-Negotiables

- Preserve conversation ownership checks and user scoping.
- Preserve normalized SSE behavior across providers.
- Keep provider secrets server-side only.
- Keep cost logs aligned with actual provider/model execution.
- Treat migrations as compatibility-sensitive.

## Quick Commands

```powershell
npm run type-check
npm run test
npm run build
deno check .\supabase\functions\router\index.ts
deno lint .\supabase\functions\router\
```

## How To Work Here

- Identify whether the task is frontend, router, stream-shape, or schema work before editing.
- For stream or provider issues, inspect the owning router file before proposing broader refactors.
- For auth or data-boundary issues, verify the exact query path and user scoping logic before changing behavior.
- Keep summaries short and file-backed; verification matters more than theory.
