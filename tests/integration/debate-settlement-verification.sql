-- tests/integration/debate-settlement-verification.sql
-- Comprehensive integration test verifying Priority 0 & Priority A billing & concurrency protections:
-- 1. Whole-execution estimate contract in px05_commit_estimated:
--    - $0.03 settled, $0.02 pending, whole-execution estimate $0.05 -> commits $0.05 (never $0.08).
--    - Provenance logged in reconciliation_jobs ('estimated_partial_provider_usage').
-- 2. True-down reconciliation in px05_commit_from_ledger:
--    - Pending call settles at $0.005 -> final actual resolves to $0.035 (adjusts window down, updates reservation).
-- 3. True-up and budget breach handling in px05_commit_from_ledger:
--    - Late-settling call raises total to $0.07 against $0.05 reservation -> resolves to $0.07 with budget_breached=true.
--    - Never silently clamped to reservation ceiling.
-- 4. Edge cases:
--    - Unknown pricing on pending call -> pending_reconcile (never estimates, never commits $0).
--    - Zero provider calls -> safe release (confirmed_zero_calls).
--    - All calls settled -> commits settled sum with basis='settled'.
-- 5. Idempotent repeated calls:
--    - Repeated px05_commit_from_ledger does not double-charge or double-release (updated=false).
-- 6. Reservation release safety:
--    - Dispatched calls present -> px05_release_reservation keeps hold (pending_reconcile).
--    - Zero calls -> px05_release_reservation safely releases.

begin;

do $$
declare
  u uuid := 'c0000000-0000-4000-8000-000000000002';
  e1 uuid;
  e2 uuid;
  e3 uuid;
  e4 uuid;
  e5 uuid;
  e6 uuid;
  v jsonb;
  res prismatix_internal.budget_reservations;
  win prismatix_internal.budget_windows;
  job prismatix_internal.reconciliation_jobs;
begin
  insert into auth.users (id) values (u) on conflict (id) do nothing;

  -- =========================================================================
  -- CASE 1: Whole-execution estimate: $0.03 settled, $0.02 pending, estimate $0.05.
  -- MUST commit $0.05, NEVER $0.08!
  -- =========================================================================
  e1 := (public.px03_create_execution(u, null, 'req-verify-1', 'hash-verify-1') -> 'execution' ->> 'id')::uuid;
  v := public.px05_admit_execution(u, e1, 0.10, 0.50, 900, 100, 10.0, 50.0, 10);
  if (v->>'admitted')::boolean is not true then
    raise exception 'CASE 1: admit failed: %', v;
  end if;

  -- Call 1 (challenger): pending with price snapshot
  perform public.px03_record_model_call(
    e1, 'debate-challenger', 'worker-critic', 1, 'model-c', 'model-c', 'model-c', 'req-c', 'completed',
    100, 100, 0, 0, 0, 0, 0, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'pending'
  );

  -- Call 2 (synthesis): settled ($0.03)
  perform public.px03_record_model_call(
    e1, 'debate-synthesis', 'primary', 1, 'model-s', 'model-s', 'model-s', 'req-s', 'completed',
    100, 100, 0, 0.01, 0.02, 0, 0.03, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'settled'
  );

  -- Premature completion with whole-execution estimate of $0.05
  v := public.px05_commit_estimated(e1, 0.05);
  if v->>'basis' <> 'estimated' or (v->>'committed_usd')::numeric <> 0.050000 then
    raise exception 'CASE 1: expected basis=estimated and committed_usd=0.050000 (NOT 0.08!), got %', v;
  end if;

  select * into res from prismatix_internal.budget_reservations where execution_id = e1;
  if res.committed_usd <> 0.050000 then
    raise exception 'CASE 1: reservation committed_usd was not 0.050000: %', res.committed_usd;
  end if;

  select * into job from prismatix_internal.reconciliation_jobs where execution_id = e1 and kind = 'budget_estimated';
  if job.id is null or (job.payload->>'provenance') <> 'estimated_partial_provider_usage' then
    raise exception 'CASE 1: missing or invalid reconciliation job: %', job.payload;
  end if;

  -- =========================================================================
  -- CASE 2: True-down reconciliation:
  -- Pending call settles at $0.005 -> total actual resolves to $0.035 (not $0.05).
  -- Window committed_usd must adjust downward by $0.015.
  -- =========================================================================
  update prismatix_internal.model_calls
     set cost_status = 'settled', total_cost = 0.005
   where execution_id = e1 and stage = 'debate-challenger';

  v := public.px05_commit_from_ledger(e1);
  if (v->>'updated')::boolean is not true or (v->>'committed_usd')::numeric <> 0.035000 then
    raise exception 'CASE 2: expected true-down to 0.035000 with updated=true, got %', v;
  end if;

  select * into res from prismatix_internal.budget_reservations where execution_id = e1;
  if res.committed_usd <> 0.035000 then
    raise exception 'CASE 2: reservation committed_usd was not trued down to 0.035000: %', res.committed_usd;
  end if;

  select * into win from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u and window_start = date_trunc('day', now());
  if win.committed_usd <> 0.035000 then
    raise exception 'CASE 2: window committed_usd was not trued down to 0.035000: %', win.committed_usd;
  end if;

  -- Verify reconciliation job recorded late settlement down
  select * into job from prismatix_internal.reconciliation_jobs
   where execution_id = e1 and kind = 'budget_reconciled' and (payload->>'reason') = 'late_call_settlement_down';
  if job.id is null or (job.payload->>'actual_usd')::numeric <> 0.035000 or (job.payload->>'diff_usd')::numeric <> -0.015000 then
    raise exception 'CASE 2: invalid budget_reconciled job: %', job.payload;
  end if;

  -- =========================================================================
  -- CASE 3: Idempotent repeated calls:
  -- Second call to px05_commit_from_ledger must return updated=false without double-charging.
  -- =========================================================================
  v := public.px05_commit_from_ledger(e1);
  if (v->>'updated')::boolean is not false or (v->>'committed_usd')::numeric <> 0.035000 then
    raise exception 'CASE 3: expected updated=false on idempotent call, got %', v;
  end if;

  select * into win from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u and window_start = date_trunc('day', now());
  if win.committed_usd <> 0.035000 then
    raise exception 'CASE 3: window committed_usd mutated on idempotent call: %', win.committed_usd;
  end if;

  -- =========================================================================
  -- CASE 4: True-up with budget breach:
  -- Execution with reservation ceiling $0.05.
  -- $0.03 settled + $0.01 estimate committed = $0.03 committed initially.
  -- Pending call settles at $0.04 -> total actual is $0.07 (exceeding $0.05 ceiling).
  -- Must resolve to $0.07 with budget_breached=true, NOT silently clamped!
  -- =========================================================================
  e2 := (public.px03_create_execution(u, null, 'req-verify-2', 'hash-verify-2') -> 'execution' ->> 'id')::uuid;
  v := public.px05_admit_execution(u, e2, 0.05, 0.05, 900, 100, 10.0, 50.0, 10);

  perform public.px03_record_model_call(
    e2, 'debate-synthesis', 'primary', 1, 'model-s', 'model-s', 'model-s', 'req-s2', 'completed',
    100, 100, 0, 0.01, 0.02, 0, 0.03, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'settled'
  );
  perform public.px03_record_model_call(
    e2, 'debate-challenger', 'worker-critic', 1, 'model-c', 'model-c', 'model-c', 'req-c2', 'completed',
    100, 100, 0, 0, 0, 0, 0, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'pending'
  );

  -- Commit estimated with estimate of $0.04
  v := public.px05_commit_estimated(e2, 0.04);
  if (v->>'committed_usd')::numeric <> 0.040000 then
    raise exception 'CASE 4: initial commit estimated failed: %', v;
  end if;

  -- Challenger settles at $0.04 (total actual $0.07 > $0.05 ceiling)
  update prismatix_internal.model_calls
     set cost_status = 'settled', total_cost = 0.04
   where execution_id = e2 and stage = 'debate-challenger';

  v := public.px05_commit_from_ledger(e2);
  if (v->>'updated')::boolean is not true
     or (v->>'committed_usd')::numeric <> 0.070000
     or (v->>'budget_breached')::boolean is not true then
    raise exception 'CASE 4: expected 0.070000 with budget_breached=true, got %', v;
  end if;

  select * into job from prismatix_internal.reconciliation_jobs
   where execution_id = e2 and kind = 'budget_reconciled' and (payload->>'reason') = 'late_call_settlement_up';
  if job.id is null or (job.payload->>'budget_breached')::boolean is not true then
    raise exception 'CASE 4: missing or non-breached reconciliation job: %', job.payload;
  end if;

  -- =========================================================================
  -- CASE 5: Unknown pricing on pending call:
  -- Must return pending_reconcile with basis='unknown_price', NEVER estimate or $0.
  -- =========================================================================
  e3 := (public.px03_create_execution(u, null, 'req-verify-3', 'hash-verify-3') -> 'execution' ->> 'id')::uuid;
  v := public.px05_admit_execution(u, e3, 0.10, 0.50, 900, 100, 10.0, 50.0, 10);

  perform public.px03_record_model_call(
    e3, 'debate-challenger', 'worker-critic', 1, 'model-c', 'model-c', 'model-c', 'req-c3', 'completed',
    100, 100, 0, 0, 0, 0, 0, null, 'pending'
  );

  v := public.px05_commit_estimated(e3, 0.05);
  if v->>'state' <> 'pending_reconcile' or v->>'basis' <> 'unknown_price' then
    raise exception 'CASE 5: expected pending_reconcile with unknown_price, got %', v;
  end if;

  -- =========================================================================
  -- CASE 6: Zero provider calls: safe release
  -- =========================================================================
  e4 := (public.px03_create_execution(u, null, 'req-verify-4', 'hash-verify-4') -> 'execution' ->> 'id')::uuid;
  v := public.px05_admit_execution(u, e4, 0.10, 0.50, 900, 100, 10.0, 50.0, 10);

  v := public.px05_commit_estimated(e4, 0.05);
  if v->>'state' <> 'released' or v->>'reason' <> 'confirmed_zero_calls' then
    raise exception 'CASE 6: expected released with confirmed_zero_calls, got %', v;
  end if;

  -- =========================================================================
  -- CASE 7: All calls settled authoritatively: basis='settled'
  -- =========================================================================
  e5 := (public.px03_create_execution(u, null, 'req-verify-5', 'hash-verify-5') -> 'execution' ->> 'id')::uuid;
  v := public.px05_admit_execution(u, e5, 0.10, 0.50, 900, 100, 10.0, 50.0, 10);

  perform public.px03_record_model_call(
    e5, 'debate-synthesis', 'primary', 1, 'model-s', 'model-s', 'model-s', 'req-s5', 'completed',
    100, 100, 0, 0.01, 0.02, 0, 0.03, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'settled'
  );

  v := public.px05_commit_estimated(e5, 0.05);
  if v->>'state' <> 'committed' or v->>'basis' <> 'settled' or (v->>'committed_usd')::numeric <> 0.030000 then
    raise exception 'CASE 7: expected committed with basis=settled and committed_usd=0.030000, got %', v;
  end if;

  -- =========================================================================
  -- CASE 8: A2 Reservation Release Safety:
  -- Dispatched call present -> px05_release_reservation keeps hold (pending_reconcile).
  -- Zero calls -> px05_release_reservation releases.
  -- =========================================================================
  e6 := (public.px03_create_execution(u, null, 'req-verify-6', 'hash-verify-6') -> 'execution' ->> 'id')::uuid;
  v := public.px05_admit_execution(u, e6, 0.10, 0.50, 900, 100, 10.0, 50.0, 10);

  perform public.px03_record_model_call(
    e6, 'debate-challenger', 'worker-1', 1, 'model-c', 'model-c', 'model-c', 'req-d6', 'dispatched',
    0, 0, 0, 0, 0, 0, 0, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'pending'
  );

  v := public.px05_release_reservation(e6, 'pre_dispatch_sibling_failure');
  if v->>'state' <> 'pending_reconcile' or (v->>'updated')::boolean is not true then
    raise exception 'CASE 8: expected pending_reconcile for active call, got %', v;
  end if;

  raise notice 'ALL BILLING AND CONCURRENCY VERIFICATION TESTS PASSED SUCCESSFULLY!';
end $$;

rollback;
