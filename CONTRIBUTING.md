# Contributing to Prismatix

Thank you for your interest in contributing.

## Requirements

- Node.js 20+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- A Supabase project (free tier works for development)

## Setup

```bash
git clone https://github.com/gthgomez/Prismatix.git
cd Prismatix
npm install
cp .env.example .env.local
# fill in .env.local with your Supabase project URL and anon key
```

Follow the [first-time setup steps in the README](./README.md#first-time-setup) to run migrations, set edge function secrets, and deploy the router before starting the dev server.

## Development workflow

```bash
npm run dev          # Vite dev server (http://localhost:5173)
npm run type-check   # TypeScript typecheck — must pass before submitting a PR
npm run lint         # ESLint — must pass before submitting a PR
npm run test         # Vitest unit tests
```

## Architecture overview

| Layer | Location | Notes |
|---|---|---|
| Frontend | `src/` | TypeScript + React 18 (Vite) |
| Router edge function | `supabase/functions/router/` | Deno — main routing, streaming, cost tracking |
| Spend stats | `supabase/functions/spend_stats/` | Deno |
| Video pipeline | `supabase/functions/video-*` | Deno — off by default |
| Database schema | `supabase/migrations/` | Postgres via Supabase |

### Key files

- `src/smartFetch.ts` — router API client
- `src/costEngine.ts` — token counting + pricing math
- `src/modelCatalog.ts` — UI model registry
- `supabase/functions/router/index.ts` — edge function entrypoint

## Security invariants

- Never expose the `ANTHROPIC_API_KEY` or other provider keys to the frontend. They live in Supabase edge function secrets only.
- All edge function calls require a valid Supabase JWT. Do not remove JWT verification.
- Preserve the conversation ownership check in the router — users may only access their own conversation history.

## Submitting a pull request

1. Branch from `main`.
2. Make your change, ensuring `type-check`, `lint`, and `test` all pass.
3. If your change touches the router or edge functions, deploy and manually verify the change in a Supabase project before opening the PR.
4. Open a PR against `main` with a clear description of what changed and why.

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).
