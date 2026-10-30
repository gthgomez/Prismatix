# PX05 Settlement Lock-Order Repair Implementation Plan

> **For agentic workers:** execute this plan task by task in the current session. Keep every test database disposable and local.

**Goal:** Prevent PX05 admission expiry and reservation settlement from deadlocking while preserving reservation holds, settlement accounting, and RPC permissions.

**Architecture:** Add a transaction-scoped advisory mutex keyed by subject. Admission acquires it before budget-window/lease/reservation locks. Every reservation mutator discovers the subject without a row lock, acquires the same mutex, then continues its existing transaction logic. A dblink regression uses an advisory-lock barrier to force admission and final ledger settlement into the contested interleaving.

**Tech Stack:** Supabase SQL migrations, PostgreSQL 17, psql, dblink.

**Spec:** Parent task delegated from the Prismatix database audit; reproduce the PX05 admission-expiry versus final settlement lock cycle, then prepare a forward migration and deterministic SQL regression only if reproduced.

## Global Constraints

- Do not query or write the hosted Supabase project.
- Do not edit applied migration history; add one forward-only migration.
- Preserve budget calculations, permissions, unknown-usage holds, pending-reconcile states, and project-before-user window ordering.
- Do not claim full migration-chain validation from a focused PostgreSQL fixture.

## Review Focus

- Advisory-lock serialization must precede all conflicting row locks in admission and each reservation mutator; the dblink test must prove its barrier reached both sessions.
- Unknown or ambiguous usage must still retain the complete held amount and remain pending reconciliation.
- Repeated/terminal settlement remains idempotent and late ledger true-ups retain current behavior.
- Public/anon/authenticated callers must not gain a new callable path to the lock helper.
- The test must restore the shared project-window row and remove all committed fixtures even after a deadlock error.

---

### Task 1: Deterministic regression

**Files:**
- Create: `tests/integration/px05-admission-settlement-lock-order.sql`
- Modify: `tests/integration/admission-concurrency.sql`

**Interfaces:** Use the final `public.px05_admit_execution(uuid, uuid, numeric, numeric, integer, integer, numeric, numeric, integer)` and `public.px05_commit_from_ledger(uuid)` definitions. Coordinate through dblink and a test-only trigger that waits on a session advisory lock after admission has locked both budget windows.

- [x] Write the test so it asserts both RPCs complete and validates committed settlement plus unchanged unknown-usage hold behavior.
- [x] Run against the unfixed definitions and confirm PostgreSQL reports the forced deadlock.
- [x] Ensure the existing admission test runs against the final migrated definitions instead of reapplying the older PX05 function bodies.

### Task 2: Forward migration

**Files:**
- Create: one timestamped migration for PX05 subject-operation serialization.

**Interfaces:** Add a private `public.px05_lock_reservation_subject(uuid) returns uuid` security-definer helper. It performs an unlocked subject lookup, then obtains `pg_advisory_xact_lock(hashtextextended('prismatix-px05:' || subject_id::text, 0))`. `px05_admit_execution` obtains the same lock directly after parameter validation. Each reservation mutator calls the helper before its first `FOR UPDATE` or lease/window update.

- [x] Add fail-closed helper grants and apply the same mutex to admission, commit, ledger settle, estimate, release, and explicit reconciliation RPCs.
- [x] Preserve all current accounting branches and current project-then-user budget-window lock order.
- [x] Run the regression and assert both concurrent calls complete.

### Task 3: Verification and delivery

**Files:**
- Test the new concurrency regression and `tests/integration/admission-concurrency.sql` against the disposable PostgreSQL 17 database.

- [x] Verify all targeted accounting assertions and the 50-admit concurrency check execute with dblink enabled (not skipped).
- [x] Run `git diff --check`, inspect the complete migration and test diff, and record the focused database setup limitations.
- [ ] Leave the patch on a task branch for independent review; do not merge or deploy.

## Local verification record

- Reproduced the original race on PostgreSQL 17.11 with the actual PX05 admission function and final `20261018` ledger-settlement function. A trigger barrier paused admission after it locked the budget windows; settlement then took the reservation lock. Releasing the barrier produced PostgreSQL `deadlock detected` with both sessions waiting on each other's transaction IDs.
- The regression failed on the unfixed definitions and passed after the forward migration. It asserts the settlement session waits specifically on the subject advisory mutex, both operations finish, known cost is committed, the new admission hold remains, and unknown-cost settlement stays `pending_reconcile` with its full hold.
- `tests/integration/admission-concurrency.sql` passed on the same database with dblink enabled, including its two-session 50-admission quota case. The test no longer reapplies the obsolete PX05 migration, which would replace the final settlement function. Its dblink workload was corrected to send one set-returning statement per connection, since dblink rejects another active query on the same connection. Fixture execution IDs are now unique; a project-window reset isolates the shared-quota assertion.
- The test database applied the init, memory, cost-log, PX03, PX05, and relevant final PX05 function definitions, then the new migration. This is a focused real-function test, not validation of the entire Supabase migration chain.
- Full local Supabase startup was unavailable: the configured `supabase/postgres:17.11.0.006` image pull failed with Docker `no space left on device` while registering a layer. A smaller official `postgres:17-alpine` (PostgreSQL 17.11) container was used instead. No hosted database was queried or changed; production is unverified.

## Transaction scope

The deployed call sites in `supabase/functions/router/admission.ts` call each PX05 RPC through a separate `client.rpc(...)` HTTP request; admission and each reservation mutation accept one execution ID, and no caller batches different subjects in one transaction. The subject advisory lock is transaction-scoped and is correct for that one-RPC-per-request contract. A service-role SQL caller must not invoke PX05 operations for multiple subjects inside one explicit transaction; the comment is included in the forward migration next to the helper. The repository has no direct database transaction wrapper that batches these RPCs.
- The regression now requires the admission trigger barrier and settlement advisory-lock wait to be observed, requires both RPC results to be error-free, and preserves setup errors in its failure report. Worker sessions use 10-second lock and 15-second statement timeouts; cleanup releases the barrier, drains/disconnects dblink sessions, drops the test trigger, removes fixtures, and restores the prior project window.
- Negative controls were run: a no-op admission barrier failed with `admission:false`; a no-op subject-lock helper failed with `settlement-advisory:false` and reproduced the deadlock. The old-function regression also fails with a real deadlock and reports the missing settlement advisory wait. The patched regression and admission-concurrency test pass.
- An additional no-wait-observation negative control produced `settlement-advisory:false` with successful accounting results, exited as a recorded regression failure, and left zero test reservations while restoring the project-window snapshot. Missing wait observations are explicitly normalized to false, and the final pass expression is forced to a non-null boolean.
