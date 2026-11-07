# Prismatix Wave 1 — Repair and Merge Report (F01–F15)

## 1. Executive Summary

This report documents the verification, remediation of mandatory blockers, sequential merging, and post-merge release-gate verification for Wave 1 of the Prismatix campaign (features F01 through F15) across Pull Requests #56, #57, and #58.

All 15 initial features were audited against their specifications and release contracts. Nine critical blockers (A01 through A09) were identified, reproduced, and repaired with strict enforcement of zero paid inference calls, zero mock citation fabrication, authoritative ledger accounting, and end-to-end Playwright browser verification across desktop Chromium and mobile viewports.

---

## 2. Blockers Identified and Resolved

| Blocker ID | Feature | Affected Component | Defect Found | Engineering Resolution |
|---|---|---|---|---|
| **BLOCKER A01** | F11 | `src/services/webSearchService.ts`, `ChatInterface.tsx` | Fallback returned synthetic citations from `docs.prismatix.ai` / `research.prismatix.ai` when API keys were missing or requests failed. | Completely eliminated fabricated citation generation. Implemented honest `source: 'unavailable'` state with actionable UI alerts and BYOK credential integration for Brave Search API. |
| **BLOCKER A02** | F12 | `src/components/ChatInterface.tsx`, `src/smartFetch.ts` | Comparison mode concatenated raw SSE chunks without parsing; mislabeled candidate costs as `'settled'`; comparison results were not persisted across reloads. | Replaced chunk concatenation with `readRouterStream` event parsing. Updated cost status to `'estimated'`. Persisted `comparisonResults` in `messages.metadata` with Supabase update policies and restoration logic. |
| **BLOCKER A03** | F13 | `supabase/functions/router/`, `src/smartFetch.ts` | Client could bypass routing profiles and per-turn spend caps; server did not validate `routingProfile` or enforce `spendCapUsd`. | Added authoritative `routingProfile` and `spendCapUsd` normalization in `security_guards.ts` and `router/index.ts`. Enforced strict 429 rejection via `evaluateSpendGate` when costs exceed limits. |
| **BLOCKER A04** | F06 | `src/utils/documentParsers/pdfParser.ts` | PDF text extraction merged all text into a single monolithic string without true page boundaries or citation coordinates. | Built multi-page PDF stream decoder with exact page-level chunking, page-number attribution headers (`--- Page N ---`), and configurable page caps. |
| **BLOCKER A05** | F07 | `src/utils/documentParsers/zipReader.ts` | ZIP parsing read only local file headers, risking corruption on multi-segment archives and zip bombs. | Re-implemented ZIP parser using authoritative End of Central Directory (EOCD) record validation, Central Directory Header parsing, decompression ratio limits, and total uncompressed byte limits. |
| **BLOCKER A06** | F09 | `src/components/ProjectModal.tsx`, `src/services/projectService.ts` | Project assignment was ephemeral; project creation modals had z-index collisions with mobile sidebar drawers. | Added durable `project_id` foreign key assignment in `conversations`, implemented `ProjectModal` portal rendering (`createPortal(..., document.body)`), and verified project scoping in chat contexts. |
| **BLOCKER A07** | F10 | `src/components/ExportModal.tsx`, `src/services/conversationExport.ts` | Full-archive export loaded only the first 50 conversations and 200 messages, truncating history without warning. | Implemented recursive cursor pagination across all user conversations and messages to produce complete, un-truncated ZIP archives of JSON and Markdown transcripts. |
| **BLOCKER A08** | F14 | `src/services/financeTracker.ts`, `src/components/SpendTracker.tsx` | Spend analytics were limited to 500 local storage items; CSV exports did not reflect authoritative server ledger. | Built `fetchAuthoritativeCostLogs` querying `public.cost_logs` under RLS `cost_logs_select_own`. Ensured CSV exports include accurate execution identities, pricing versions, and settlement states. |
| **BLOCKER A09** | F15 | `src/services/routingFeedbackService.ts`, `supabase/migrations/` | Routing quality feedback only supported insert; users could not toggle feedback off or delete records. | Created migration `20261107030000_f15_feedback_lifecycle.sql` with unique index `(user_id, message_id, feedback_type)` and RLS update/delete policies; built `deleteRoutingFeedback` and `toggleRoutingFeedback`. |

---

## 3. Pull Request Merge Sequence

The pull requests were merged sequentially into `main` after all release gates passed:

1. **PR #56 (F01–F05 — Daily-Use Foundation)**
   - Head branch: `feat/prismatix-daily-use`
   - Merge Commit: `06ec050`
   - Target Base: `main`
2. **PR #57 (F06–F10 — Knowledge Workspace)**
   - Head branch: `feat/prismatix-knowledge-workspace`
   - Retargeted Base: `main` (via REST API)
   - Merge Commit: `d2030ec`
3. **PR #58 (F11–F15 — Routing Intelligence)**
   - Head branch: `feat/prismatix-routing-intelligence`
   - Retargeted Base: `main` (via REST API)
   - Merge Commit: `3329404`

---

## 4. Post-Merge Release-Gate Verification on Main

The merged `main` branch (`commit 3329404`) was independently verified against all repository gates:

- **Dependency Installation (`npm ci`):** 293 packages installed cleanly in 2s.
- **TypeScript Compilation (`npm run type-check`):** 0 errors.
- **Lint Verification (`npm run lint`):** 0 errors (71 warnings).
- **Unit Test Suite (`npm run test`):** 95 test files passed, 850 unit tests passed (0 failures).
- **Frontend Production Build (`npm run build`):** Compiled client bundle in 1.35s with zero errors.
- **Deno Type Check:**
  - `deno check supabase/functions/router/index.ts`: Clean (0 errors).
  - `deno check supabase/functions/provider-settings/index.ts`: Clean (0 errors).
- **Stale Models Coupling Audit (`node scripts/audit-stale-models.mjs --check`):** Clean (all patterns at or under committed ratcheting budgets).
- **Playwright Browser E2E Suite (`CI=true npx playwright test`):**
  - PR 1 Daily-Use Foundation: 4 desktop + 4 mobile tests passed.
  - PR 2 Knowledge Workspace: 3 desktop + 3 mobile tests passed.
  - PR 3 Routing Intelligence: 4 desktop + 4 mobile tests passed.
  - Total: 22 passed (0 failures).
