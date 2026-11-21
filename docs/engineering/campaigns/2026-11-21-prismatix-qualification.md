# Prismatix stabilization and release evidence · 2026-11-21 UTC

GitHub `main` and the production Vercel deployment both resolve to
`6a5c4cb0ad364490a1a0d959dcc60f68f63d7314`. The public shell identifies
`sqjfbqjogylkfwzsyprd.supabase.co` as its backend. Public HTTP checks returned
200 for the shell, demo, recovery route and service worker, plus 404 for a missing
asset. The connected Supabase inventory did not include the identified project.
[Production deployment](https://vercel.com/jonathan-gomez-aguilars-projects/prismatix/17qK2FFxyNdWjXbd9LsDMRvG3XGw)

PR [#73](https://github.com/gthgomez/Prismatix/pull/73) is the integration branch.
Its starting head `e97354727eefc8464f3b4253259e986d7936d86f` contains the exact
[#72](https://github.com/gthgomez/Prismatix/pull/72) head. The candidate preserves
[#65](https://github.com/gthgomez/Prismatix/pull/65) setup outcomes, keyboard and
history behavior. The saved-but-disabled case is covered by a new regression.
PRs #68–#71 are already in main. The starting #73 head had
[four green CI jobs](https://github.com/gthgomez/Prismatix/actions/runs/44497085120).
A fresh main run passed 929 Vitest tests and 92 of 93 local Chromium cases.
The failing lazy-chunk recovery case passed its isolated rerun.

## Findings

| ID / priority | Reproduction and cause | Correction and verification |
| --- | --- | --- |
| PXQ-01 / P0 | Fail a send and retry after reaching the daily cap. Retry skipped budget preflight. Rapidly activate Regenerate during a delayed lookup. Edit and Regenerate lacked a synchronous send lock. | Share one scoped preflight and cost estimate across all four actions. Browser regressions cover blocked retry, duplicate Regenerate, late sign-out and unmodified attachment retry. `9f48a0b` |
| PXQ-02 / P0 | Open a slow history item and submit while the previous transcript is still shown. The browser also derived the router target from a shared storage key after async work. | Clear old context on selection, pause execution through history load, pin router and video uploads to the active conversation, and reject 401 replay under a different account. Browser slow-history and transport unit regressions exercise these cases. `9f48a0b`, `0475e25`, `d136855` |
| PXQ-03 / P0 | Enter a second account on the same browser during a ledger outage. The legacy local spend cache had no owner, and storage quota errors could escape after generation. Delayed preference saves could adopt a later session. | Scope advisory spend to the current account, keep cache errors out of turn outcomes and tie preference sync to its originating owner. Negative regressions cover account mismatch, shared legacy entries and blocked storage. `d136855` |
| PXQ-04 / P1 | Switch chats with unsent text or reload during an active send. The composer shared its text across chats and a pending turn had no reload checkpoint. | Store text by account and conversation in the tab, preserve files in memory across navigation, and offer pending text for explicit restore. The browser tests ensure reload sends nothing. File bodies are not serialized. `9f48a0b`, `d136855` |
| PXQ-05 / P1 | Replay a Compare pair in reverse order, reload a preference, or reload a failed group without an assistant row. The original unique constraint target, feedback-only vote and assistant-only anchor produced three different losses. | Reuse a canonical owner-scoped pair, persist an A/B vote only after owner RPC confirmation, and anchor an outcome card to the saved user prompt when both assistant rows are absent. Browser checks cover failed vote recovery, reload and zero browser message writes. Isolated SQL checks cover replay, settlement and cross-owner denial. `0a61373`, `30edcb1`, `0475e25` |
| PXQ-06 / P1 | Sign in with a saved key on a disabled provider. First run asks for another key. | Route the user to the existing provider settings and keep one visible setup action. The browser regression checks the setup text, disabled provider dialog, keyboard/Axe behavior and paused composer. `7e9db41`, `4338a93` |
| PXQ-07 / P2 | Inspect the public frontend response and local authorization tests. The deployed asset responses lack explicit MIME sniffing protection, and the prior isolated harness did not exercise the receipt and spend RPC boundaries. | Set `nosniff` and strict cross-origin referrers in the candidate and extend PostgreSQL tests to conversation, transcript, receipt and spend authorization. The isolated fixture uses two authenticated identities, anonymous access, and the receipt service role separately. `4338a93`, `7a787a5` |
| PXQ-08 / P1 | Open Compare or a Markdown/code reply in Arctic Light. Legacy dark surfaces hid code and comparison content, and the code copy control gave no feedback when denied clipboard access. | Apply the shared Arctic text, surface and border tokens. Make mobile actions 44 CSS pixels high, make scrollable tables focusable, and select visible code when clipboard access fails. Added a two-theme 4.5:1 contrast and copy-recovery regression for desktop and Pixel 5. |
| PXQ-09 / P0 | Open a separate account in the same browser. Shared legacy routing, research, and Compare settings could briefly affect the next account before saved preferences arrived. An earlier request's late auth failure could also sign the current account out. | Read and write account-scoped preferences at initialization and on change. Keep scoped server records and bypass legacy values whose owner cannot be established. Recheck the active subject before local sign-out. Browser and transport tests cover late 401s, routing cap reload, and the distinction between legacy and account-selected Compare. |

## Verification

- Local build, TypeScript, lint, the model budget, 944 Vitest cases and all ten
  Deno Edge entrypoint checks passed. Lint reported 136 warnings and zero errors.
- The default fixture passed 112 desktop Chromium cases with two Compare
  rollout tests skipped. The separate opt-in build passed those two cases.
  The Pixel 5 suite passed five browser journeys.
- Native Chromium page zoom at 200% and 400% kept setup and provider dialog
  controls reachable with no horizontal document overflow. At 400%, the
  sign-in submit control remained reachable. Keyboard checks verified Escape
  and focus return. Axe covered the setup and provider dialog.
- An opt-in local signup build exercised the email confirmation message and
  password reset request with synthetic Auth responses. A separate build with
  backend configuration removed showed recovery for sign-in and reset and
  opened the demo with zero Supabase requests.
- Visual review caught synthetic history returning database messages in the
  wrong query order. The browser fixture now honors the descending data order
  and verifies that the UI presents the user prompt first.

## Evidence boundaries

- The local browser suite uses synthetic sign-in, storage, provider and router
  responses. It covers provider setup, Chat, Stop, search/history, offline/failed
  requests, keyboard/focus, mobile viewport emulation and separately opted-in
  Compare. The first-run matrix covers the requested screen sizes and 125% root
  text sizing. The keyboard-open check reduces the visible viewport height.
- PostgreSQL 17 ran the repository harness SQL against a disposable cluster.
  The harness supplies minimal Supabase-managed auth and storage objects. It
  does not exercise hosted Auth, Storage, PostgREST or Edge deployment behavior.
- The deployment manifest preserves historical facts. Its function
  versions and migration inventory are from an earlier audit. The frontend
  identity above is current. Hosted backend versions, Auth policy, grants, secrets,
  signup controls and server spend enforcement require fresh read-only evidence.
- Live provider execution, physical-device keyboards and screen readers remain
  unverified. A Compare group with no saved user or assistant record still
  has no history anchor. When durability is disabled, a browser preference is
  local to the current view. At this earlier checkpoint, unsaved partial answers
  existed only in the active workspace; the follow-up PXQ-11 below adds
  tab-scoped recovery. Compare's combined client estimate and server
  per-request caps have different scopes.

## Release sequence

1. Confirm the Prismatix Supabase target and inventory its migration, function,
   Auth, RLS and budget configuration. Exercise sign-up, recovery and two-account
   isolation against an authorized candidate environment.
2. Validate the outstanding migrations in order, including
   `20261107070000_px08_compare_durability.sql` followed by
   `20261121000000_px08_compare_preferences.sql`. These migrations introduce
   Compare groups and add an optional preference to existing groups. Rollback
   can disable the frontend flag and retain existing rows and functions.
3. Deploy the matching router after the additive database changes. Keep
   `VITE_PX08_COMPARE_DURABILITY` off until an authorized staging canary verifies
   successful, stopped and failed executions with real receipts and a capped
   provider budget. Verify the non-Compare functions against the deployment
   checklist before production approval.
4. Review the exact integration head and wait for all checks. A merge to main
   deploys the frontend and requires explicit production approval.

## Independent follow-up on 2026-11-21

The follow-up started from PR #73 head `d528b5f8cd13f8dc76b937ef7cf9d7182cd18b9a`
and main `6a5c4cb0ad364490a1a0d959dcc60f68f63d7314`. The exact #72 head is an
ancestor of #73; #72 and #65 were already closed, while #68–#71 were merged.
The candidate retains #65's verified, rejected, unavailable and disabled setup
paths and history loading/failure coverage, although its implementation differs.
The production alias served the same HTML as Vercel's main deployment. GitHub
reported four successful jobs for the starting #73 head; these are baseline
evidence, not proof of a live user journey.

The following changes are integrated into [PR #73](https://github.com/gthgomez/Prismatix/pull/73).
Their implementation and tests were reviewed reciprocally by two collaborators
with shared task context; this is not a GitHub approval or an independent
blind security assessment. The implementation commits are `194cc44` (PXQ-10),
`42e543e` (PXQ-11, PXQ-12 and PXQ-15, plus spend presentation), `807e8b2`
(PXQ-13, PXQ-14 and PXQ-17), `4cec56f` (PXQ-16), `e339f70` and `c5be7e8`
(PXQ-18), `e026b5b` (PXQ-19 and PXQ-21), `50cc201` (PXQ-20),
`832b9ff` (PXQ-22), and `7f09f7a` (PXQ-23).

| ID / priority | Reproduction and cause | Correction and evidence |
| --- | --- | --- |
| PXQ-10 / P0 | Validate account A's key, switch the active session to B while the save waits for `getSession`, then continue. The provider-settings client could send A's key under B's token; a hook-only generation check occurred too early. | Bind every provider-settings operation to its originating user and check the resolved session before dispatch. Reject stale or unscoped validation evidence. Hook and service regressions cover the interleaving and all six operations. |
| PXQ-11 / P1 | Interrupt, stop or reload an ordinary stream, or reload a Compare stream, after useful text arrives. Unsaved response text existed only in the current component and disappeared after reload. | Checkpoint each stream into account- and tab-scoped session storage until the server confirms transcript persistence. Recovery is copy/dismiss only and never sends a request or writes a transcript. Browser tests cover interrupted, stopped and in-progress streams, including both Compare sides; storage isolation and quota failures have unit coverage. Closing the tab or unavailable browser storage still prevents recovery. |
| PXQ-12 / P1 | End a stream with a complete SSE JSON event that lacks its final blank line. A clean close parsed the event without notifying the UI; a read error discarded it. | Flush the parser on close, error and cancellation and emit changed content to the UI. Tests cover clean close, read error, cancellation and malformed trailing JSON while retaining the correct terminal state. |
| PXQ-13 / P0 | A settled ordinary-chat receipt can report a different cost from the router's token estimate; the cost log used the estimate. A receipt could also say settled while a reservation was still held or pending. Stream metadata could be shown as a settled total despite a pending receipt. | Use the settled receipt for the cost-log total, require a present reservation to be committed before a receipt is settled, and treat unconfirmed stream metadata as an estimate. Real-handler tests cover nonzero, zero and pending cases; browser coverage checks the pending presentation. |
| PXQ-14 / P1 | `get_spend_stats` combines settled, pending and legacy-estimated records; an incomplete successful response was converted to zero. | An additive service-role-only RPC separates recorded statuses by user and UTC window. The Edge function keeps existing totals for compatibility, rejects malformed required data and bounds the optional RPC; the UI labels both the separated records and the older-server fallback. SQL tests check roles and two-user separation; handler and UI tests cover fallback and malformed data. Historical rows marked settled may contain the former token estimate; cost-log projections can be incomplete or stale and are not a provider invoice. Existing rows were not rewritten. |
| PXQ-15 / P2 | The unsaved-response warning and spend analytics text were nearly invisible in Arctic Light. At 320px the spend panel extended beyond the viewport. | Use shared theme tokens, a bounded scrollable mobile panel and larger touch targets. Browser regressions measure warning and spend text contrast in both themes and check mobile bounds, scrolling and Escape. |
| PXQ-16 / P1 | `npm audit --omit=dev` reported high-severity `ws` advisories for the locked `8.19.0` used by Supabase Realtime. | Updated the existing compatible transitive lock to `8.23.0`; the production-dependency audit then reported zero vulnerabilities. |
| PXQ-17 / P0 | A `cost_projection_failed` reconciliation job could mark unresolved calls or a held reservation settled, and could substitute zero for an invalid amount. `budget_estimated` could also run before execution finalized or accept a committed zero-call reservation. | Require terminal execution, valid call counts and authoritative nonnegative amounts. Defer unresolved jobs, permit a committed zero only with settled calls, and permit a released zero only with no calls. Reconciliation tests cover the original failures, both zero-call guards, terminality, retry, and valid zero cases. |
| PXQ-18 / P1 | Open the public demo in the default light theme: its dark panels inherit dark foreground tokens, leaving labels and body text unreadable (the brand measured 1.88:1). On a narrow screen, code is clipped because the shared message renderer's CSS was only loaded by the chat route. | Scope the Arctic dark palette to the intentionally dark panels and load the renderer's existing styles with the shared component. A browser regression composites translucent backgrounds and checks representative text at 4.5:1 in both themes and at desktop/mobile widths; another verifies focused code scrolls by keyboard without page overflow. |
| PXQ-19 / P0 | Select a direct-provider model whose April 13 price audit is more than 60 days old. The freshness test warned but the server still used the stale rate for admission and settlement, potentially understating paid usage. | Fail closed for stale, malformed, missing or future audit dates on the four legacy pricing sources, and explain the unavailable estimate in the UI. A real router-handler regression verifies rejection before admission or provider calls. The tariff version changes so frontend/backend skew remains detectable. The 15 affected rates remain unchanged and require verification; manual routes and no-OpenCode fallback paths using them, and Debate plans containing them, remain unavailable until reviewed. |
| PXQ-20 / P1 | A router response without an exposed model header was attributed to a hardcoded legacy model; when that model's price was unknown, the cost details also displayed a fabricated zero breakdown while hiding a confirmed receipt total. | Treat an unreported model as unknown without replacing the selected model or calculating a guessed price. Preserve a settled receipt amount and hide unavailable client breakdowns. Browser fixtures now expose the model headers that the Edge router exposes; missing-header and unknown-cost cases have separate regressions. |
| PXQ-21 / P1 | A model identifier such as `constructor` matched an inherited JavaScript object property in catalog and router lookup code. It could be treated as a known model or rate even though it was not in either registry. | Require own properties in model and tariff lookup and override normalization. Unit checks cover inherited names and non-NaN unknown costs; real router-handler tests reject them before any provider call. |
| PXQ-22 / P1 | Reload a transcript containing a model ID newer than the local catalog: the ID could disappear, and a route rationale could be attached to the currently selected model instead. An interrupted stream with a genuinely settled $0 receipt also lost that confirmation. | Retain unknown model identity and rationale without inventing a model tier; preserve and record a settled zero while keeping the stream marked interrupted. Service and UI regressions cover both paths. |
| PXQ-23 / P1 | A malformed streamed receipt was cast directly to the trusted receipt type. Missing settlement fields could crash a turn, while invalid amounts or transcript markers could be mistaken for confirmation. | Validate receipt identity, status, settlement amounts, pending-call counts and call-state consistency; drop malformed receipts and untrusted transcript markers while retaining streamed content. Parser regressions cover missing and inconsistent fields, valid zero and pending cases, and malformed transcript data. |

The stale-model coupling budget reflects five new test-fixture references and
two source-classification references needed to test and block PXQ-19, offset by
three removed legacy references. No legacy route was added; the ratchet permits
no unaccounted increase over the resulting counts.

### Follow-up verification

- The full local Vitest run passed 1,029 tests in 105 files. TypeScript and the
  build passed; lint reported zero errors and 136 warnings. All ten Deno Edge
  entrypoints and the stale-model coupling budget passed. The production-only
  dependency audit reported zero vulnerabilities after the `ws` lock update;
  the full development-dependency audit was not completed.
- The synthetic Chromium suite passed 123 tests with two opt-in Compare cases
  skipped in its default build; both passed with the opt-in build and test
  environment. The updated history helper also passed its targeted desktop
  rerun. The expanded Pixel 5 emulation suite passed 43 tests;
  earlier mobile runs exposed drawer-transition races in test helpers, which
  were corrected and rerun. CI now includes the expanded mobile suite.
- An isolated PGlite PostgreSQL 18.7 fixture applied the 17 migrations used by
  the repository's Compare harness and passed the Compare durability and
  qualified-spend SQL fixtures, including separate owners, anonymous denial,
  and service-only access. This does not validate Docker PostgreSQL 17, hosted
  Auth, PostgREST, production grants or deployed functions. Docker socket access
  was unavailable in this environment. Exact-head CI runs the repository's
  PostgreSQL 17 harness independently.
- Desktop and mobile screenshots were captured from synthetic runs. The
  viewport matrix, keyboard, Axe and contrast checks provide useful regression
  evidence but are not a substitute for testing a physical device or a screen
  reader. This follow-up did not independently repeat native 200%/400% zoom.

The qualified-spend migration adds one function, reads existing `cost_logs`, and
does not rewrite rows. Rollout must apply it before deploying the matching
`spend_stats` function; the Edge function also falls back to the old response
when the new RPC is missing. Rollback may deploy the previous function and
leave the additive RPC and all records intact. Neither this migration nor any
function was deployed by this follow-up.

The authorized Supabase connection still cannot access the production project
identified by the frontend, and no provider key or paid-call budget was
available. Hosted migrations, Auth/RLS policy, Edge versions, real-provider
streaming and spending, physical-device keyboards, and screen-reader behavior
remain unverified. The Compare durability flag must remain off until the
documented staging and production gates are satisfied. The 15 legacy
direct-provider rates dated 2026-04-13 are blocked by PXQ-19 until a verified
provider-rate review; their dates and prices were not changed without evidence.
