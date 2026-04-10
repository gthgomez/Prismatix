# PROJECT_CONTEXT.md - Prismatix

Purpose: first-read context for Prismatix in this workspace.

Repository: `C:\Workspace\Project_SaaS\Prismatix`
Product: multi-provider chat and routing system with streaming responses, cost tracking, debate mode, and Supabase-backed conversation storage.

## Required Startup Order

1. Read `..\PROJECT_SAAS_BIBLE.md`.
2. Read this file.
3. Read `prismatix_PROJECT_CONTEXT.md`.
4. Read `AGENTS.md`.
5. If running Gemini, read `GEMINI.md`.
6. Load only the smallest additional file set needed for the active task.

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
