# PROJECT_CONTEXT.md - Prismatix

Purpose: project facts and navigation for Prismatix contributors.

Repository: this repository (Prismatix; clone root is the folder above `docs/`).
Product: multi-provider chat and routing system with streaming responses, cost tracking, debate mode, and Supabase-backed conversation storage.

## Startup

Start with the root [AGENTS.md](../AGENTS.md) and this context. Use
[prismatix_PROJECT_CONTEXT.md](prismatix_PROJECT_CONTEXT.md) for deeper product
context when the task needs it. Standalone clones do not require sibling
workspace files.

Note: the root `AGENTS.md` is the sole instruction authority. Vendor instruction files (`GEMINI.md`, `CLAUDE.md`, `CODEX.md`) and nested `AGENTS.md` files are prohibited and have been retired.

## What This Repo Is

- `src/` is the Vite + React frontend shell.
- `supabase/functions/router/` is the edge-function router for provider routing, debate mode, and streaming normalization.
- `supabase/migrations/` owns persistence contracts for conversations, messages, memory, costs, and video pipeline artifacts.

## System Topology

- **Frontend:** React 18 + Vite + TypeScript
- **Backend:** Supabase Edge Function router in Deno
- **Persistence:** Supabase tables managed by SQL migrations
- **Streaming:** normalized SSE emitted from the router
- **Routing:** provider selection and payload shaping live under `supabase/functions/router/`

## Key Files

- `src/App.tsx` - top-level frontend app shell
- `src/components/ChatInterface.tsx` - primary chat interaction surface
- `src/hooks/useAuth.ts` - auth state wiring in the frontend
- `src/lib/supabase.ts` - frontend Supabase client setup
- `supabase/functions/router/index.ts` - router edge function entrypoint
- `supabase/functions/router/router_logic.ts` - route decision logic and model registry usage
- `supabase/functions/router/provider_payloads.ts` - provider-specific request shaping
- `supabase/functions/router/sse_normalizer.ts` - normalized stream handling
- `supabase/functions/router/cost_engine.ts` - cost accounting logic
- `supabase/migrations/` - schema and policy history

## High-Risk Zones

- `supabase/functions/router/index.ts`
- `supabase/functions/router/router_logic.ts`
- `supabase/functions/router/provider_payloads.ts`
- `supabase/functions/router/sse_normalizer.ts`
- `supabase/functions/router/cost_engine.ts`
- `supabase/migrations/`
- `src/lib/supabase.ts`

## Core Invariants

- Preserve conversation ownership and user scoping for all reads and writes.
- Keep SSE output normalized across providers.
- Keep cost tracking aligned with the actual selected provider/model path.
- Never leak provider secrets to frontend code.
- Treat migration changes as contract changes.

## Quick Commands

Frontend:
```powershell
npm run type-check
npm run test
npm run build
```

Router:
```powershell
deno check .\supabase\functions\router\index.ts
deno lint .\supabase\functions\router\
```

## Babel Local Mode

Use the [root Babel Local Mode route](../AGENTS.md#babel-local-mode) when the
task requires the Babel prompt stack. Ordinary Prismatix work does not require
that checkout.
