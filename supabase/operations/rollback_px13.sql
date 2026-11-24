-- Rollback for PX13 (20261121220000_px13_budget_settlement_cost_guards.sql).
--
-- OPERATOR PROCEDURE -- NOT A MIGRATION.
--
-- PX13 is forward-only by design. This script undoes its guards and restores the
-- prior settlement function. It deliberately does NOT rewrite or delete any
-- ledger rows: historical amounts stay exactly as recorded.
--
-- WARNING: rolling back RE-OPENS the invalid-settlement defect PX13 closed.
-- A settled model call with NaN, infinity, or a negative amount can again be
-- projected into budget windows. Only run this if a guard is causing an outage
-- that cannot be resolved by reconciling the offending rows.
--
-- SCOPE: the prior definition restored below is the PX07/PX18 revision from
-- 20261018000000_debate_settlement_and_continuity.sql. Do not replay that whole
-- historical migration; it also recreates unrelated objects.

begin;

-- 1. Drop the guard trigger and its function.
drop trigger if exists budget_reservations_guard_invalid_settlement
  on prismatix_internal.budget_reservations;
drop function if exists prismatix_internal.guard_invalid_budget_settlement();

-- 2. Drop the NOT VALID check constraints.
alter table prismatix_internal.model_calls
  drop constraint if exists model_calls_total_cost_nonnegative_finite_ck;
alter table prismatix_internal.budget_reservations
  drop constraint if exists budget_reservations_committed_usd_nonnegative_finite_ck;
alter table prismatix_internal.budget_reservations
  drop constraint if exists budget_reservations_amount_usd_nonnegative_finite_ck;
alter table prismatix_internal.budget_windows
  drop constraint if exists budget_windows_limit_usd_nonnegative_finite_ck;
alter table prismatix_internal.budget_windows
  drop constraint if exists budget_windows_committed_usd_nonnegative_finite_ck;
alter table prismatix_internal.budget_windows
  drop constraint if exists budget_windows_held_usd_nonnegative_finite_ck;

-- 3. Restore the prior settlement function (the PX07 revision that PX13 replaced).
--    Reproduce it verbatim from 20261018000000_debate_settlement_and_continuity.sql.
--    NOTE: that file must be consulted for the exact body at rollback time; it is
--    intentionally not duplicated here to avoid shipping a subtly different copy.
\echo 'PX13 rollback: constraints and trigger dropped.'
\echo 'PX13 rollback: now restore public.px03_record_model_call from'
\echo '  20261018000000_debate_settlement_and_continuity.sql (the prior revision).'
\echo 'Re-grant: revoke all from public, anon, authenticated; grant execute to service_role.'

commit;
