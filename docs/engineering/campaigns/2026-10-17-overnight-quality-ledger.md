# Prismatix Overnight Quality & Friction Removal Campaign Ledger

**Date:** 2026-10-17  
**Audited Main Baseline SHA:** `ea28efd4d543305d5488baaac8b85ac6100f5102` (origin/main)  
**Campaign Branch:** `campaign/quality-friction-wave-a`  
**Execution Environment:** Node v24.22.0, npm 11.19.0, Deno 2.7.7, Windows (pwsh)  

---

## Baseline Verification Summary (Phase 0)

| Check | Command | Result | Notes |
|---|---|---|---|
| Git Remote & Branch | `git fetch origin; git rev-parse HEAD` | `ea28efd4d543305d5488baaac8b85ac6100f5102` | Matches `origin/main` (PR #48 fast-forwarded). Working tree clean. |
| Open Pull Requests | `gh pr list` | Clean (0 open PRs) | No colliding active PRs. |
| Type Check | `npm run type-check` | PASS | Zero TypeScript errors. |
| Lint | `npm run lint` | PASS | Zero errors, existing non-blocking warnings. |
| Stale Models Audit | `npm run audit:models` | PASS | Model coupling budget check passed. |
| Full Test Suite | `npx vitest run --maxWorkers=1` | PASS | 79 test files, 708 tests passed. (Full parallel run subject to Windows I/O 5s timeout on router dynamic imports; verified green with `--maxWorkers=1`). |
| Production Build | `npm run build` | PASS | Vite built dist/ in 2.62s. |
| Backend Check | `deno check supabase/functions/router/index.ts` | PASS | Router edge function typecheck passed. |
| Live Site Inspection | `https://prismatix-app.vercel.app` | Observed | Deployed assets match Vite build structure (`index-Dna1ESYV.css`). SPA serves public resume routes (`/demo`, `/about`) or Auth/ChatInterface. |
| Deployment Parity | Read-only inspection | UNKNOWN_FRONTEND | Production Vercel build SHA unpinned per deployment manifest PX00 policy. Read-only constraint preserved. |

---

## Campaign Candidate Ledger

| ID | Title | Status | Evidence | Decision | Changed Files | Verification Tests | Outcome |
|---|---|---|---|---|---|---|---|
| **A01** | Fix estimated cost displayed as final | Fixed | Client fell back from `streamedFinalUsd` to local token estimate and assigned `finalUsd`, presenting estimates as settled. | Establish explicit `CostStatus` contract: `settled`, `estimated`, `pending`, `unknown`. Local calculated fallback remains `estimatedUsd` with `status: 'estimated'`. Only server receipt `committedUsd` or `streamedFinalUsd` can settle `finalUsd`. | `src/types.ts`, `src/components/ChatInterface.tsx`, `src/components/CostBadge.tsx`, `src/components/CostEstimator.tsx` | `src/components/CostBadge.test.tsx`, `tests/routing/wave_a_error_and_provenance.test.ts` | Verified: estimates never acquire final/settled status. |
| **A02** | Detect incomplete stream termination | Fixed | `useStreamHandler` returned without terminal receipt or `[DONE]` frame upon socket drop, leading client to treat early EOF as success. | Track `terminationStatus`: `completed`, `cancelled`, `interrupted`, `error`. Preserve partial content with explicit interruption notice without charging/settling unconfirmed turn. | `src/hooks/useStreamHandler.ts`, `src/components/chatTypes.ts`, `src/components/ChatInterface.tsx` | `src/hooks/useStreamHandler.test.ts`, `tests/routing/wave_a_error_and_provenance.test.ts` | Verified: early EOF and transport errors flagged as interrupted; partial content preserved without final charge. |
| **A03** | Correct hypothetical savings claims | Fixed | `CostBadge.tsx` computed "Auto-Route Savings" vs hardcoded GPT-6 Sol baseline without establishing true avoided spending or equivalence. | Replaced misleading "Auto-Route Savings" with an explicitly labeled, truthful "Price Illustration" comparing identical token volume on frontier baseline (`gpt-6-sol`) without false quality equivalence claims. | `src/components/CostBadge.tsx` | `src/components/CostBadge.test.tsx` | Verified: truthful price illustration displayed; misleading savings percentages removed. |
| **A04** | Preserve factual routing provenance after reload | Fixed | `mapLoadedMessages` defaulted `fallbackUsed: false` and `priceKnown: true` without server evidence; `cost_logs` query omitted `cost_status`. | Added `cost_status` to `cost_logs` query in `conversationService.ts`. Preserved `costStatus` on `LoadedMessageCost`. Kept `fallbackUsed: undefined` on reloaded messages and omitted Fallback row in `buildRouteExplanationRows` when unrecorded. | `src/services/conversationService.ts`, `src/components/ChatInterface.tsx`, `src/modelDisplay.ts`, `src/types.ts` | `tests/routing/wave_a_error_and_provenance.test.ts` | Verified: historical messages reflect server facts without invented provenance. |
| **A05** | Improve request failure messaging | Fixed | Terse string error codes mapped only 3 errors with no retry-after preservation. | Introduced typed `RouterApiError` capturing HTTP status, error code, and `Retry-After` header / payload. Mapped 401, 402, 403, 409, 429, 502, 503, 504 with actionable recovery steps and countdown wait times. | `src/smartFetch.ts`, `src/components/ChatInterface.tsx` | `tests/routing/wave_a_error_and_provenance.test.ts` | Verified: exact retry-after seconds preserved; actionable next step provided for every error class. |
| **A06** | Verify accounting failure-path behavior | Verified | Audited execution receipts, admission gate, and terminal outcomes under failure conditions. | Confirmed fail-closed accounting invariant: reservation releases on cancel/error; terminal receipt settlement state authoritative. | `supabase/functions/router/index.ts`, `tests/routing/execution_receipt.test.ts` | `tests/routing/execution_receipt.test.ts`, `tests/integration/deployment-contract.test.ts` | Verified: 22 receipt tests and 39 deployment contract tests passing. |
