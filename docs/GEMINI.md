# GEMINI.md - Prismatix Gemini Playbook

Use Gemini here as a bounded router and streaming engineer.

## Read Order

1. `PROJECT_CONTEXT.md`
2. `prismatix_PROJECT_CONTEXT.md`
3. `AGENTS.md`
4. The exact file you plan to edit

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

## Operating Style

- Be concise, file-backed, and explicit about unknowns.
- Use PowerShell-native commands on Windows.
- Prefer one task, one file family, and one verification target per prompt.
- Name exact provider, model, function, route, or migration before proposing edits.
- If a provider API shape is unfamiliar, inspect the local payload builder before changing it.

## Hallucination Controls

- Do not invent provider fields, SSE event shapes, or migration column names.
- Verify payload shapes against `provider_payloads.ts`, `router_logic.ts`, and `sse_normalizer.ts` before editing.
- Do not claim routing behavior from memory; inspect the current router code.
- For frontend changes, verify the actual props and fetch contract in the owning component and utility file.
- Separate `Observed`, `Inferred`, and `Unknown` in any non-trivial analysis.

## Prismatix Priorities

- Conversation ownership and auth boundaries outrank convenience.
- SSE normalization is a contract surface, not a cosmetic detail.
- Cost tracking must stay aligned with selected provider and model.
- Migration changes require compatibility awareness and explicit risk callouts.

## Verification Gates

- Frontend-only changes: `npm run type-check` and `npm run build`
- Frontend logic changes: run relevant Vitest tests when available
- Router changes: `deno check .\supabase\functions\router\index.ts`
- Router stream or payload changes: inspect adjacent router files for contract alignment
- Migration changes: state impacted tables and rollback implications before editing

## Response Expectations

- Name the exact files inspected.
- Separate observed facts from inference.
- If the task touches auth, routing, streaming, costs, or migrations, call out the risk before editing.
- Do not call work complete without naming the checks actually run.
