# Claude Router - Project Context

Last updated: 2026-02-11
Repository root: `C:\Users\icbag\Desktop\Project_SaaS\Claude_Router`

## 1) Scope
Claude Router is a full-stack chat application that routes each request to an LLM across multiple providers (Anthropic, OpenAI, Google) based on query complexity, history size, and optional image input. It supports manual model override and server-side streaming.

## 2) Tech Stack
- Frontend: React 18 + Vite + TypeScript (`claude-router-frontend`)
- Backend: Supabase Edge Function on Deno (`supabase/functions/router`)
- Data: Supabase Postgres (`conversations`, `messages`, `increment_token_count`)
- Auth: Supabase Auth JWT
- Storage: Supabase Storage bucket `chat-uploads` for optional file/image upload paths

## 3) Current Model Catalog
Router model keys:
- Claude: `haiku-4.5`, `sonnet-4.5`, `opus-4.5`
- OpenAI: `gpt-5-mini`
- Google: `gemini-3-flash`, `gemini-3-pro`

Provider model IDs:
- Claude IDs are pinned in `router_logic.ts`
- OpenAI currently uses alias `gpt-5-mini`
- Gemini aliases resolve dynamically at runtime via Google `GET /v1beta/models` filtered by `supportedGenerationMethods` including `generateContent`

## 4) Runtime Flow
1. Frontend sends `query`, `history`, `conversationId`, optional `images`, optional `modelOverride`.
2. Edge function validates JWT and conversation ownership.
3. Router chooses model (or uses override), with provider availability fallback when needed.
4. Provider adapter calls Anthropic/OpenAI/Google stream API.
5. Stream is normalized into consistent SSE chunks for frontend.
6. User/assistant messages and token counts are persisted.

## 5) Response Contract
Headers emitted by router:
- `X-Router-Model`: router key selected
- `X-Router-Model-Id`: effective provider model ID actually used
- `X-Provider`: `anthropic | openai | google`
- `X-Model-Override`: override used or `auto`
- `X-Router-Rationale`: route rationale tag
- `X-Complexity-Score`: numeric complexity
- Legacy compatibility: `X-Claude-Model`, `X-Claude-Model-Id`

## 6) Key Files
- `supabase/functions/router/router_logic.ts`: route policy, model registry, override normalization, provider payload transforms
- `supabase/functions/router/index.ts`: auth, ownership validation, provider calls, SSE normalization, persistence, headers
- `claude-router-frontend/src/smartFetch.ts`: authenticated fetch, 401 retry policy, header parsing
- `claude-router-frontend/src/hooks/useAuth.ts`: auth session state and stale refresh token handling
- `claude-router-frontend/src/modelCatalog.ts`: shared frontend model metadata
- `claude-router-frontend/src/components/ChatInterface.tsx`: chat UI + manual model selector

## 7) Recent Fixes (This Iteration)
- Gemini robust alias resolution:
  - Removed brittle dated Gemini IDs.
  - Added dynamic model discovery with cache and alias-to-valid-model resolution.
  - Added structured 502 upstream error details on provider failures.
- Auth refresh/signout hardening:
  - Removed aggressive manual refresh loop.
  - Rely on SDK session handling.
  - Retry router call once on 401; only then local sign-out.
  - Clear stale local session on invalid refresh token errors.
- Frontend cleanup:
  - Unified model metadata in `src/modelCatalog.ts`.
  - Updated UI/components/utilities to use router-generic model catalog.
  - Updated docs to multi-provider naming and headers.

## 8) Root Causes for Reported Errors
- `502` with Gemini overrides was caused by stale hardcoded model IDs no longer available in Google v1beta.
- `Invalid Refresh Token: Refresh Token Not Found` sign-out churn was caused by stale local auth state plus aggressive refresh/signout handling.

## 9) Deployment State (2026-02-11)
- Supabase Edge Function `router` deployed to project `sqjfbqjogylkfwzsyprd`.
- Frontend deployed on Vercel:
  - Production alias: `https://claude-router-frontend.vercel.app`

## 10) Validation Commands
- Frontend build: `npm run build` (pass)
- Router type check: `deno check supabase/functions/router/index.ts` (pass)
- Router tests: `deno test Tests/Router_test_v2.ts` (pass)

## 11) Open Items / Optional Cleanup
- Add resolver-focused unit tests (mock `ListModels` ranking/selection paths).
- Decide deprecation timeline for legacy `X-Claude-*` headers.
- Optional: add ESLint config so `npm run lint` is actionable (currently no config file).