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
  local to the current view. Provider and network failures can still leave
  partial answer text available only in the active workspace if the router
  cannot save a transcript. Compare's combined client estimate and server
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
