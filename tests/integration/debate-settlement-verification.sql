-- tests/integration/debate-settlement-verification.sql
-- Integration test verifying Priority A1 & A2 database protections.
-- 1. A1 Premature Settlement:
--    - When pending calls exist, px05_commit_estimated includes the estimated pending amount
--      rather than committing only settled calls as 'settled'.
--    - When actual settled total exceeds estimated committed amount, px05_commit_from_ledger
--      successfully trues up the reservation and window totals.
-- 2. A2 Reservation Release Safety:
--    - When calls have been recorded/dispatched in model_calls, px05_release_reservation
--      refuses release and marks the reservation as 'pending_reconcile'.
--    - When 0 calls were dispatched, px05_release_reservation safely releases the reservation.

begin;

do $$
declare
  u uuid := 'c0000000-0000-4000-8000-000000000002';
  e1 uuid;
  e2 uuid;
  e3 uuid;
  v jsonb;
  res prismatix_internal.budget_reservations;
  win prismatix_internal.budget_windows;
  job prismatix_internal.reconciliation_jobs;
begin
  insert into auth.users (id) values (u) on conflict (id) do nothing;

  -- =========================================================================
  -- TEST 1: A1 px05_commit_estimated with pending calls preserves pending work
  -- =========================================================================
  e1 := (public.px03_create_execution(u, null, 'req-verify-1', 'hash-verify-1') -> 'execution' ->> 'id')::uuid;
  v := public.px05_admit_execution(u, e1, 0.10, 0.50, 900, 100, 10.0, 50.0, 10);
  if (v->>'admitted')::boolean is not true then
    raise exception 'TEST 1: admit failed: %', v;
  end if;

  -- Call 1 (challenger): pending ($0.00 settled so far)
  perform public.px03_record_model_call(
    e1, 'debate-challenger', 'worker-critic', 1, 'model-c', 'model-c', 'model-c', 'req-c', 'completed',
    100, 100, 0, 0, 0, 0, 0, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'pending'
  );

  -- Call 2 (synthesis): settled ($0.03)
  perform public.px03_record_model_call(
    e1, 'debate-synthesis', 'primary', 1, 'model-s', 'model-s', 'model-s', 'req-s', 'completed',
    100, 100, 0, 0.01, 0.02, 0, 0.03, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'settled'
  );

  -- Simulating premature completion with $0.01 pending estimate
  v := public.px05_commit_estimated(e1, 0.01);
  if v->>'basis' <> 'estimated' or (v->>'committed_usd')::numeric <> 0.040000 then
    raise exception 'TEST 1: expected basis=estimated and committed_usd=0.040000, got %', v;
  end if;

  -- Check reconciliation job was logged
  select * into job from prismatix_internal.reconciliation_jobs where execution_id = e1 and kind = 'budget_estimated';
  if job.id is null or (job.payload->>'provenance') <> 'estimated_partial_provider_usage' then
    raise exception 'TEST 1: missing or invalid reconciliation job for estimated commit: %', job.payload;
  end if;

  -- Now challenger finishes and settles at $0.03 (so total actual is $0.06 > $0.04 committed)
  update prismatix_internal.model_calls
     set cost_status = 'settled', total_cost = 0.03
   where execution_id = e1 and stage = 'debate-challenger';

  -- px05_commit_from_ledger must true up the additional $0.02!
  v := public.px05_commit_from_ledger(e1);
  if (v->>'updated')::boolean is not true or (v->>'committed_usd')::numeric <> 0.060000 then
    raise exception 'TEST 1: expected true-up to 0.060000 with updated=true, got %', v;
  end if;

  select * into res from prismatix_internal.budget_reservations where execution_id = e1;
  if res.committed_usd <> 0.060000 then
    raise exception 'TEST 1: reservation committed_usd was not trued up to 0.060000: %', res.committed_usd;
  end if;

  select * into win from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u and window_start = date_trunc('day', now());
  if win.committed_usd <> 0.060000 then
    raise exception 'TEST 1: window committed_usd was not trued up to 0.060000: %', win.committed_usd;
  end if;

  -- =========================================================================
  -- TEST 2: A2 px05_release_reservation with dispatched calls guards against release
  -- =========================================================================
  e2 := (public.px03_create_execution(u, null, 'req-verify-2', 'hash-verify-2') -> 'execution' ->> 'id')::uuid;
  v := public.px05_admit_execution(u, e2, 0.10, 0.50, 900, 100, 10.0, 50.0, 10);

  -- Worker 1 was dispatched
  perform public.px03_record_model_call(
    e2, 'debate-challenger', 'worker-1', 1, 'model-c', 'model-c', 'model-c', 'req-1', 'dispatched',
    0, 0, 0, 0, 0, 0, 0, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'pending'
  );

  -- Pre-dispatch failure on worker 2 attempts release
  v := public.px05_release_reservation(e2, 'pre_dispatch_accounting_failure');
  if v->>'state' <> 'pending_reconcile' or (v->>'updated')::boolean is not true then
    raise exception 'TEST 2: expected pending_reconcile, got %', v;
  end if;

  select * into res from prismatix_internal.budget_reservations where execution_id = e2;
  if res.state <> 'pending_reconcile' then
    raise exception 'TEST 2: reservation state expected pending_reconcile, got %', res.state;
  end if;

  -- =========================================================================
  -- TEST 3: A2 px05_release_reservation with 0 calls safely releases
  -- =========================================================================
  e3 := (public.px03_create_execution(u, null, 'req-verify-3', 'hash-verify-3') -> 'execution' ->> 'id')::uuid;
  v := public.px05_admit_execution(u, e3, 0.10, 0.50, 900, 100, 10.0, 50.0, 10);

  -- No calls recorded, safe release before dispatch
  v := public.px05_release_reservation(e3, 'pre_flight_rejected');
  if v->>'state' <> 'released' or (v->>'updated')::boolean is not true then
    raise exception 'TEST 3: expected released, got %', v;
  end if;

  select * into res from prismatix_internal.budget_reservations where execution_id = e3;
  if res.state <> 'released' then
    raise exception 'TEST 3: reservation state expected released, got %', res.state;
  end if;

  raise notice 'ALL VERIFICATION TESTS PASSED SUCCESSFULLY!';
end $$;

rollback;
