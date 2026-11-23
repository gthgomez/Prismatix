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

**Scheduler deployment gate:** the two historical cron SQL files are inert in
this candidate, and a later forward migration can disable pre-existing jobs before
optionally configuring an identified staging target. Both actions require
separate explicit operator intent where applicable. Their version IDs and
already-applied history remain intact, but their source now differs from what
was originally shipped. Git retains the original SQL. Do not replay old source
files, and check any external checksum or statement-history tooling before a
rollout. An existing installation may already have a dangerous job or queued
request: follow the quarantine steps below before applying anything. The local
cron and network stand-ins do not demonstrate managed Supabase behavior.

**Do not apply this repair to production without separate authorization and a
reviewed production-worker replacement.** An existing matching production job
causes the migration to fail without quarantine intent; opting in would remove
it, so a production rollout needs a separate design. No production schedule was
changed in this task.

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
| PXQ-24 / P0 | Inject an unexpected provider metadata error containing a decrypted saved key. `provider-settings/index.ts` returned the exception message, exposing key material in the authenticated response. Google validation also placed the key in the request URL. | Return fixed safe error messages, recognize native timeouts, and use the same `x-goog-api-key` header as the router. The frontend uses its own safe inconclusive-status copy even if an older function returns raw error text. Handler tests exercise draft and decrypted saved keys, network errors, timeouts and request construction; UI tests cover older-backend responses. The modified Edge entrypoint passes Deno check. Live Google behavior remains unverified. `7478f9b`, `de3e8db` |
| PXQ-25 / P1 | Test an NVIDIA key: the fallback returned `enabled` without making a validation request, so Provider Settings reported it verified. In first-run recovery, requiring every enabled provider to verify could prevent a verified OpenRouter key from unblocking the workspace. | Report an unsupported check as inconclusive, reject the older function's saved-only success response as verification, explain it in Provider Settings, and target the first-run recovery check to OpenRouter. All-provider verification and ordinary router authorization retain their existing scope. Handler, hook and UI regressions cover the unsupported check, truthful state, timeout and recovery. `7478f9b`, `de3e8db` |
| PXQ-26 / P1 | The candidate preview selected Node 26 because `engines.node` admitted every future major, while CI tested 20, 22 and 24. The full npm audit reported 19 development-tool advisories, including two critical findings; the production-only audit was clean. Vercel used `npm install` while CI used `npm ci`. | Limit the engine range to the tested major versions, use `npm ci` for deployment, update compatible lockfile resolutions and use Vitest 4.1.12. Vitest 5 would have dropped Node 20 support. Full and production-only audits both report zero vulnerabilities; `npm ci`, TypeScript, build, lint and the full unit suite pass on Node 24. Release verification must include Vercel's selected Node and CI on Node 20/22. `5015544` |
| PXQ-27 / P1 | Open `/demo`: it described the disabled OpenCode path as the default, claimed keys were kept in Edge Function secrets, and displayed unsupported `100%` and `0 ms` security metrics. | Describe the implemented BYOK routes and server-side encryption, remove invented metrics and label the interactive scenario as prerecorded. A browser regression checks the public routing, credential and synthetic-data copy. Hosted isolation is not certified. `681e9f3` |
| PXQ-28 / P2 | Open the public debate demo or a response containing `####`–`######` headings. The shared Markdown renderer displayed the marker as prose because it only recognized three heading levels. | Render these headings with bounded semantic heading levels and existing visual tokens. Unit coverage checks all three levels, inline formatting and a seven-marker literal. `681e9f3` |
| PXQ-29 / P1 risk | The preview response had neither `frame-ancestors` nor `X-Frame-Options`, and its document loaded in a cross-origin iframe. In this browser, third-party storage was denied and the app showed startup recovery; an authenticated clickjacking exploit was not demonstrated. | Add `frame-ancestors 'none'` and `X-Frame-Options: DENY` to the Vercel response headers. A local Chromium check with the same headers confirmed a sandboxed `srcDoc` artifact preview still renders. Verify the headers and a cross-origin frame denial on the actual preview. This intentionally disallows undocumented embedding of the app. |

The stale-model coupling budget reflects five new test-fixture references and
two source-classification references needed to test and block PXQ-19, offset by
three removed legacy references. No legacy route was added; the ratchet permits
no unaccounted increase over the resulting counts.

### Follow-up verification

- The latest integrated local Vitest run passed 1,042 tests in 105 files.
  TypeScript and the build passed; lint reported zero errors and 136 warnings.
  All ten Deno Edge entrypoints passed earlier checks, and the changed provider
  settings function was checked again. The stale-model coupling budget passed.
  Full and production-only npm audits each reported zero vulnerabilities after
  the runtime `ws` and development-tool lock updates.
- The synthetic Chromium suite passed 124 tests with two opt-in Compare cases
  skipped on `5015544`. The later `de3e8db` change only affects provider
  verification compatibility, which also has focused unit coverage. The latest
  Pixel 5 emulation run passed 46 cases on the integrated product code;
  earlier mobile runs exposed drawer-transition races in test helpers, which
  were corrected and rerun. CI includes the expanded mobile suite and runs
  the opt-in Compare fixture separately; both opt-in cases also passed locally
  against the integrated product code.
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
function was deployed by this follow-up. Deploy the matching `provider-settings`
function before the frontend so that the new validation semantics and safe
failure messages are present together.

The authorized Supabase connection still cannot access the production project
identified by the frontend, and no provider key or paid-call budget was
available. Hosted migrations, Auth/RLS policy, Edge versions, real-provider
streaming and spending, physical-device keyboards, and screen-reader behavior
remain unverified. The Compare durability flag must remain off until the
documented staging and production gates are satisfied. The 15 legacy
direct-provider rates dated 2026-04-13 are blocked by PXQ-19 until a verified
provider-rate review; their dates and prices were not changed without evidence.

## Handoff qualification on 2026-11-21

The handoff began from #73 head `6d55d638700cccb1faf8b194e7d536e0a8182bb3`.
Its exact-head [CI run](https://github.com/gthgomez/Prismatix/actions/runs/44923904307)
passed four jobs and its matching Vercel preview was ready. The integrated
Arctic branch remains the candidate. Durable Compare remains disabled for the
candidate build; the existing CI opt-in fixture is isolated synthetic coverage.
The handoff implementation commits are `1ef0d20` (PXQ-33, PXQ-34 and PXQ-38),
`0c19703` (the auth, account isolation, mobile, cost and image-preview
changes), and `30be28e` (the deterministic stalled-session fixture).
`bb499df` corrects the desktop starter-card layout.
Reciprocal reviews used shared task context; they are not a GitHub
approval or a blind security audit.

| ID / priority | Finding and root cause | Correction / evidence |
| --- | --- | --- |
| PXQ-30 / P1 | A stalled password sign-in on the starting preview left the submit button indefinitely loading. A saved-session refresh can also be retried by the Auth SDK after an individual request times out. | Bound Auth fetches, including response bodies, without allowing a late successful response to reach the SDK. Show loading status and offer a retry when the saved-session check fails. The SDK may retry within its own window, so initialization can take longer than one fetch deadline. |
| PXQ-31 / P1 | On the starting preview at 320×568, failed-send recovery actions were 25–32 CSS pixels high and Dismiss extended beyond the viewport. | Wrap the recovery actions and use reachable touch targets. A narrow-viewport browser regression checks their bounds and the composer. |
| PXQ-32 / P1 | The streaming cost popover added a live estimate to a session subtotal labelled as a total. | Label the live value as an estimate and show only confirmed receipts in the session subtotal. |
| PXQ-33 / P0 | A settled model-call or reservation amount of `NaN`, a negative number, or another malformed value was projected as a confirmed zero or negative receipt. PostgreSQL `numeric(12,6)` accepts `NaN`. | Reject malformed values from settled receipt projection and retain a pending status. Handler and projection tests cover malformed values and genuine zero. This does not repair historical database rows. |
| PXQ-34 / P0 | The final ledger and budget RPCs accept a settled call with `NaN` or negative cost and can commit that value to budget windows. They also turn an omitted or NULL settled amount into zero. A pre-existing negative window can understate spending on later admission. Reproduced through the actual RPCs in rolled-back local PostgreSQL transactions. | The forward-only PX13 migration rejects new invalid amounts, blocks settlement of legacy invalid calls and refuses writes to invalid reservation/window balances without rewriting rows; the router also rejects invalid settled inputs before the RPC. The SQL fixture checks retained holds, corrupt project/user windows, late settlement, explicit zero, missing values and role denial. Pre-existing invalid records require operator review. |
| PXQ-35 / P0 | The live image function supplies fewer admission arguments than the candidate database requires, has no stable caller-supplied execution identity, treats an estimate as settled, and can reconcile an ambiguous provider failure to zero. The local preview also attached the estimate to an unmetered mock and its dialog lacked keyboard focus handling. | Keep live image dispatch closed in both candidate client and Edge handler until those safeguards are repaired and verified. Explain the limitation and retain a free local placeholder, labelled as such, with zero cost. The handler test proves rejection before key access, budget mutation or provider dispatch; browser checks cover focus trapping, Escape and focus return. This containment has not been deployed. |
| PXQ-36 / P0 deployment blocker | The historical video-worker cron migration hardcoded the production project URL; an earlier migration unconditionally scheduled a placeholder. A later cleanup cannot undo a request that fired during replay. | The historical versions are now inert for fresh replay; the forward repair requires quarantine intent before removing all visible matching jobs in the current database by ID, and fails on inadequate visibility or failed removal. Isolated PostgreSQL fixtures record every schedule and execute local and synthetic staging commands against a deterministic no-network localhost recorder. Existing installations require prior quarantine; hosted behavior and target identity remain unverified. |
| PXQ-37 / P1 deployment uncertainty | The repository's local SQL harness grants authenticated table privileges by default. It therefore cannot prove the actual hosted Data API grants or exposed schema settings. | Verify effective grants, RLS and PostgREST exposure on the identified nonproduction project; test separate authenticated owners and anonymous denial there. |
| PXQ-38 / P0 test safety | The admission concurrency fixture recommended staging, re-applied an older migration, and deleted budget rows for the current day. The ledger and receipt fixtures also re-applied older RPC definitions, masking the integrated schema. | Require a fresh empty disposable `_test` database before any concurrency writes, remove broad deletions and historical migration replays, and use two asynchronous dblink batches. Re-run the fixtures against the final migrated schema. |
| PXQ-39 / P0 | Switch directly from account A to B while B's saved selection points at A's conversation and B's history request is denied. The selected-id comparison could leave A's transcript displayed; an open A workspace dialog also remained mounted. | Clear the transcript, selection and pending history synchronously on account change, and key the workspace by account so all account-owned dialog and component state remounts. A direct rerender regression checks the denied load, and a synthetic two-account browser event checks the open-dialog case. |
| PXQ-40 / P2 | At 1440×900 the starter cards extended about 23 CSS pixels beneath the composer in the initial desktop view. | Reduce excess space above the cards. A geometry regression checks their bottom against both the message viewport and composer; compact/mobile scroll-reachability checks still pass. |

The local PostgreSQL 17 cluster is disposable and listens only on its private
Unix socket. An independently run replay applied all 32 pre-existing migrations
and PX13 in order to a fresh UTF-8 database. Both cron migrations used inert SQL
stubs which record commands but have no scheduler and no `net.http_post`. Before
PX13, a rolled-back fixture seeded legacy invalid amounts and applied PX13 to
verify the guard; after PX13, SQL fixtures exercised receipt ownership, ledger
isolation, spend qualification and 50 admission attempts across two connections.
They do not exercise managed Auth, Storage, Vault, PostgREST, Edge deployment
or real cron/network behavior.

On the combined implementation, TypeScript, the production build, 1,077
Vitest tests, the model-coupling budget and the changed router, provider-settings
and image-generation Deno checks passed. Lint had zero errors and 136 warnings;
the npm audit reported zero known vulnerabilities. A full synthetic desktop
Chromium run passed 130 tests with two durable-Compare opt-in tests skipped;
the focused mobile run passed 54. Those full runs preceded the final desktop
spacing-only change and the last refresh-fixture refinement; the revised
refresh case passed six repeated desktop/mobile runs and the spacing change
passed targeted desktop and mobile geometry checks. Exact-head CI remains a
separate required check.

The browser journey on the starting exact preview entered credentials through
the mobile sign-in form, connected a provider, sent, reloaded, continued and
reloaded again. Auth, provider, database and router responses were synthetic;
two intentional router calls were observed and no live provider call was
made. The stalled-sign-in and clipped-recovery reproductions were also on that
preview. Physical-device keyboards and screen readers were not observed.

The first combined browser runs exposed a test setup error: the expired session
was stored under a key that did not match the synthetic build's Supabase host.
The corrected fixture checks that a refresh was actually requested and reads
the key derived from that request. A later run found that the test clock stayed
paused after retry; the test now resumes it before loading the workspace. The
held mock network requests are released after the explicit retry, matching a
restored connection and avoiding a synthetic lock that never resolves. The
image-dialog keyboard check also initially failed on the missing focus behavior
and passed after the repair. These intermediate failures are not treated as
passing evidence.

### Video worker: safe replay, existing installations and rollback

- Fresh replay applies the retained historical version IDs with inert SQL, then
  `20261121234725_disable_unsafe_video_worker_cron.sql`. No cron, pg_net or
  Vault extension is installed by this repair. Without an explicit enable
  marker, no job is registered. Missing/duplicate configuration, an invalid
  project reference or the known production reference also leaves it disabled.
  The all-zero synthetic reference used in tests is never contacted: its
  requested URL is recorded by an inert SQL function that routes every fixture
  call to a localhost recorder with no network operations.
- The `local-test-stub` sentinel requires both a test-session marker and a
  distinctive marker in the stub function at registration and execution. These
  markers are safeguards, not proof of isolation from a privileged database
  owner; test infrastructure must also block network access. A normal pg_cron
  backend does not inherit the test session marker, so the sentinel is a
  manually exercised test hook, not a hosted worker configuration.
- An existing installation may already have active or in-flight jobs and queued
  pg_net requests. Independently confirm project identity and isolate egress;
  inventory every relevant same-name job across databases, stop or quarantine
  those jobs, and account for all in-flight/queued work. A migration cannot
  recall a request already sent. The scripts examine matching jobs **only in
  the current database** and deliberately leave jobs in other databases intact;
  those require separate authorized handling. A same-name job owned by the
  scheduler in another database is a pg_cron upsert collision: the forward
  script fails atomically and does not overwrite it. That failure rolls back
  any cleanup in its own transaction, so quarantine remains necessary.
- A role must have cross-owner `cron.job` visibility, effective privilege to
  acquire a `SHARE ROW EXCLUSIVE` lock on that table, and authority to
  unschedule every matching job in the current database. Before either script modifies an
  existing job, set `prismatix.video_worker_quarantined = 'on'` **in that
  operator session** after completing quarantine. Without it the script fails
  atomically; the flag expresses intent, not proof of project identity or
  isolation. With inadequate visibility or failed removal it also fails, so a
  failure does not establish that jobs are stopped. The two scripts use a
  shared transaction advisory lock for cooperating invocations and a table
  write lock that excludes external schedule writes until the transaction
  finishes; it cannot prevent later re-enablement. Use `READ COMMITTED`
  isolation: stronger isolation fails before either lock to avoid stale
  snapshots. Both locks use nonblocking acquisition; if either is busy,
  investigate and explicitly retry after the competing transaction ends.
- For an existing installation, the controlled disable SQL may be run in the
  verified nonproduction database under an authorized transaction with
  `SET LOCAL prismatix.video_worker_quarantined = 'on'`, followed by
  `supabase/operations/disable_video_worker_cron.sql`. Verify current-database
  jobs and queues are absent and handle other databases separately before the
  normal ordered migration process. This avoids falsely repairing migration
  history; no such hosted action has been authorized or performed here.
- Enabling a staging job is a separate authorized operation after independently
  matching the staging database and Edge endpoint identities. With pg_cron,
  pg_net and Vault available, configure exactly one Vault record named
  `video_worker_staging_project_ref` with that 20-character reference and one
  `video_worker_secret` matching the function. The secret must consist solely
  of printable ASCII bytes `!` through `~` (no whitespace or control bytes).
  Set `prismatix.video_worker_enable_staging = 'on'` in the operator session
  and rerun the reviewed forward SQL. Replacing an existing job also requires
  the separate quarantine marker. The enable marker gates registration only;
  the later cron backend need not inherit it. These flags do not prove that
  an arbitrary reference identifies the intended staging project or that the
  secret matches the deployed worker.
- The URL is constructed from the staging reference, excluding the known
  production reference; the command never embeds the credential. Removing,
  changing or duplicating the reference, or removing, duplicating or invalidating
  the secret, suppresses calls at execution. Valid secret rotation works. To
  roll back, quarantine and account for outstanding work, run the disable SQL
  with explicit quarantine intent, and verify the scoped inventory. The script
  is idempotent and preserves other-database jobs, Vault entries, migration
  history and application data. Never restore the old production-targeted job
  on staging. Re-enabling requires explicit independent authorization.

The CI PostgreSQL harness is configured to run the same SQL fixtures as local
`psql`, including nonblocking lock, isolation, retry and external-writer
tests, in a network-disabled container. The fixtures emulate pg_cron, Vault and pg_net; they do not prove
managed extension privileges, scheduling, queue draining, or hosted behavior.

### Minimum staging access and rollout gate

1. Identify an existing **nonproduction Prismatix** project by project reference
   and grant read access to its migration history, database schema and effective
   grants/RLS, exposed Data API schemas, Auth policy, Edge function versions,
   and scheduled jobs, with cross-owner `cron.job` visibility. Inspect secret
   names/configuration only; no secret values are needed for this inventory.
   The connected project observed in this task belongs to a different
   application and must not be used.
2. For actual acceptance, authorize disposable staging database changes and
   matching test-function deployment only after the cron target is made safe;
   provide authority to quarantine egress, account for in-flight and queued
   requests, acquire the required `cron.job` table lock, and unschedule matching
   jobs across owners; permission to manage
   the two staging Vault entries is needed only when enabling the worker. Also
   provide two disposable Auth identities, anonymous access and a controlled
   service-role test path. This permits owner/cross-owner/anonymous negative
   tests, receipt and spend RPC checks, and authenticated browser journeys.
   A deterministic non-billable provider stub is required for execution tests;
   no live provider calls or spend are authorized in this handoff.
3. Keep durable Compare disabled. Apply reviewed pending database changes in
   order after the scheduler gate, then deploy compatible router, provider
   settings and spend functions before the matching frontend. Verify the API
   schema cache sees the updated ledger RPC signature. Inspect legacy invalid
   money records and their associated reservations/windows without rewriting
   them automatically; a mixed valid/invalid call history may have left a
   numerically valid but incorrect aggregate. PX13 adds `NOT VALID` checks,
   which avoid scanning old rows but still require table locks and reject later
   writes to invalid rows; plan and monitor that rollout. A full PX13
   rollback requires dropping its trigger, trigger function and check
   constraints and restoring only the prior `px03_record_model_call` definition
   and grants from `20261018000000_debate_settlement_and_continuity.sql`; retain
   all rows and do not replay that entire historical migration. Rollback restores
   the invalid-settlement defect. Production rollout or a merge that triggers it
   requires separate authorization.

The following read-only preflight returns counts, not user records. Any nonzero
result requires scoped operator investigation before enabling paid workflows;
zero counts alone do not prove that historical totals are accurate.

```sql
select 'model_calls' as source, count(*) from prismatix_internal.model_calls
 where total_cost::text in ('NaN', 'Infinity', '-Infinity') or total_cost < 0
union all
select 'budget_reservations', count(*) from prismatix_internal.budget_reservations
 where amount_usd::text in ('NaN', 'Infinity', '-Infinity') or amount_usd < 0
    or committed_usd::text in ('NaN', 'Infinity', '-Infinity') or committed_usd < 0
union all
select 'budget_windows', count(*) from prismatix_internal.budget_windows
 where limit_usd::text in ('NaN', 'Infinity', '-Infinity') or limit_usd < 0
    or held_usd::text in ('NaN', 'Infinity', '-Infinity') or held_usd < 0
    or committed_usd::text in ('NaN', 'Infinity', '-Infinity') or committed_usd < 0;
```

## Independent qualification pass · 2026-11-22

An independent investigation re-derived the blockers from scratch rather than
accepting the earlier report. Two conclusions changed.

### Correction 1: the cron failure is a delivery-path defect, not a privilege defect

Reproduced on a disposable PostgreSQL 17.12 fixture with a faithful `cron.job`
reconstruction:

- All migrations applied to an **empty** database pass, including the cron file
  (it returns early when `cron.job` is absent).
- With a production-shaped `video_worker_every_minute` row present, the run
  **aborts** at `20261121234725_disable_unsafe_video_worker_cron.sql` with
  `Video worker cleanup requires explicit quarantined-job intent`.
- The same file succeeds when `prismatix.video_worker_quarantined='on'` is set in
  the session, then removes the job, is idempotent, and installs no extension.

So the migration is *correct but undeliverable*: `supabase db push` runs each file
in its own transaction and cannot set a session GUC. On the partition where this
matters — an existing installation — it wedges every later migration.

Privilege measurement (same fixture, `SELECT`-only role): `LOCK ... SHARE ROW
EXCLUSIVE` returns `42501`; `DELETE` returns `42501`; `cron.unschedule(jobid)`
returns `true` **vacuously** because RLS hid the row. As owner, both succeed.
This confirms the lock's privilege requirement as a mechanism, but the claim that
the production `postgres` role actually lacks it remains **unverified** — and if
true would imply the job could not have been removed by SQL at all.

**Disposition.** The cron operation moved to
`supabase/operations/quarantine_video_worker_cron.sql`; the migration was removed.
Live-scheduler work is now an authorized operator action, not schema history.

### Correction 2: the frontend env `define` block is not a defect

`vite.config.ts` scopes `define` to `process.env.VITEST` and uses
`synthetic-test.supabase.co`. It does not affect production builds. An earlier
claim to the contrary was read from `main`, not the PR head.

Measured precedence, which does still constrain tooling: `process.env` wins over
`.env*` files. A guard must therefore read what Vite resolves, not `process.env`
alone.

### New gates

- `scripts/assert-environment-isolation.mjs` — refuses to build a non-production
  deployment against the production Supabase project. Wired into `npm run build`,
  so a dashboard deploy cannot bypass it. Verified across five scenarios.
- `tests/integration/run-fresh-replay.sh` — all migrations against an empty
  database (33 applied, no scheduler installed).
- `tests/integration/run-existing-install-replay.sh` — all migrations over a
  database that already carries the scheduler row. This is the fixture that
  **fails** on the removed migration and passes without it.
- `supabase/operations/rollback_px13.sql` — the rollback that previously existed
  only as prose. Verified: 6 constraints → 0, trigger and function removed.

### Verification actually run

| Check | Result |
|---|---|
| `npm run type-check` | pass |
| `npm run test` | 1077 tests / 107 files pass |
| `npm run lint` | 0 errors, 136 warnings (unchanged) |
| `npm run build` | pass, with the isolation guard in the pipeline |
| `deno check` on all 10 Edge entrypoints | pass |
| All 34 → 33 migrations on a fresh DB | pass, no scheduler installed |
| `db push` shape with the job present | failed before, passes after |
| Operator quarantine | removes the job, idempotent, fail-closed without pg_cron |
| PX13 rollback | removes guards |
| Isolation guard, 5 scenarios | production-backed preview rejected in all variants |

### Still unverified

Hosted Supabase `cron.job` ownership and effective privileges (read-only query
prepared, not yet run); hosted Auth/RLS/RPC behaviour; Edge deployment order;
real provider streaming and settlement; physical-device and screen-reader
behaviour. No hosted migration, schedule change, secret change, or merge was
performed in this pass.

