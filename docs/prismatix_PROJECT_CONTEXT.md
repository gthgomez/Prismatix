# prismatix_PROJECT_CONTEXT.md - Deep Context

Purpose: deeper architecture and invariants for Prismatix beyond the startup entry file.

## Product Shape

Prismatix is a routed chat product that can:

- select among multiple model providers
- stream normalized output back to the client
- track usage and cost
- support debate and structured multi-model flows
- persist conversations, messages, and memory in Supabase

## Contract Surfaces

### Frontend Contract

- `src/components/ChatInterface.tsx` is the primary user-facing chat flow.
- `src/modelCatalog.ts` and `src/pricingRegistry.ts` shape model selection and display.
- `src/smartFetch.ts` is the frontend network path and should stay aligned with backend response behavior.

### Router Contract

- `supabase/functions/router/index.ts` is the only edge-function entrypoint for routed generation.
- `router_logic.ts` decides providers and models.
- `provider_payloads.ts` translates normalized input into provider-native payloads.
- `sse_normalizer.ts` is the compatibility surface that keeps streamed output uniform.

### Persistence Contract

- Conversation and message storage begins in `20260210000000_init_conversations_messages.sql`.
- User memory and cost logging are added in later migrations and must remain backward compatible.
- Migration files are historical contract artifacts and should be treated as high-risk changes.

## Failure Modes To Guard Against

- Provider payload drift causing runtime 4xx/5xx failures
- SSE format drift breaking the frontend stream parser
- Ownership or auth regressions exposing another user's conversation data
- Cost accounting mismatch between selected model and recorded charges
- Schema changes that silently break older rows or queries

## Change Classification

- `COMPATIBLE`: internal cleanup with no API, schema, or stream-shape change
- `RISKY`: changes routing behavior, UI-visible model behavior, auth checks, or cost handling
- `BREAKING`: changes stream shape, persistence schema expectations, or ownership boundaries

## Verification Expectations

- Frontend changes: `npm run type-check` and `npm run build`
- Frontend logic or fetch changes: run relevant Vitest tests when available
- Router changes: `deno check .\supabase\functions\router\index.ts`
- Migration changes: explicitly describe impacted tables, queries, and rollback considerations

## Scope Rule

Do not refactor the whole routing layer to solve a localized provider or stream bug. Fix the owning file first and only widen scope if the evidence requires it.
