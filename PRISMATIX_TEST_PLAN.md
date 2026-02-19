# Prismatix Test Plan

Last updated: 2026-02-11  
Scope: rebrand alignment + recent router/frontend additions (Gemini dynamic resolution, GPT mini routing, Gemini Flash thinking levels, auth refresh hardening, long-term memory retrieval/summarization, streaming UX behavior)

## 1. Preconditions

- Supabase project secrets are set: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- Feature flags are aligned with intended test surface: `ENABLE_ANTHROPIC=true`, `ENABLE_OPENAI=true`, `ENABLE_GOOGLE=true`
- Frontend env vars are set in `prismatix-frontend/.env`:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_ROUTER_ENDPOINT`
- Database migration applied:
  - `supabase/migrations/20260211070000_add_user_memory.sql`

## 2. Automated Validation (Fast Gate)

Run from repository root unless noted:

```bash
cd prismatix-frontend
npm install
npm run type-check
npm run build
```

```bash
cd ..
deno check supabase/functions/router/index.ts
deno test Tests/Router_test_v2.ts
```

Pass criteria:
- All commands exit 0.
- Frontend build artifact exists at `prismatix-frontend/dist`.
- Router tests validate default Gemini Flash routing and provider overrides.

## 3. Rebrand & Folder Integrity Tests

### RB-01 Folder structure
- Verify `prismatix-frontend/` exists and no legacy frontend folder alias remains.
- Verify `vercel.json` build/install/dev/output commands point to `prismatix-frontend`.

### RB-02 Brand text consistency
- Search for stale branding:

```bash
rg -n "legacy-router-name|legacy-frontend-folder" README.md PROJECT_CONTEXT.md prismatix-frontend supabase
```

Expected:
- No stale folder references.
- No stale deployment aliases from pre-rebrand naming.

## 4. Router Behavior Tests

### RT-01 Default auto route (cost-optimized)
Steps:
- Send a normal web text query with no manual override.
Expected:
- Response headers include `X-Router-Model: gemini-3-flash`.
- `X-Provider: google`.

### RT-02 Manual override matrix
Run one request each with `modelOverride` set to:
- `gemini-3-flash`
- `gemini-3-pro`
- `gpt-5-mini`
- `sonnet-4.5`

Expected:
- `X-Model-Override` reflects selected value.
- `X-Router-Model` and `X-Provider` align with provider registry.

### RT-03 Gemini alias resolution robustness
Steps:
- Trigger Gemini requests after cache clear/redeploy.
Expected:
- Router resolves aliases via Google `GET /v1beta/models`.
- No 502 with provider detail indicating missing hardcoded preview model IDs.

### RT-04 Provider fallback
Steps:
- Temporarily disable Google (`ENABLE_GOOGLE=false`) and send default query.
Expected:
- Router falls back to `gpt-5-mini` when OpenAI is enabled, else Anthropic fallback.

## 5. Gemini Flash Thinking-Level Tests

### GT-01 UI default
Steps:
- Load app and inspect thinking toggle state.
Expected:
- `High` is selected by default.

### GT-02 Header and message metadata
Steps:
- Send query with Flash selected and thinking `low`, then `high`.
Expected:
- Header `X-Gemini-Thinking-Level` matches selected level.
- Assistant message metadata includes `thinking:low` or `thinking:high`.

### GT-03 Non-Flash model behavior
Steps:
- Select `sonnet-4.5` or `gpt-5-mini` and send query.
Expected:
- Request still succeeds.
- Thinking toggle does not break non-Gemini calls.

## 6. Auth Resilience Tests

### AU-01 No aggressive sign-out churn
Steps:
- Keep tab open, allow token refresh window to pass, then send request.
Expected:
- No immediate `SIGNED_OUT` loop from stale refresh handling.

### AU-02 Router 401 retry path
Steps:
- Force a temporary invalid access token scenario and send request.
Expected:
- Client retries once on 401.
- Local sign-out occurs only after retry fails with 401.

## 7. Memory Pipeline Tests

### MM-01 Summarization write path
Steps:
- Create long enough conversation to cross summarization thresholds.
Expected:
- New row inserted into `public.user_memories`.
- `public.conversation_memory_state` updates `last_summarized_*` fields.

### MM-02 Retrieval inject path
Steps:
- Start a new request with terms related to past memory.
Expected:
- Router retrieves relevant memories and injects context block.
- Response includes `X-Memory-Hits` and `X-Memory-Tokens`.

### MM-03 Safety boundary
Steps:
- Ask unrelated query after memory exists.
Expected:
- Irrelevant memory is not injected aggressively (low/no hits).

## 8. Streaming UX Tests

### UX-01 Spinner lifecycle
Steps:
- Send message and observe loading indicator.
Expected:
- Spinner appears on send and clears on first streamed token.

### UX-02 Smart autoscroll
Steps:
- Start streaming response, then scroll upward while stream continues.
Expected:
- Auto-scroll stops while user is reading history.
- Auto-scroll resumes when user returns near bottom.

### UX-03 New message anchor behavior
Steps:
- Send new prompt during active chat.
Expected:
- View aligns to new assistant bubble creation, not every token.

## 9. Deployment Smoke Tests

### DP-01 Supabase function deploy
- Deploy router function and verify `router` endpoint returns 200 for valid authenticated call.

### DP-02 Vercel frontend deploy
- Deploy frontend and verify:
  - Sign in works.
  - Chat streaming works.
  - Manual model selection and thinking toggle work.

### DP-03 Header contract
- Confirm response headers include:
  - `X-Router-Model`
  - `X-Router-Model-Id`
  - `X-Provider`
  - `X-Model-Override`
  - `X-Router-Rationale`
  - `X-Complexity-Score`
  - `X-Gemini-Thinking-Level`
  - `X-Memory-Hits`
  - `X-Memory-Tokens`

## 10. Release Readiness Criteria

- Fast-gate automated checks pass.
- No stale folder/path references block build or deployment.
- Critical scenarios pass: RT-01, RT-02, GT-01, AU-02, MM-01, UX-02, DP-03.
- No P0/P1 defects in auth, routing, or stream rendering.
