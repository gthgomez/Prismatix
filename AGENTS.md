# AGENTS.md — Prismatix

Purpose: sole instruction authority and quick entrypoint for agents working in Prismatix.

**Instruction authority:** this root `AGENTS.md` is the only agent instruction file in this repository. Model/vendor instruction files (`CLAUDE.md`, `GEMINI.md`, `CODEX.md`) and nested `AGENTS.md` files are prohibited. Normative content from the retired `docs/AGENTS.md` and `docs/GEMINI.md` was merged here; factual context lives in `docs/PROJECT_CONTEXT.md` and `docs/prismatix_PROJECT_CONTEXT.md`.

## Read Order

1. `../PROJECT_SAAS_BIBLE.md` (workspace file one level above this repository; if present)
2. `docs/PROJECT_CONTEXT.md`
3. `docs/prismatix_PROJECT_CONTEXT.md`
4. This file
5. Only the exact implementation files needed for the task

## Babel Local Mode

If the user says `use Babel`, `read the Bible`, `use the Babel system`, or asks for prompt-stack assembly, layer routing, or control-plane guidance, treat Babel Local Mode as active.

Canonical entrypoint: `BABEL_BIBLE.md` in the workspace `Babel-private` checkout (`../../Babel-private/BABEL_BIBLE.md` relative to this repository).

In Babel Local Mode:

1. Read `BABEL_BIBLE.md`.
2. Read the `Babel-private` checkout's `PROJECT_CONTEXT.md`.
3. Read this repo's `docs/PROJECT_CONTEXT.md`.
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
- Preserve normalized SSE behavior across providers; SSE normalization is a contract surface, not a cosmetic detail.
- Keep provider secrets server-side only.
- Keep cost logs aligned with actual provider/model execution.
- Treat migrations as compatibility-sensitive contract changes; state impacted tables and rollback implications before editing.

## How To Work Here

- Identify whether the task is frontend, router, stream-shape, or schema work before editing.
- Be concise, file-backed, and explicit about unknowns; separate observed facts, inference, and unknowns in non-trivial analysis.
- Name the exact provider, model, function, route, or migration before proposing edits.
- For stream or provider issues, inspect the owning router file before proposing broader refactors; do not refactor the whole routing layer to fix a localized bug.
- For auth or data-boundary issues, verify the exact query path and user scoping logic before changing behavior.
- Use PowerShell-native commands on Windows.

## Hallucination Controls

- Do not invent provider fields, SSE event shapes, or migration column names.
- Verify payload shapes against `provider_payloads.ts`, `router_logic.ts`, and `sse_normalizer.ts` before editing.
- Do not claim routing behavior from memory; inspect the current router code.
- For frontend changes, verify the actual props and fetch contract in the owning component and utility file.

## Verification Gates

- Frontend-only changes: `npm run type-check` and `npm run build`
- Frontend logic changes: run relevant Vitest tests when available
- Router changes: `deno check .\supabase\functions\router\index.ts`
- Router stream or payload changes: inspect adjacent router files for contract alignment
- Migration changes: state impacted tables and rollback implications before editing

## Quick Commands

```powershell
npm run type-check
npm run test
npm run build
deno check .\supabase\functions\router\index.ts
deno lint .\supabase\functions\router\
```

## Response Expectations

- Name the exact files inspected.
- If the task touches auth, routing, streaming, costs, or migrations, call out the risk before editing.
- Do not call work complete without naming the checks actually run.
