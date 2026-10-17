# Prismatix Overnight Quality & Friction Removal Campaign Ledger

**Date:** 2026-10-17  
**Baseline SHA:** `ea28efd4d543305d5488baaac8b85ac6100f5102` (origin/main pre-PR #49)  
**PR #49 Merge SHA:** `13006e8`  
**Working Branch:** `fix/campaign-review-remediations`  
**Execution Environment:** Node v24.22.0, npm 11.19.0, Deno 2.7.7, Windows (pwsh)  

---

## Campaign Context & Post-PR #49 Review Remediation

Following the initial merge of PR #49, an independent read-only review (`artifacts/prismatix-campaign-review/2026-10-17/Review.md`) identified 6 actionable findings regarding presentation vs settlement conflation, reloaded routing provenance, CORS/error contracts, test-mock production fallback contamination, ledger task ID alignment, and demo/auth copy.

This ledger documents both the original candidate evaluations and the post-review remediations implemented on branch `fix/campaign-review-remediations`.

### Remediations Summary (Findings 1–6)

1. **Finding 1 (Execution Outcome vs Transport Termination vs Settlement):**
   - In `src/hooks/useStreamHandler.ts`, decoupled transport completion (`isDoneReceived`) from receipt presence. Streams ending before `[DONE]` are classified as `terminationStatus: 'interrupted'` regardless of whether a receipt arrived.
   - In `src/components/chatTypes.ts` and `src/components/ChatInterface.tsx`, extended stream outcome state to track `receiptStatus`, `terminalOutcome`, and `settlementStatus` independently. Interrupted streams preserve partial assistant output, display clear interruption notices, and preserve receipt facts without inferring free/no-charge turns if commitments exist.
   - In `src/components/ChatInputComposer.tsx`, updated outcome rendering to distinguish cancelled, interrupted, error/failed, indeterminate, settled, released, and pending, rendering `streamOutcome.error` explicitly.
   - Added discriminating tests in `src/hooks/useStreamHandler.test.ts` and `src/components/ChatInputComposer.test.tsx`.

2. **Finding 2 (Reloaded Routing Provenance & Cost Status):**
   - In `src/services/conversationService.ts`, unsupported or absent `cost_status` values are mapped to `'unknown'` instead of silently defaulting to `'settled'`.
   - In `src/types.ts` and `src/modelDisplay.ts`, added `'openrouter'` to `RouteGateway` and made `gateway` optional in `RouteExplanation`. Omitted gateway rows when unrecorded rather than assuming `direct_fallback`.
   - In `src/components/ChatInterface.tsx`, preserved exact gateway (`opencode`, `openrouter`, `direct_fallback`, or omitted) and set `priceKnown: true` only when pricing evidence is present.
   - Verified via `tests/routing/wave_a_error_and_provenance.test.ts`.

3. **Finding 3 (CORS Header Exposure & Denial Code Mapping):**
   - In `supabase/functions/router/index.ts`, added `Retry-After, X-Route-Decision` to `CORS_HEADERS['Access-Control-Expose-Headers']`. Added `retry_after` and `retryAfterSeconds` to 429 rate limit and admission denial JSON payloads.
   - In `src/smartFetch.ts`, updated `throwRouterError` to parse both integer seconds and RFC 7231 / RFC 9110 HTTP-date strings, with fallback to JSON payload fields.
   - In `src/components/ChatInterface.tsx`, mapped `active_limit` alongside `concurrency_limit` and `rate_limited` alongside `rate_limit_exceeded`.

4. **Finding 4 (Production Client Fallback Reversal):**
   - In `src/lib/supabase.ts`, removed unconditional fallback to `placeholder.supabase.co` and dummy key. The client strictly initializes with `CONFIG.SUPABASE_URL` and `CONFIG.SUPABASE_ANON_KEY`, ensuring configuration issues produce explicit errors rather than silent dummy routing.
   - Tests mock Supabase appropriately without polluting application runtime.

5. **Finding 5 (Task ID Alignment & Discriminating Regressions):**
   - Corrected task IDs: modal focus management assigned to **D02**; code-block horizontal scrolling accessibility assigned to **D04**; original **C03** (conversation list pagination) and **C04** (older message pagination) restored as Open / Deferred.
   - Added discriminating deferred-fetch race regression in `src/components/SpendTracker.test.tsx`.
   - Added discriminating focus restoration and Tab focus trapping tests in `src/components/BudgetGuard.test.tsx` and `src/components/KeyboardShortcutsModal.test.tsx`.
   - Included all 30 candidate tasks (A01–A06, B01–B07, C01–C08, D01–D09) with explicit dispositions.

6. **Finding 6 (Demo Canonical Renderer & Policy-Neutral Auth Copy):**
   - In `src/components/InteractivePublicDemo.tsx`, replaced raw `<pre>` tag with canonical `FormattedMessage` renderer so markdown headings, bold text, lists, and code blocks render properly. Updated title to "Experience Adaptive Routing Interactive Preview".
   - In `src/components/Auth.tsx`, replaced unverified "invite-only" copy with policy-neutral "Public registration is currently unavailable."

---

## Complete 30-Candidate Task Ledger

Status classifications:
- **Test verified**: Implemented and backed by discriminating unit/integration tests.
- **Source resolved**: Code changes inspected and confirmed in source; full browser/integration verification deferred.
- **Already fixed in main**: Pre-existing in main baseline; no new changes required.
- **Partial / Remediated**: Core improvements implemented and review findings remediated; full multi-device/production verification remaining.
- **Open / Deferred**: Candidate acknowledged and intentionally deferred for follow-up work packages.

| ID | Title | Status | Discovered Condition | Implemented Change / Decision | Changed Files | Verification Evidence | Notes & Remaining Scope |
|---|---|---|---|---|---|---|---|
| **A01** | Fix estimated cost displayed as final | Test verified | Client fell back from `streamedFinalUsd` to local token estimate and assigned `finalUsd`, presenting estimates as settled. | Established explicit `CostStatus` contract: `settled`, `estimated`, `pending`, `unknown`. Local calculated fallback remains `estimatedUsd` with `status: 'estimated'`. Only server receipt `committedUsd` or `streamedFinalUsd` can settle `finalUsd`. | `src/types.ts`, `src/components/ChatInterface.tsx`, `src/components/CostBadge.tsx`, `src/components/CostEstimator.tsx` | `src/components/CostBadge.test.tsx`, `tests/routing/wave_a_error_and_provenance.test.ts` | Complete. Caller settlement decisions and cost states verified. |
| **A02** | Detect incomplete stream termination | Test verified | Socket drops before `[DONE]` were treated as completed if any receipt arrived. | Decoupled transport termination from execution receipts. Interrupted streams marked `terminationStatus: 'interrupted'`. Partial content preserved with visible interruption alert; receipt facts preserved without inferring free turn. | `src/hooks/useStreamHandler.ts`, `src/components/chatTypes.ts`, `src/components/ChatInterface.tsx`, `src/components/ChatInputComposer.tsx` | `src/hooks/useStreamHandler.test.ts`, `src/components/ChatInputComposer.test.tsx`, `tests/routing/wave_a_error_and_provenance.test.ts` | Complete. Discriminating tests verify disconnects, failed executions, and indeterminate receipts. |
| **A03** | Correct hypothetical savings claims | Source resolved | `CostBadge.tsx` computed "Auto-Route Savings" vs hardcoded GPT-6 Sol baseline without establishing true avoided spending. | Replaced with explicitly hypothetical, truthful "Price Illustration" comparing identical token volume on frontier baseline (`gpt-6-sol`) without false equivalence claims. | `src/components/CostBadge.tsx` | `src/components/CostBadge.test.tsx` | Complete. Real-browser visual presentation deferred. |
| **A04** | Preserve factual routing provenance after reload | Test verified | `mapLoadedMessages` defaulted `fallbackUsed: false` and `priceKnown: true` without server evidence; `cost_status` defaulted to `settled`. | Added `cost_status` to query; unsupported values map to `'unknown'`. Preserved OpenRouter and OpenCode gateway identities; omitted gateway row when unrecorded. `priceKnown` set only when pricing evidence exists. | `src/services/conversationService.ts`, `src/components/ChatInterface.tsx`, `src/modelDisplay.ts`, `src/types.ts` | `tests/routing/wave_a_error_and_provenance.test.ts` | Complete. Historical reload regressions pass. |
| **A05** | Improve request failure messaging | Test verified | Terse string error codes mapped only 3 errors with no retry-after preservation. Router CORS omitted `Retry-After`. | Router exposes `Retry-After, X-Route-Decision` headers and includes retry seconds in 429/denial JSON. `smartFetch` parses integer and HTTP-date formats. `ChatInterface` maps `active_limit`, `concurrency_limit`, `rate_limited`, 401, 402, 403, 409, 429, 502, 503, 504. | `supabase/functions/router/index.ts`, `src/smartFetch.ts`, `src/components/ChatInterface.tsx` | `tests/routing/wave_a_error_and_provenance.test.ts`, Deno typecheck | Complete. Typed error mapping and header contract verified. |
| **A06** | Verify accounting failure-path behavior | Test verified | Audited execution receipts, admission gate, and terminal outcomes under failure conditions. | Confirmed fail-closed accounting invariant: reservation releases on cancel/error; terminal receipt settlement state authoritative. | `supabase/functions/router/index.ts`, `tests/routing/execution_receipt.test.ts` | `tests/routing/execution_receipt.test.ts` (22 tests), `tests/integration/deployment-contract.test.ts` (39 tests) | Complete. Backend reservation release and settlement paths pass. |
| **B01** | Improve public demonstration | Partial / Remediated | `/demo` was static technical prose without interactive preview. | Added `InteractivePublicDemo` with 3 non-billable scenarios. Remediated: replaced `<pre>` with canonical `FormattedMessage` markdown renderer; updated title to "Interactive Preview". | `src/components/InteractivePublicDemo.tsx`, `src/styles/InteractivePublicDemo.css`, `src/components/ResumeDemo.tsx` | `src/components/InteractivePublicDemo.test.tsx` | Remediated. End-to-end browser/keyboard tab navigation deferred. |
| **B02** | Validate signup experience | Partial / Remediated | Closed signup displayed dead tab with no context; initial PR assumed invite-only beta. | Remediated copy to policy-neutral "Public registration is currently unavailable." with direct link to public demo. Reverted production client fallback in `supabase.ts`. | `src/components/Auth.tsx`, `src/styles/Auth.css`, `src/lib/supabase.ts` | `src/components/Auth.test.tsx` | Remediated. Deployed production signup policy check deferred (PX00 read-only). |
| **B03** | Improve first-use empty state | Source resolved | Empty state had redundant promotional copy and verbose descriptions. | Replaced with "Adaptive AI Router" badge, "What would you like to build or explore?" heading, and 4 concise starter prompt cards with "Try this prompt →" actions. | `src/components/ChatInterface.tsx` | `src/components/ChatInterface.e2e.test.tsx` | Source resolved. Mobile viewport ergonomics deferred. |
| **B04** | Visible blocked states & settings guidance | Test verified | Send silently blocked when 0 providers were enabled; no action guidance provided. | Added validation banner and dedicated `showProviderCta` that provides an "Open Provider Settings" action directly in composer. | `src/sendValidationPresentation.ts`, `src/components/ChatInputComposer.tsx`, `src/components/ChatInterface.tsx` | `src/sendValidationPresentation.test.ts`, `src/components/ChatInputComposer.test.tsx` | Complete. Missing API key / zero provider validation tested. |
| **B05** | Applicable quota & remaining allowance presentation | Open / Deferred | Quota and remaining spend allowance not presented authoritatively from server. | Deferred. Requires server-side allowance endpoint and account tier contract. | None | N/A | Open. Deferred for dedicated billing/allowance package. |
| **B06** | Inspect duplicated model-selection controls | Source resolved | Header and composer both contain model selectors. | Inspected synchronization on `manualModelOverride` and `currentModel`. Header selector serves navigation when scrolled; composer serves pre-send tuning. Roles confirmed complementary and preserved. | `src/components/ChatInterface.tsx`, `src/components/ComposerModelPicker.tsx`, `src/components/ModelSelectorDropdown.tsx` | `src/components/ComposerModelPicker.test.tsx`, `src/components/ModelSelectorDropdown.test.tsx` | Complete. Complementary responsive roles documented. |
| **B07** | Understandable provider validation messages | Test verified | Sending blocked without explanation when attachments were processing or keys were missing. | Added in-flight processing and zero-provider validation messages in `sendValidationPresentation.ts`. | `src/sendValidationPresentation.ts`, `src/components/ChatInputComposer.tsx` | `src/sendValidationPresentation.test.ts` | Complete. Combined with B04 presentation. |
| **C01** | Eliminate redundant deletion confirmation | Source resolved | Chat deletion required two clicks in sidebar plus a third click on `window.confirm`. | Removed redundant `window.confirm`, preserving accessible two-step inline confirmation with keyboard dismiss and Escape cancellation. | `src/components/ChatInterface.tsx` | `src/components/ConversationSidebar.test.tsx` | Complete. Two-step inline confirmation preserved. |
| **C02** | Conversation list error recovery & transition states | Open / Deferred | List/load/rename/delete have console-only errors; conversation switch retains prior messages during load. | Deferred. Needs optimistic UI transitions and resilient error boundaries. | None | N/A | Open. Follow-up work package. |
| **C03** | Conversation list pagination | Open / Deferred | Initial list query fetches hard limit of 50 conversations with no load-more UI. (Misassigned in initial ledger to modal focus). | Deferred. Requires cursor/offset pagination in `conversationService.ts` and sidebar scroll/button UI. | None | N/A | Open. Restored original task definition. |
| **C04** | Older message pagination | Open / Deferred | Message load fetches hard limit of 200 messages with no load-older UI. (Misassigned in initial ledger to code block keyboard). | Deferred. Requires message history windowing/cursor query and "Load earlier messages" UI. | None | N/A | Open. Restored original task definition. |
| **C05** | Search scope truthfulness in sidebar | Already fixed in main | Suspected search claimed entire history but only searched loaded titles. | Audited baseline: sidebar header already truthfully states "Matching titles in loaded history". | None | Source inspection | Complete. No code change required. |
| **C06** | Spend tracker refresh races and error recovery | Test verified | Rapid polling and concurrent fetches in `SpendTracker.tsx` had no request sequence guards, allowing stale responses to overwrite fresh data. | Added `activeRequestIdRef` sequence tracking in `refreshStats()` to discard stale responses; added inline Retry on failure. Added discriminating out-of-order race regression test. | `src/components/SpendTracker.tsx`, `src/components/SpendTracker.test.tsx` | `src/components/SpendTracker.test.tsx` (2 tests) | Complete. Discriminating race test verifies stale responses discarded. |
| **C07** | Preserve composer draft across failed turns | Open / Deferred | Input text and attachments clear before execution starts; failed turns do not restore composer draft. | Deferred. Requires transaction safety between submission and confirmation. | None | N/A | Open. Follow-up work package. |
| **C08** | Attachment UX and state transitions | Open / Deferred | Incomplete attachment state transitions and edge cases. | Deferred. Requires dedicated file-handling audit. | None | N/A | Open. Follow-up work package. |
| **D01** | Multi-viewport & mobile keyboard testing | Open / Deferred | Mobile keyboard overlap and viewport testing across breakpoints. | Deferred. Requires real-device / mobile emulator harness. | None | N/A | Open. Follow-up work package. |
| **D02** | Modal & drawer focus management | Test verified | Modals (`KeyboardShortcutsModal`, `BudgetGuard`) did not restore focus on close, lock scroll, or trap Tab. (Previously mislabeled as C03). | Added `previouslyFocusedRef` on mount, focus restoration on close, body scroll locking, and Tab focus cycle wrapping. Added discriminating tests. | `src/components/KeyboardShortcutsModal.tsx`, `src/components/BudgetGuard.tsx` | `src/components/KeyboardShortcutsModal.test.tsx`, `src/components/BudgetGuard.test.tsx` | Complete. Restored focus and Tab wrap verified by tests. |
| **D03** | Primary keyboard navigation workflows | Open / Deferred | Comprehensive keyboard shortcuts and skip links across major regions. | Deferred. Modals and code blocks improved (D02, D04); global keyboard workflow audit deferred. | None | N/A | Open. Follow-up work package. |
| **D04** | Keyboard accessibility of code blocks | Test verified | Rendered code blocks (`pre.code-block-pre`) were not focusable, preventing keyboard-only horizontal scroll. (Previously mislabeled as C04). | Added `tabIndex={0}` and `aria-label` to `pre.code-block-pre` in `FormattedMessage.tsx`. | `src/components/FormattedMessage.tsx` | `src/components/FormattedMessage.test.tsx` | Complete. Code blocks keyboard-scrollable and labeled. |
| **D05** | Performance profiling & render optimization | Open / Deferred | Component render frequency and re-render profiling. | Deferred. PR #48 already memoized earlier chat messages; avoid duplicate profiling without concrete hotspots. | None | N/A | Open. |
| **D06** | Playwright E2E browser test harness | Open / Deferred | E2E tests run in JSDOM rather than actual headless browser. | Deferred. Setting up Playwright and browser dependencies is a distinct infrastructure task. | None | N/A | Open. Follow-up infrastructure package. |
| **D07** | CI build and Deno verification | Open / Deferred | CI workflow lacks production Vite build and Deno router typecheck steps. | Deferred. Changes to `.github/workflows/ci.yml` kept separate from product remediation PR. | None | N/A | Open. Follow-up CI package. |
| **D08** | Public metadata, favicon, and brand polish | Open / Deferred | Public page SEO metadata, favicon, and branding consistency. | Deferred. | None | N/A | Open. |
| **D09** | Production deployment parity verification | Open / Access-dependent | Verifying deployed Vercel and Supabase production SHAs and migration state. | Deferred per PX00 read-only policy. No production deployment mutation permitted in campaign scope. | None | N/A | Open / Access-dependent. |

---

## Verification Run Ledger (Post-Remediation)

| Check | Command | Result | Details |
|---|---|---|---|
| Deno Check | `deno check supabase/functions/router/index.ts` | PASS | Router edge function type check passed with zero diagnostics. |
| TypeScript Check | `npm run type-check` | PASS | Zero TypeScript compilation errors across entire project. |
| Remediation Tests | `npx vitest run src/components/SpendTracker.test.tsx src/components/BudgetGuard.test.tsx src/components/KeyboardShortcutsModal.test.tsx src/hooks/useStreamHandler.test.ts src/components/ChatInputComposer.test.tsx tests/routing/wave_a_error_and_provenance.test.ts` | PASS | All 6 remediation test suites passed cleanly (28 tests total). |
| Full Test Suite | `npx vitest run --maxWorkers=1` | PASS | Verified green across all test files with single worker. |
