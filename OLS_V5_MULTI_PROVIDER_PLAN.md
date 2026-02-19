# OLS-v5 Plan: Add Gemini 3 Family + Latest GPT Mini

Last updated: 2026-02-11
Scope: `Prismatix` multi-provider routing expansion

## 1) Objective
Add support for:
- Gemini 3 family (Pro + Flash; optional Pro Image if needed)
- Latest GPT mini (OpenAI GPT-5 mini)

while preserving current Anthropic routing behavior and frontend stability.

## 2) Evidence Snapshot (Current State)
- Router model map is Anthropic-first in `supabase/functions/router/router_logic.ts`.
- Upstream call is hardcoded to Anthropic in `supabase/functions/router/index.ts`.
- Frontend model type includes Anthropic + OpenAI + Google keys in `prismatix-frontend/src/types.ts`.
- Frontend selector config is provider-aware in `prismatix-frontend/src/components/ChatInterface.tsx`.
- Frontend parses router-generic headers in `prismatix-frontend/src/smartFetch.ts`.
- DB schema already stores generic `model_used` text, so no mandatory schema change for new providers.

## 3) Provider/Model Verification (As Of 2026-02-11)
- Google docs list Gemini 3 Pro and Gemini 3 Flash as preview model families.
- Google docs also list Gemini 3 Pro Image (preview) for image generation workflows.
- OpenAI docs list GPT-5 mini with current snapshot notation (`gpt-5-mini-2025-08-07`) and alias usage (`gpt-5-mini`).

## 4) BCDP: Contract Changes + Impact
### Contract A: Frontend model union
Current: `AnthropicModel = 'opus-4.5' | 'sonnet-4.5' | 'haiku-4.5'`
- Impacted files:
  - `prismatix-frontend/src/types.ts`
  - `prismatix-frontend/src/components/ChatInterface.tsx`
  - `prismatix-frontend/src/smartFetch.ts`
- Severity: BREAKING if replaced in-place without backward-compatible aliasing.
- Mitigation: Introduce new generic type (`RouterModelKey`) and keep `AnthropicModel` alias during migration.

### Contract B: Header names consumed by frontend
Current headers: `X-Router-Model`, `X-Router-Model-Id`, `X-Model-Override`, `X-Router-Rationale`, `X-Complexity-Score`
- Impacted files:
  - `supabase/functions/router/index.ts`
  - `prismatix-frontend/src/smartFetch.ts`
- Severity: BREAKING if renamed only.
- Mitigation: Emit router-generic headers (`X-Router-Model`, `X-Router-Model-Id`, `X-Provider`) consistently across providers.

### Contract C: Manual override payload
Current payload uses router model keys across providers.
- Impacted files:
  - `prismatix-frontend/src/types.ts`
  - `prismatix-frontend/src/smartFetch.ts`
  - `supabase/functions/router/router_logic.ts`
  - `supabase/functions/router/index.ts`
- Severity: RISKY (parsing and fallback behavior changes).
- Mitigation: Support both legacy override values and new provider-prefixed format (for example `openai:gpt-5-mini`, `google:gemini-3.0-pro`).

## 5) Architecture Plan (Recommended)
### Phase 1: Backend provider abstraction (no frontend break)
1. Add provider registry in backend:
   - `provider`: `anthropic | openai | google`
   - model catalog with routing metadata and provider model IDs.
2. Keep existing route scoring logic, but change route result shape to include provider + model key + provider model ID.
3. Split upstream call paths:
   - `callAnthropicStream(...)`
   - `callOpenAIStream(...)`
   - `callGoogleStream(...)`
4. Normalize output to one SSE shape for frontend compatibility.
5. Continue emitting existing headers and add new provider-generic headers.

### Phase 2: Frontend model typing + selector expansion
1. Replace strict Anthropic-only model union with generic router model type.
2. Expand selector UI to provider-grouped options:
   - Claude: Opus/Sonnet/Haiku
   - OpenAI: GPT-5 mini
   - Google: Gemini 3 Pro/Flash
3. Keep auto mode default and show provider badge in UI.

### Phase 3: Routing policy update
1. Keep Anthropic routing as baseline.
2. Add policy gates for cross-provider routing, for example:
   - low-latency/low-cost -> GPT-5 mini or Gemini 3 Flash
   - multimodal heavy -> Gemini 3 Pro/Flash
   - deep reasoning/coding -> Claude Sonnet/Opus (until provider benchmarks justify changes)
3. Add feature flags to control provider participation in auto-routing.

## 6) Environment Variable Plan
Backend (Supabase Edge Function secrets):
- Existing: `ANTHROPIC_API_KEY`
- New: `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- Optional: `OPENAI_BASE_URL`, `GOOGLE_BASE_URL`, provider enable flags (`ENABLE_OPENAI`, `ENABLE_GOOGLE`)

Frontend:
- No mandatory new secret variables (provider calls remain server-side).

## 7) NAMIT Risk Pass (Relevant Only)
- N (Null/missing): missing provider keys, missing API keys, invalid override values.
- A (Array/boundary): mixed image + text attachments across providers; long history arrays.
- I (Input validation): override parsing must reject unsupported provider/model combos.
- T (Timing/async): provider timeouts, rate limits, partial SSE chunks, cancellation behavior.
- M (Concurrency): parallel requests with same conversation ID; ensure token/message persistence remains safe.

## 8) Validation Plan
- Unit tests:
  - route decision returns provider + model correctly
  - override parsing for legacy and new formats
  - provider fallback behavior when a provider is disabled/misconfigured
- Integration tests:
  - backend headers include both legacy and new names
  - stream normalization is consistent across all providers
- Frontend tests/manual checks:
  - selector updates and manual override badges
  - model/provider metadata displayed correctly
- regression check for existing Anthropic-focused flows

## 9) Rollout Strategy
1. Deploy backend with provider abstraction + compatibility headers first.
2. Keep auto-routing pinned to Anthropic until provider adapters are verified.
3. Enable OpenAI and Gemini providers behind feature flags.
4. Expand frontend selector once backend contract is stable.
5. Gradually enable multi-provider auto-routing by rule.

## 10) Decision Gates
Before implementation:
- Confirm whether Gemini 3 preview usage is acceptable in production.
- Confirm if GPT-5 mini should be only manual-select first, or included in auto-routing on day one.
- Confirm header policy for router-generic metadata fields.

Ready to implement. Type "ACT" to proceed.
