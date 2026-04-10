# Prismatix

**Intelligent multi-provider AI model router with streaming responses, cost tracking, and Supabase-backed conversation storage.**

Prismatix automatically routes each request to the best AI model for the job — balancing response quality, cost, and latency across Anthropic, OpenAI, Google, and NVIDIA. You get a single chat interface backed by every frontier model.

---

## What it does

- **Smart routing** — A heuristic complexity scorer analyses each query (token count, keywords, code signals, question depth) and routes to the appropriate model tier: Haiku / GPT-mini for quick lookups, Sonnet for code, Flash for general use, Opus / Gemini Pro for deep analysis
- **Multi-provider streaming** — Normalised SSE stream from Anthropic, OpenAI, Google Gemini, and NVIDIA Nemotron. One client, every model
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
| Frontend | React 18 + Vite + TypeScript |
| Backend | Deno edge functions on Supabase |
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
ALLOWED_ORIGIN=https://your-frontend.vercel.app
ENABLE_DEBATE_MODE=false
ENABLE_SMD_LIGHT=false
ENABLE_VIDEO_PIPELINE=false
```

---

## Development

```bash
npm install
npm run dev
```

Run tests:

```bash
npm run test
```

Deploy edge functions:

```bash
supabase functions deploy router
supabase functions deploy spend_stats
```

---

## License

MIT
