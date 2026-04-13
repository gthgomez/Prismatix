# Prismatix

[![CI](https://github.com/gthgomez/Prismatix/actions/workflows/ci.yml/badge.svg)](https://github.com/gthgomez/Prismatix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

**AI model router across Anthropic, OpenAI, Gemini, NVIDIA & DeepInfra. Auto-routes by complexity, streams SSE, tracks spend server-side.**

Prismatix automatically routes each request to the best AI model for the job — balancing response quality, cost, and latency across Anthropic, OpenAI, Google, NVIDIA, and DeepInfra. You get a single chat interface backed by every frontier model.

---

## What it does

- **Smart routing** — A heuristic complexity scorer analyses each query (token count, keywords, code signals, question depth) and routes to the appropriate model tier: Haiku / GPT-mini / Llama 4 Scout for quick lookups, Sonnet for code, Flash for general use, Opus / Gemini Pro / Qwen3-235B for deep analysis
- **Multi-provider streaming** — Normalised SSE stream from Anthropic, OpenAI, Google Gemini, NVIDIA Nemotron, and DeepInfra. One client, every model
- **Debate mode** — Optional multi-model deliberation: parallel challenger models critique the prompt, a synthesis model produces the final answer
- **SMD pipeline** — Structured Multi-Draft: Draft → Skeptic → SynthDecision → Formatter, gated by a fast-path complexity guard (experimental, off by default)
- **Video pipeline** — Upload, process, and query video assets via Supabase Storage + a background worker edge function
- **Cost tracking** — Pre-flight cost estimates, live token counting during streaming, per-message final cost logged to Supabase `cost_logs`. Server-enforced daily budget guard
- **Long-term memory** — Conversation windows are periodically summarised and injected as context on future requests
- **Auth** — Supabase email/password auth with JWT verification on every edge function call

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
