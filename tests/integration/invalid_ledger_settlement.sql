-- PX13: malformed historical model-call costs cannot settle reservations.
-- Run only in a disposable UTF8 database with migrations through
-- 20261121140122 applied. Seed legacy rows, apply PX13 inside this transaction,
-- assert that holds/windows are preserved, then roll back. Never run on
-- production or shared staging.
\set ON_ERROR_STOP on
begin;

-- These rows predate the PX13 NOT VALID checks, modeling deployed legacy data.
do $$
declare
  users uuid[] := array[
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
  ];
  execution_id uuid;
  result jsonb;
  i integer;
begin
  for i in 1..7 loop
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (users[i], 'authenticated', 'authenticated', 'px13-' || i || '@example.invalid', 'unused', now(), now());

    execution_id := (public.px03_create_execution(
      users[i], null, 'px13-legacy-' || i, 'px13-hash-' || i
    )->'execution'->>'id')::uuid;
    perform set_config('px13.exec_' || i, execution_id::text, true);
    result := public.px05_admit_execution(users[i], execution_id, 0.25, 1, 900, 1000, 100, 1000, 10);
    if (result->>'admitted')::boolean is not true then
      raise exception 'PX13 setup admission % failed: %', i, result;
    end if;

    if i = 1 then
      perform public.px03_record_model_call(execution_id, 'primary', 'fixture', 1, null, null, null, null, 'completed', 1, 1, 0, 0, 0, 0, 'NaN'::numeric, null, 'settled');
    elsif i = 2 then
      perform public.px03_record_model_call(execution_id, 'primary', 'fixture', 1, null, null, null, null, 'completed', 1, 1, 0, 0, 0, 0, -0.01, null, 'settled');
    elsif i = 3 then
      perform public.px03_record_model_call(execution_id, 'primary', 'fixture', 1, null, null, null, null, 'completed', 1, 1, 0, 0, 0, 0, 0.10, null, 'settled');
      perform public.px03_record_model_call(execution_id, 'fallback', 'fixture', 2, null, null, null, null, 'completed', 1, 1, 0, 0, 0, 0, 'NaN'::numeric, null, 'settled');
    elsif i = 4 then
      perform public.px03_record_model_call(execution_id, 'primary', 'fixture', 1, null, null, null, null, 'completed', 1, 1, 0, 0, 0, 0, 0.10, null, 'settled');
      result := public.px05_commit_from_ledger(execution_id);
      if result->>'state' <> 'committed' or (result->>'committed_usd')::numeric <> 0.10 then
        raise exception 'PX13 setup late-settlement seed failed: %', result;
      end if;
      -- A late invalid settled row exercises true-up of an already-committed reservation.
      perform public.px03_record_model_call(execution_id, 'late', 'fixture', 2, null, null, null, null, 'completed', 1, 1, 0, 0, 0, 0, -0.01, null, 'settled');
    elsif i = 5 then
      perform public.px03_record_model_call(execution_id, 'primary', 'fixture', 1, null, null, null, null, 'completed', 0, 0, 0, 0, 0, 0, 0, null, 'settled');
    elsif i = 6 then
      perform public.px03_record_model_call(execution_id, 'primary', 'fixture', 1, null, null, null, null, 'completed', 1, 1, 0, 0, 0, 0, 0.25, null, 'settled');
    else
      perform public.px03_record_model_call(execution_id, 'primary', 'fixture', 1, null, null, null, null, 'completed', 1, 1, 0, 0, 0, 0, 0.05, null, 'settled');
      result := public.px05_commit_from_ledger(execution_id);
      if result->>'state' <> 'committed' or (result->>'committed_usd')::numeric <> 0.05 then
        raise exception 'PX13 setup reservation-amount seed failed: %', result;
      end if;
    end if;
  end loop;

  -- Simulate corruption left by the prior NaN/negative settlement bug. These
  -- updates occur before PX13 so NOT VALID constraints preserve the rows while
  -- preventing later budget arithmetic from treating them as usable.
  update prismatix_internal.budget_windows
     set committed_usd = -0.01
   where scope = 'user'
     and subject_id = (select subject_id from prismatix_internal.budget_reservations br where br.execution_id = current_setting('px13.exec_1')::uuid)
     and window_start = date_trunc('day', now());
  update prismatix_internal.budget_windows
     set committed_usd = 'NaN'::numeric
   where scope = 'user'
     and subject_id = (select subject_id from prismatix_internal.budget_reservations br where br.execution_id = current_setting('px13.exec_2')::uuid)
     and window_start = date_trunc('day', now());
  update prismatix_internal.budget_windows
     set held_usd = -0.01
   where scope = 'user'
     and subject_id = (select subject_id from prismatix_internal.budget_reservations br where br.execution_id = current_setting('px13.exec_3')::uuid)
     and window_start = date_trunc('day', now());
  update prismatix_internal.budget_windows
     set held_usd = -0.01
   where scope = 'project'
     and window_start = date_trunc('day', now());

  -- A committed legacy reservation with invalid amount must also be preserved
  -- but become unmodifiable until an operator reconciles it.
  update prismatix_internal.budget_reservations br
     set amount_usd = 'NaN'::numeric
   where br.execution_id = current_setting('px13.exec_7')::uuid;
end;
$$;

\i supabase/migrations/20261121220000_px13_budget_settlement_cost_guards.sql

set local role service_role;
do $$
declare
  v_exec uuid;
  v_result jsonb;
  v_held numeric;
  v_committed numeric;
  v_state text;
  v_message text;
  v_constraint text;
  v_bad numeric;
  v_subject uuid;
  v_window_value numeric;
  v_expected_held text;
  v_expected_committed text;
  v_call jsonb;
  v_attempt integer := 3;
  v_i integer;
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'model_calls_total_cost_nonnegative_finite_ck'
      and conrelid = 'prismatix_internal.model_calls'::regclass
      and not convalidated
  ) then
    raise exception 'PX13 FAIL: model-call cost constraint is missing or was validated destructively';
  end if;
  if (select count(*) from pg_constraint
       where conname in (
         'budget_reservations_committed_usd_nonnegative_finite_ck',
         'budget_reservations_amount_usd_nonnegative_finite_ck',
         'budget_windows_limit_usd_nonnegative_finite_ck',
         'budget_windows_committed_usd_nonnegative_finite_ck',
         'budget_windows_held_usd_nonnegative_finite_ck'
       ) and not convalidated) <> 5 then
    raise exception 'PX13 FAIL: all reservation/window guards must be installed NOT VALID';
  end if;
  if not has_function_privilege('service_role', 'public.px05_commit_from_ledger(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.px05_commit_estimated(uuid, numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.px05_commit_from_ledger(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.px05_commit_from_ledger(uuid)', 'EXECUTE') then
    raise exception 'PX13 FAIL: budget settlement RPC role grants changed';
  end if;
  if has_function_privilege('public', 'prismatix_internal.guard_invalid_budget_settlement()', 'EXECUTE')
     or has_function_privilege('anon', 'prismatix_internal.guard_invalid_budget_settlement()', 'EXECUTE')
     or has_function_privilege('authenticated', 'prismatix_internal.guard_invalid_budget_settlement()', 'EXECUTE') then
    raise exception 'PX13 FAIL: settlement trigger function is client-executable';
  end if;

  -- Corrupt project held state must abort before creating a reservation; the
  -- original amount remains untouched for manual reconciliation.
  v_subject := (select subject_id from prismatix_internal.budget_reservations br where br.execution_id = current_setting('px13.exec_1')::uuid);
  v_result := public.px03_create_execution(v_subject, null, 'px13-project-window-check', 'px13-project-window-hash');
  v_exec := (v_result->'execution'->>'id')::uuid;
  begin
    perform public.px05_admit_execution(v_subject, v_exec, 0.25, 0, 900, 1000, 100, 1000, 10);
    raise exception 'PX13 FAIL: admission used a negative project hold';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'budget_windows_held_usd_nonnegative_finite_ck' then raise; end if;
  end;
  select held_usd into v_window_value from prismatix_internal.budget_windows where scope = 'project' and window_start = date_trunc('day', now());
  if v_window_value <> -0.01 or exists (select 1 from prismatix_internal.budget_reservations where execution_id = v_exec) then
    raise exception 'PX13 FAIL: blocked project-window admission changed balance or created reservation';
  end if;

  -- Repair only the synthetic project fixture value inside this outer rollback
  -- so user-window guards can be independently exercised.
  update prismatix_internal.budget_windows
     set held_usd = 6
   where scope = 'project' and window_start = date_trunc('day', now());
  for v_i in 1..3 loop
    v_subject := (select subject_id from prismatix_internal.budget_reservations br where br.execution_id = current_setting('px13.exec_' || v_i)::uuid);
    v_result := public.px03_create_execution(v_subject, null, 'px13-user-window-check-' || v_i, 'px13-user-window-hash-' || v_i);
    v_exec := (v_result->'execution'->>'id')::uuid;
    begin
      perform public.px05_admit_execution(v_subject, v_exec, 0.25, 0, 900, 1000, 100, 1000, 10);
      raise exception 'PX13 FAIL: admission used a corrupt user window %', v_i;
    exception when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if (v_i = 1 and v_constraint <> 'budget_windows_committed_usd_nonnegative_finite_ck')
         or (v_i = 2 and v_constraint <> 'budget_windows_committed_usd_nonnegative_finite_ck')
         or (v_i = 3 and v_constraint <> 'budget_windows_held_usd_nonnegative_finite_ck') then raise; end if;
    end;
    if exists (select 1 from prismatix_internal.budget_reservations where execution_id = v_exec) then
      raise exception 'PX13 FAIL: blocked user-window admission created reservation %', v_i;
    end if;
  end loop;
  select committed_usd into v_window_value from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = (select subject_id from prismatix_internal.budget_reservations br where br.execution_id = current_setting('px13.exec_1')::uuid)
     and window_start = date_trunc('day', now());
  if v_window_value <> -0.01 then raise exception 'PX13 FAIL: failed admission changed legacy negative user committed balance'; end if;
  select committed_usd into v_window_value from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = (select subject_id from prismatix_internal.budget_reservations br where br.execution_id = current_setting('px13.exec_2')::uuid)
     and window_start = date_trunc('day', now());
  if v_window_value::text <> 'NaN' then raise exception 'PX13 FAIL: failed admission changed legacy NaN user committed balance'; end if;
  select held_usd into v_window_value from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = (select subject_id from prismatix_internal.budget_reservations br where br.execution_id = current_setting('px13.exec_3')::uuid)
     and window_start = date_trunc('day', now());
  if v_window_value <> -0.01 then raise exception 'PX13 FAIL: failed admission changed legacy negative user hold'; end if;

  -- New invalid reservation amounts and updates to corrupt legacy amounts are
  -- rejected, while existing rows/balances remain available for inspection.
  begin
    insert into prismatix_internal.budget_reservations(execution_id, subject_id, amount_usd, committed_usd, state)
    values (gen_random_uuid(), v_subject, -0.01, 0, 'held');
    raise exception 'PX13 FAIL: negative reservation amount was accepted';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'budget_reservations_amount_usd_nonnegative_finite_ck' then raise; end if;
  end;
  begin
    update prismatix_internal.budget_reservations set updated_at = now()
     where execution_id = current_setting('px13.exec_7')::uuid;
    raise exception 'PX13 FAIL: invalid legacy reservation amount was treated as usable';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'budget_reservations_amount_usd_nonnegative_finite_ck' then raise; end if;
  end;
  if (select amount_usd::text from prismatix_internal.budget_reservations where execution_id = current_setting('px13.exec_7')::uuid) <> 'NaN'
     or (select state from prismatix_internal.budget_reservations where execution_id = current_setting('px13.exec_7')::uuid) <> 'committed' then
    raise exception 'PX13 FAIL: failed legacy reservation update changed its stored values';
  end if;

  -- New NaN/negative writes fail under the NOT VALID constraint.
  v_exec := current_setting('px13.exec_5')::uuid;
  foreach v_bad in array array['NaN'::numeric, -0.01::numeric] loop
    begin
      perform public.px03_record_model_call(v_exec, 'new-invalid', 'fixture', v_attempt, null, null, null, null, 'completed', 1, 1, 0, 0, 0, 0, v_bad, null, 'settled');
      raise exception 'PX13 FAIL: new invalid model-call amount % was accepted', v_bad;
    exception when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'model_calls_total_cost_nonnegative_finite_ck' then raise; end if;
    end;
    v_attempt := v_attempt + 1;
  end loop;

  begin
    update prismatix_internal.budget_reservations
       set committed_usd = 'NaN'::numeric
     where execution_id = current_setting('px13.exec_5')::uuid;
    raise exception 'PX13 FAIL: invalid reservation committed amount was accepted';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'budget_reservations_committed_usd_nonnegative_finite_ck' then raise; end if;
  end;

  -- Held NaN, negative and mixed valid/invalid legacy costs stay held after
  -- either ledger-sum or estimate settlement fails atomically.
  for v_i in 1..3 loop
    v_exec := current_setting('px13.exec_' || v_i)::uuid;
    begin
      perform public.px05_commit_from_ledger(v_exec);
      raise exception 'PX13 FAIL: invalid legacy call costs committed through ledger';
    exception when check_violation then
      get stacked diagnostics v_message = message_text, v_constraint = constraint_name;
      if v_message <> 'invalid_settled_model_call_cost'
         and v_constraint not in (
           'budget_windows_committed_usd_nonnegative_finite_ck',
           'budget_windows_held_usd_nonnegative_finite_ck'
         ) then raise; end if;
    end;
    select state into v_state from prismatix_internal.budget_reservations where execution_id = v_exec;
    select held_usd, committed_usd into v_held, v_committed
      from prismatix_internal.budget_windows
     where scope = 'user'
       and subject_id = (select subject_id from prismatix_internal.budget_reservations where execution_id = v_exec)
       and window_start = date_trunc('day', now());
    v_expected_held := case when v_i = 3 then '-0.010000' else '1.000000' end;
    v_expected_committed := case when v_i = 1 then '-0.010000' when v_i = 2 then 'NaN' else '0.000000' end;
    if v_state <> 'held' or v_held::text <> v_expected_held or v_committed::text <> v_expected_committed then
      raise exception 'PX13 FAIL: failed settlement changed hold/window for % (state %, held %, committed %)', v_exec, v_state, v_held, v_committed;
    end if;
  end loop;

  begin
    perform public.px05_commit_estimated(current_setting('px13.exec_2')::uuid, 0.25);
    raise exception 'PX13 FAIL: invalid legacy call costs committed through estimate';
  exception when check_violation then
    get stacked diagnostics v_message = message_text, v_constraint = constraint_name;
    if v_message <> 'invalid_settled_model_call_cost'
       and v_constraint not in (
         'budget_windows_committed_usd_nonnegative_finite_ck',
         'budget_windows_held_usd_nonnegative_finite_ck'
       ) then raise; end if;
  end;

  -- A release attempt cannot forgive an invalid settled call.
  v_result := public.px05_release_reservation(current_setting('px13.exec_1')::uuid, 'test');
  if v_result->>'state' <> 'pending_reconcile' or v_result->>'updated' <> 'true' then
    raise exception 'PX13 FAIL: release did not preserve dispatched work in pending_reconcile: %', v_result;
  end if;
  select held_usd into v_held from prismatix_internal.budget_windows
   where scope = 'user'
     and subject_id = (select subject_id from prismatix_internal.budget_reservations br where br.execution_id = current_setting('px13.exec_1')::uuid)
     and window_start = date_trunc('day', now());
  if v_held <> 1 then raise exception 'PX13 FAIL: invalid release changed held amount to %', v_held; end if;

  -- A late invalid call cannot true-up an already-committed reservation/window.
  begin
    perform public.px05_commit_from_ledger(current_setting('px13.exec_4')::uuid);
    raise exception 'PX13 FAIL: late invalid call changed an already-committed reservation';
  exception when check_violation then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'invalid_settled_model_call_cost' then raise; end if;
  end;
  select state, committed_usd into v_state, v_committed
    from prismatix_internal.budget_reservations br where br.execution_id = current_setting('px13.exec_4')::uuid;
  select committed_usd into v_held from prismatix_internal.budget_windows
   where scope = 'user'
     and subject_id = (select subject_id from prismatix_internal.budget_reservations br where br.execution_id = current_setting('px13.exec_4')::uuid)
     and window_start = date_trunc('day', now());
  if v_state <> 'committed' or v_committed <> 0.10 or v_held <> 0.10 then
    raise exception 'PX13 FAIL: late invalid call changed committed ledger/window (state %, reservation %, window %)', v_state, v_committed, v_held;
  end if;

  -- Valid committed zero and positive settlements remain accepted.
  v_result := public.px05_commit_from_ledger(current_setting('px13.exec_5')::uuid);
  if v_result->>'state' <> 'committed' or (v_result->>'committed_usd')::numeric <> 0 then
    raise exception 'PX13 FAIL: valid zero settlement was rejected: %', v_result;
  end if;
  v_result := public.px05_commit_estimated(current_setting('px13.exec_6')::uuid, 0.25);
  if v_result->>'state' <> 'committed' or (v_result->>'committed_usd')::numeric <> 0.25 then
    raise exception 'PX13 FAIL: valid positive settlement was rejected: %', v_result;
  end if;

  -- An omitted or explicit NULL amount is a pending placeholder only. It may
  -- not be promoted to confirmed settled $0; explicit settled zero is valid.
  v_exec := current_setting('px13.exec_5')::uuid;
  v_call := public.px03_record_model_call(
    p_execution_id => v_exec, p_stage => 'pending-omitted',
    p_participant => 'fixture', p_cost_status => 'pending'
  );
  if v_call->>'cost_status' <> 'pending' or (v_call->>'total_cost')::numeric <> 0 then
    raise exception 'PX13 FAIL: omitted pending amount did not remain a zero placeholder: %', v_call;
  end if;
  begin
    perform public.px03_record_model_call(
      p_execution_id => v_exec, p_stage => 'settled-omitted',
      p_participant => 'fixture', p_cost_status => 'settled'
    );
    raise exception 'PX13 FAIL: omitted settled amount was accepted as zero';
  exception when sqlstate '22023' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'settled_model_call_cost_required' then raise; end if;
  end;
  begin
    perform public.px03_record_model_call(
      p_execution_id => v_exec, p_stage => 'settled-null',
      p_participant => 'fixture', p_total_cost => null,
      p_cost_status => 'settled'
    );
    raise exception 'PX13 FAIL: NULL settled amount was accepted as zero';
  exception when sqlstate '22023' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'settled_model_call_cost_required' then raise; end if;
  end;
  v_call := public.px03_record_model_call(
    p_execution_id => v_exec, p_stage => 'settled-explicit-zero',
    p_participant => 'fixture', p_total_cost => 0,
    p_cost_status => 'settled'
  );
  if v_call->>'cost_status' <> 'settled' or (v_call->>'total_cost')::numeric <> 0 then
    raise exception 'PX13 FAIL: explicit settled zero was rejected: %', v_call;
  end if;
end;
$$;
reset role;

set local role authenticated;
do $$
begin
  begin
    perform public.px05_commit_from_ledger(current_setting('px13.exec_1')::uuid);
    raise exception 'PX13 FAIL: authenticated executed budget settlement';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.px05_commit_from_ledger(current_setting('px13.exec_1')::uuid);
    raise exception 'PX13 FAIL: anon executed budget settlement';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;

\echo 'tests/integration/invalid_ledger_settlement.sql: PASS (invalid ledger/window values failed closed; omitted/null settled costs rejected; valid zero/positive settled)'
