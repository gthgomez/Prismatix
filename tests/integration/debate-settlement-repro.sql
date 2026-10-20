-- tests/integration/debate-settlement-repro.sql
-- Reproduction test for Priority A1: Premature settlement omission in px05_commit_estimated.
--
-- Scenario:
-- 1. An execution is admitted ($0.50 reserved).
-- 2. Call 1 (challenger) is in flight / pending with a known price snapshot ($0.00 settled so far).
-- 3. Call 2 (synthesis) completes and settles at $0.03.
-- 4. A completion attempt invokes px05_commit_estimated(execution_id, 0.05).
-- 5. Under the unpatched px05_commit_estimated:
--    - It checks `if v_settled > 0` before checking `v_pending > 0`.
--    - It commits ONLY the settled synthesis call ($0.03).
--    - It transitions the reservation state to 'committed' and releases the budget hold.
-- 6. Later, Call 1 (challenger) finishes and settles at $0.02. Total actual cost should be $0.05.
-- 7. Any subsequent px05_commit_from_ledger fails with updated=false because the reservation
--    is already in terminal state 'committed'.
--    Result: The $0.02 challenger cost is SILENTLY OMITTED from user and project committed totals!

begin;

do $$
declare
  u uuid := 'c0000000-0000-4000-8000-000000000001';
  e uuid;
  v jsonb;
  res prismatix_internal.budget_reservations;
  win prismatix_internal.budget_windows;
begin
  insert into auth.users (id) values (u) on conflict (id) do nothing;

  -- 1) Create execution
  e := (public.px03_create_execution(u, null, 'req-repro-1', 'hash-repro-1') -> 'execution' ->> 'id')::uuid;

  -- 2) Admit execution (max $0.50)
  v := public.px05_admit_execution(u, e, 0.10, 0.50, 900, 100, 10.0, 50.0, 10);
  if (v->>'admitted')::boolean is not true then
    raise exception 'admit failed: %', v;
  end if;

  -- 3) Record Call 1 (challenger - pending with price snapshot)
  perform public.px03_record_model_call(
    e, 'debate-challenger', 'worker-critic', 1, 'model-c', 'model-c', 'model-c', 'req-c', 'completed',
    100, 100, 0, 0, 0, 0, 0, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'pending'
  );

  -- 4) Record Call 2 (synthesis - settled with $0.03)
  perform public.px03_record_model_call(
    e, 'debate-synthesis', 'primary', 1, 'model-s', 'model-s', 'model-s', 'req-s', 'completed',
    100, 100, 0, 0.01, 0.02, 0, 0.03, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'settled'
  );

  -- 5) Call px05_commit_estimated (simulating premature completion)
  v := public.px05_commit_estimated(e, 0.05);
  raise notice 'REPRO STEP 5 px05_commit_estimated: %', v;

  -- 6) Challenger settles afterward ($0.02)
  update prismatix_internal.model_calls
     set cost_status = 'settled', total_cost = 0.02
   where execution_id = e and stage = 'debate-challenger';

  -- 7) Attempt to settle via ledger afterward
  v := public.px05_commit_from_ledger(e);
  raise notice 'REPRO STEP 7 px05_commit_from_ledger: %', v;

  -- Inspect reservation
  select * into res from prismatix_internal.budget_reservations where execution_id = e;
  raise notice 'REPRO FINAL reservation state: %, committed_usd: %', res.state, res.committed_usd;

  -- Inspect user window
  select * into win from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u and window_start = date_trunc('day', now());
  raise notice 'REPRO FINAL user window committed_usd: %, held_usd: %', win.committed_usd, win.held_usd;

  -- CONFIRM THE DEFECT:
  -- The reservation committed only 0.03 instead of 0.05, and Step 7 returned updated=false!
  if res.committed_usd = 0.03 and (v->>'updated')::boolean is false then
    raise notice 'CONFIRMED DEFECT A1: px05_commit_estimated prematurely committed only 0.03, dropping 0.02 challenger cost!';
  end if;

  -- =========================================================================
  -- A2 REPRO: Releasing a reservation after a call was already dispatched
  -- =========================================================================
  e := (public.px03_create_execution(u, null, 'req-repro-2', 'hash-repro-2') -> 'execution' ->> 'id')::uuid;
  v := public.px05_admit_execution(u, e, 0.10, 0.50, 900, 100, 10.0, 50.0, 10);

  -- Worker 1 was pre-dispatched and sent
  perform public.px03_record_model_call(
    e, 'debate-challenger', 'worker-1', 1, 'model-c', 'model-c', 'model-c', 'req-1', 'dispatched',
    0, 0, 0, 0, 0, 0, 0, '{"inputRatePer1M":1, "outputRatePer1M":2}'::jsonb, 'pending'
  );

  -- Worker 2 had a pre-dispatch error, triggering releaseReservation
  v := public.px05_release_reservation(e, 'pre_dispatch_accounting_failure');
  raise notice 'REPRO A2 px05_release_reservation result: %', v;

  select * into res from prismatix_internal.budget_reservations where execution_id = e;
  raise notice 'REPRO A2 reservation state: %', res.state;

  if res.state = 'released' then
    raise notice 'CONFIRMED DEFECT A2: px05_release_reservation released reservation despite existing dispatched call!';
  end if;
end $$;

rollback;

