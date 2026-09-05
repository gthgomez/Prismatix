# Prismatix

[![CI](https://github.com/gthgomez/Prismatix/actions/workflows/ci.yml/badge.svg)](https://github.com/gthgomez/Prismatix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

**A personal AI chat client with a cost-aware multi-provider router. Auto picks a model, shows why, and will not spend what it cannot price.**

Prismatix routes each chat request through an OpenCode model-hub gateway by default, choosing between curated models by routing role — and explains every choice in the UI. Direct Anthropic/OpenAI/Google/NVIDIA/DeepInfra connections remain as an explicit legacy posture, not the default path.

---

## What it does

- **Auto routing, explained** — Each request is classified into a routing role (`economy`, `fast`, `balanced`, `strong`, `max`, `vision_fast`, `vision_strong`, `code_review`) by a heuristic complexity scorer. Each role maps to a curated, priced OpenCode model with deterministic in-role fallbacks. After every Auto-routed answer, the message's info popover shows the chosen role, model, gateway, the reason, whether a fallback was used, and the estimated cost basis
- **Fail-closed cost safety** — Auto never sends when a model's price is unknown. If discovery finds no priced, available model for the resolved role, the request fails with a readable error instead of silently re-routing to a more expensive provider. Provider-unavailable fallbacks may only re-route to a *cheaper* priced model
- **OpenCode model hub** — Curated model registry (DeepSeek V4, GPT-5.6, Claude 5, Gemini 3.7, Grok 4.6) behind the OpenCode Zen gateway with live model discovery (5-minute scoped cache). Free/data-training endpoints are quarantined and never chosen automatically
- **Legacy direct providers (fallback posture)** — Direct Anthropic, OpenAI, Google Gemini, NVIDIA NIM, and DeepInfra routes remain available when the OpenCode gateway is not configured; each role keeps a deterministic, priced legacy mapping
- **Multi-provider streaming** — Normalised SSE stream across all gateways and protocols (OpenAI Responses/Chat, Anthropic Messages, Gemini). One client, every model
- **Debate mode** — Optional multi-model deliberation: parallel challenger models critique the prompt, a synthesis model produces the final answer
- **SMD pipeline** — Structured Multi-Draft: Draft → Skeptic → SynthDecision → Formatter, gated by a fast-path complexity guard (experimental, off by default)
- **Video pipeline** — Upload, process, and query video assets via Supabase Storage + a background worker edge function
- **Cost tracking** — Pre-flight cost estimates, live token counting during streaming, per-message final cost logged to Supabase `cost_logs`, plus server-side request, daily spend, rate, and concurrent-stream guards. Unknown rates are never shown as $0.00
- **Long-term memory** — Conversation windows are periodically summarised and injected as context on future requests
- **Auth** — Supabase email/password auth with JWT verification on every edge function call

### Auto routing & cost safety — what actually happens

| Situation | Behavior |
|---|---|
| Known price, model discovered | Auto sends; the choice and reason are visible on the message |
| Model price unknown | Request is rejected (`unknown_model_pricing`) — auto *and* manual selection are blocked |
| Model not eligible for auto-routing (e.g. free tier) | Rejected for Auto; explicit manual pick is allowed |
| Discovery unavailable or returns no usable model for the role | Request fails with `auto_route_unavailable` — **no** silent fallback to a costlier legacy model |
| Routed provider not configured | Re-route only to a cheaper priced fallback; otherwise fail closed |
| Curated model unavailable in discovery | Deterministic in-role fallback (primary → fallback list), recorded in the explanation |

Pricing freshness is audited in CI (`npm test`): auto-routable OpenCode rates older than 60 days fail the build; stale legacy-provider rates are surfaced as a visible warning. `npm run audit:models` inventories stale model coupling. The backend pricing registry (`supabase/functions/router/pricing_registry.ts`) is the authoritative source; the frontend registry is a display-only mirror kept in sync by a divergence test.

### What Prismatix is NOT

- Not a model-intelligence platform, eval platform, or benchmark ingestion system
- Not a model marketplace or enterprise gateway
- Not a provider observability or SLA-analytics product

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | TypeScript (Vite) — React 18 used only for UI components (~17 `.tsx` files); the bulk of the codebase is plain `.ts` (services, engine, hooks, types) |
| Backend | TypeScript on Deno — edge functions on Supabase |
| AI Providers | Anthropic, OpenAI, Google Gemini, NVIDIA NIM, DeepInfra |
| Database | Supabase Postgres (conversations, messages, cost_logs, user_memories, video_assets) |
| Auth | Supabase Auth (JWT, RLS) |
| Deployment | Vercel (frontend) + Supabase (backend) |

---

## Project structure

```
src/
  components/       React components (ChatInterface, Auth, SpendTracker, ...)
  hooks/            Custom hooks (useAuth, useContextManager, useStreamHandler, ...)
  services/         API services (storageService, financeTracker, contextManager)
  styles/           CSS (ChatInterface.css, mobile.css)
  smartFetch.ts     Router API client
  costEngine.ts     Token counting + pricing math
  modelCatalog.ts   UI model registry
  types.ts          Shared TypeScript types

supabase/
  functions/
    router/         Main routing edge function + modules (db_helpers, memory_helpers, video_helpers, ...)
    spend_stats/    Spend statistics aggregation
    video-intake/   Video upload intake
    video-status/   Video processing status
    video-worker/   Background video processing
  migrations/       Postgres schema migrations

docs/               Architecture docs, integration guides, contributing notes
scripts/            Build scripts
```

---

## Environment

Copy `.env.example` to `.env.local` and supply your values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_ROUTER_ENDPOINT=https://YOUR_PROJECT.supabase.co/functions/v1/router
VITE_ENABLE_VIDEO_PIPELINE=false
```

Supabase edge function secrets (set via `supabase secrets set`):

```
ANTHROPIC_API_KEY
OPENAI_API_KEY
GOOGLE_API_KEY
NVIDIA_API_KEY
DEEPINFRA_API_KEY
ALLOWED_ORIGIN=https://your-frontend.vercel.app
ENABLE_DEBATE_MODE=false
ENABLE_SMD_LIGHT=false
ENABLE_VIDEO_PIPELINE=false
ENABLE_DEEPINFRA=true
ENABLE_SERVER_SPEND_LIMIT=true
DAILY_SPEND_LIMIT_USD=2
PER_REQUEST_COST_LIMIT_USD=0.5
USER_RATE_LIMIT_WINDOW_MS=60000
USER_RATE_LIMIT_MAX_REQUESTS=20
MAX_ACTIVE_STREAMS_PER_USER=2
```

---

## Development

### First-time setup

1. **Install the Supabase CLI** — [docs](https://supabase.com/docs/guides/cli)

2. **Link your project:**
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```

3. **Run database migrations:**
   ```bash
   supabase db push
   ```

4. **Set edge function secrets** (one-time, per provider key you want active):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-...
   supabase secrets set OPENAI_API_KEY=sk-...
   supabase secrets set GOOGLE_API_KEY=...
   supabase secrets set NVIDIA_API_KEY=...
   supabase secrets set DEEPINFRA_API_KEY=...
   supabase secrets set ALLOWED_ORIGIN=http://localhost:5173
   supabase secrets set ENABLE_DEBATE_MODE=false
   supabase secrets set ENABLE_SMD_LIGHT=false
   supabase secrets set ENABLE_VIDEO_PIPELINE=false
   supabase secrets set ENABLE_DEEPINFRA=true
   supabase secrets set ENABLE_SERVER_SPEND_LIMIT=true
   supabase secrets set DAILY_SPEND_LIMIT_USD=2
   supabase secrets set PER_REQUEST_COST_LIMIT_USD=0.5
   supabase secrets set USER_RATE_LIMIT_WINDOW_MS=60000
   supabase secrets set USER_RATE_LIMIT_MAX_REQUESTS=20
   supabase secrets set MAX_ACTIVE_STREAMS_PER_USER=2
   ```

5. **Deploy edge functions:**
   ```bash
   supabase functions deploy router
   supabase functions deploy spend_stats
   ```

6. **Install frontend dependencies and start dev server:**
   ```bash
   npm install
   npm run dev
   ```

### Ongoing development

```bash
npm run dev          # start Vite dev server
npm run type-check   # TypeScript typecheck (no emit)
npm run lint         # ESLint
npm run test         # Vitest unit tests
npm run build        # production build
```

Deploy edge functions after changes:

```bash
supabase functions deploy router
supabase functions deploy spend_stats
```

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions, architecture overview, and PR guidelines.

## License

MIT — [LICENSE](./LICENSE)
