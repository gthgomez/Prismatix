-- Deterministic two-session regression for the PX05 admission/settlement race.
--
-- Run only against an isolated, disposable, fully migrated local Supabase DB:
--   supabase start && supabase db reset
--   psql "$LOCAL_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f tests/integration/px05-admission-settlement-lock-order.sql
-- To verify the missing-admission-barrier negative control, set
-- px05.test_disable_admission_barrier=on before running; the script must fail.
--
-- The test inserts a trigger barrier after admission has locked the daily
-- budget windows. It starts ledger settlement while admission is paused, waits
-- until the second session is blocked, then releases the barrier. This forces
-- the conflicting lock order without relying on timing guesses. On failure the
-- script restores the shared project window and removes all test fixtures.

\set ON_ERROR_STOP on

create extension if not exists dblink;

create temp table px05_lock_order_project_snapshot on commit preserve rows as
select *
from prismatix_internal.budget_windows
where scope = 'project'
  and subject_id = '00000000-0000-0000-0000-000000000000'
  and window_start = date_trunc('day', now());

create temp table px05_lock_order_case on commit preserve rows as
select
  gen_random_uuid() as subject_id,
  gen_random_uuid() as old_execution_id,
  gen_random_uuid() as new_execution_id,
  gen_random_uuid() as unknown_execution_id;

create temp table px05_lock_order_result (
  passed boolean not null,
  detail text not null
) on commit preserve rows;

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
select subject_id, 'authenticated', 'authenticated', subject_id::text || '@px05.invalid', 'x', now(), now()
from px05_lock_order_case;

insert into prismatix_internal.executions
  (id, subject_id, client_request_key, payload_hash, status)
select old_execution_id, subject_id, 'px05-lock-old-' || old_execution_id::text, 'old-hash', 'completed'
from px05_lock_order_case
union all
select new_execution_id, subject_id, 'px05-lock-new-' || new_execution_id::text, 'new-hash', 'started'
from px05_lock_order_case
union all
select unknown_execution_id, subject_id, 'px05-lock-unknown-' || unknown_execution_id::text, 'unknown-hash', 'completed'
from px05_lock_order_case;

insert into prismatix_internal.budget_windows
  (scope, subject_id, window_start, window_end, limit_usd, committed_usd, held_usd)
values
  ('project', '00000000-0000-0000-0000-000000000000', date_trunc('day', now()),
   date_trunc('day', now()) + interval '1 day', 100, 0, 0.08)
on conflict (scope, subject_id, window_start)
do update set limit_usd = excluded.limit_usd,
              committed_usd = 0,
              held_usd = 0.08,
              window_end = excluded.window_end;

insert into prismatix_internal.budget_windows
  (scope, subject_id, window_start, window_end, limit_usd, committed_usd, held_usd)
select 'user', subject_id, date_trunc('day', now()), date_trunc('day', now()) + interval '1 day', 10, 0, 0.08
from px05_lock_order_case;

insert into prismatix_internal.budget_reservations (execution_id, subject_id, amount_usd, state)
select old_execution_id, subject_id, 0.05, 'held'
from px05_lock_order_case
union all
select unknown_execution_id, subject_id, 0.03, 'held'
from px05_lock_order_case;

insert into prismatix_internal.execution_leases (subject_id, execution_id, expires_at)
select subject_id, old_execution_id, now() - interval '1 minute'
from px05_lock_order_case;

insert into prismatix_internal.model_calls
  (execution_id, stage, participant, attempt_number, status, total_cost, cost_status)
select old_execution_id, 'lock-order-test', 'primary', 1, 'completed', 0.01, 'settled'
from px05_lock_order_case
union all
select unknown_execution_id, 'lock-order-test', 'primary', 1, 'pending', 0, 'pending'
from px05_lock_order_case;

create or replace function public.px05_test_pause_admission()
returns trigger
language plpgsql
as $$
begin
  if current_setting('px05.test_disable_admission_barrier', true) = 'on' then
    return new;
  end if;
  perform pg_advisory_xact_lock(4711, 8811);
  return new;
end;
$$;

drop trigger if exists px05_test_pause_admission on prismatix_internal.admission_requests;
create trigger px05_test_pause_admission
after insert on prismatix_internal.admission_requests
for each row execute function public.px05_test_pause_admission();

do $$
declare
  v_subject uuid;
  v_old_execution uuid;
  v_new_execution uuid;
  v_unknown_execution uuid;
  v_conn text := 'dbname=' || current_database();
  v_admit_sql text;
  v_settle_sql text;
  v_admit_paused boolean := false;
  v_settle_waiting boolean := false;
  v_settle_wait_event text;
  v_admit_result jsonb;
  v_settle_result jsonb;
  v_admit_error text;
  v_settle_error text;
  v_passed boolean := false;
  v_detail text;
  v_state text;
  v_committed numeric;
  v_held numeric;
  v_unknown_state text;
  v_unknown_result jsonb;
  rec record;
  i integer;
begin
  select subject_id, old_execution_id, new_execution_id, unknown_execution_id
    into v_subject, v_old_execution, v_new_execution, v_unknown_execution
  from pg_temp.px05_lock_order_case;

  perform pg_advisory_lock(4711, 8811);

  -- Keep remote work bounded even if a test barrier is broken or a lock cycle
  -- changes. The controller releases the explicit barrier within five seconds.
  begin
    perform dblink_connect('px05_lock_admit', v_conn || ' application_name=px05_lock_admit');
    perform dblink_connect('px05_lock_settle', v_conn || ' application_name=px05_lock_settle');
    perform dblink_exec('px05_lock_admit', 'set statement_timeout = 15000');
    perform dblink_exec('px05_lock_admit', 'set lock_timeout = 10000');
    perform dblink_exec('px05_lock_settle', 'set statement_timeout = 15000');
    perform dblink_exec('px05_lock_settle', 'set lock_timeout = 10000');
    if current_setting('px05.test_disable_admission_barrier', true) = 'on' then
      perform dblink_exec('px05_lock_admit',
        'set px05.test_disable_admission_barrier = on');
    end if;

    v_admit_sql := format(
      'select public.px05_admit_execution(%L::uuid,%L::uuid,0.01,0.05,90,20,10,100,1)',
      v_subject, v_new_execution);
    if dblink_send_query('px05_lock_admit', v_admit_sql) <> 1 then
      v_detail := 'could not start admission session';
    else
      for i in 1..500 loop
        select exists (
          select 1 from pg_stat_activity
          where application_name = 'px05_lock_admit'
            and wait_event_type = 'Lock'
            and wait_event = 'advisory'
            and query like 'select public.px05_admit_execution%'
        ) into v_admit_paused;
        exit when v_admit_paused;
        perform pg_sleep(0.01);
      end loop;
      if not v_admit_paused then
        v_detail := 'admission did not reach the test barrier within five seconds';
      end if;
    end if;

    if v_admit_paused then
      v_settle_sql := format(
        'select public.px05_commit_from_ledger(%L::uuid)', v_old_execution);
      if dblink_send_query('px05_lock_settle', v_settle_sql) <> 1 then
        v_detail := concat_ws('; ', nullif(v_detail, ''), 'could not start settlement session');
      else
        for i in 1..500 loop
          select wait_event into v_settle_wait_event
          from pg_stat_activity
          where application_name = 'px05_lock_settle'
            and wait_event_type = 'Lock'
          limit 1;
          v_settle_waiting := v_settle_wait_event = 'advisory';
          exit when v_settle_waiting;
          perform pg_sleep(0.01);
        end loop;
        if not v_settle_waiting then
          v_detail := concat_ws('; ', nullif(v_detail, ''),
            'settlement did not wait on the subject advisory mutex (wait=' || coalesce(v_settle_wait_event, 'none') || ')');
        end if;
      end if;
    end if;
  exception when others then
    v_detail := concat_ws('; ', nullif(v_detail, ''), 'test orchestration error: ' || sqlerrm);
  end;

  -- Always release the controller barrier before collecting worker results.
  perform pg_advisory_unlock(4711, 8811);

  begin
    for rec in select * from dblink_get_result('px05_lock_admit', false) as t(result jsonb) loop
      v_admit_result := rec.result;
    end loop;
    v_admit_error := dblink_error_message('px05_lock_admit');
  exception when others then
    v_admit_error := 'ERROR: ' || sqlerrm;
  end;
  begin
    for rec in select * from dblink_get_result('px05_lock_settle', false) as t(result jsonb) loop
      v_settle_result := rec.result;
    end loop;
    v_settle_error := dblink_error_message('px05_lock_settle');
  exception when others then
    v_settle_error := 'ERROR: ' || sqlerrm;
  end;
  begin
    perform dblink_disconnect('px05_lock_admit');
  exception when others then
    v_admit_error := concat_ws('; ', nullif(v_admit_error, ''), 'disconnect: ' || sqlerrm);
  end;
  begin
    perform dblink_disconnect('px05_lock_settle');
  exception when others then
    v_settle_error := concat_ws('; ', nullif(v_settle_error, ''), 'disconnect: ' || sqlerrm);
  end;

  drop trigger if exists px05_test_pause_admission on prismatix_internal.admission_requests;
  drop function if exists public.px05_test_pause_admission();

  select state, committed_usd into v_state, v_committed
  from prismatix_internal.budget_reservations
  where execution_id = v_old_execution;
  begin
    v_unknown_result := public.px05_commit_from_ledger(v_unknown_execution);
  exception when others then
    v_detail := concat_ws('; ', nullif(v_detail, ''), 'unknown-usage settlement error: ' || sqlerrm);
  end;
  select state into v_unknown_state
  from prismatix_internal.budget_reservations
  where execution_id = v_unknown_execution;
  select held_usd into v_held
  from prismatix_internal.budget_windows
  where scope = 'user' and subject_id = v_subject and window_start = date_trunc('day', now());

  v_passed := v_admit_paused
    and v_settle_waiting
    and coalesce(v_admit_error, '') not like 'ERROR:%'
    and coalesce(v_settle_error, '') not like 'ERROR:%'
    and (v_admit_result->>'admitted')::boolean is true
    and v_settle_result->>'state' = 'committed'
    and v_state = 'committed'
    and v_committed = 0.01
    and v_unknown_result->>'state' = 'pending_reconcile'
    and v_unknown_state = 'pending_reconcile'
    and v_held = 0.08;

  if v_passed then
    v_detail := 'both barriers observed; concurrent settlement committed actual cost and unknown-cost hold remained pending';
  else
    v_detail := concat_ws('; ', nullif(v_detail, ''),
      'barriers=admission:' || v_admit_paused || ',settlement-advisory:' || v_settle_waiting,
      'admission=' || coalesce(v_admit_result::text, 'no result') || ' (' || coalesce(v_admit_error, '') || ')',
      'settlement=' || coalesce(v_settle_result::text, 'no result') || ' (' || coalesce(v_settle_error, '') || ')',
      'reservation=' || coalesce(v_state, 'missing') || '/' || coalesce(v_committed::text, 'null'),
      'unknown=' || coalesce(v_unknown_result::text, 'no result') || '/' || coalesce(v_unknown_state, 'missing'),
      'user-held=' || coalesce(v_held::text, 'missing'));
  end if;

  delete from prismatix_internal.model_calls
  where execution_id in (v_old_execution, v_new_execution, v_unknown_execution);
  delete from prismatix_internal.budget_reservations
  where execution_id in (v_old_execution, v_new_execution, v_unknown_execution);
  delete from prismatix_internal.execution_leases where subject_id = v_subject;
  delete from prismatix_internal.admission_requests where subject_id = v_subject;
  delete from prismatix_internal.budget_windows where scope = 'user' and subject_id = v_subject;
  delete from prismatix_internal.executions where id in (v_old_execution, v_new_execution, v_unknown_execution);
  delete from auth.users where id = v_subject;

  delete from prismatix_internal.budget_windows
  where scope = 'project'
    and subject_id = '00000000-0000-0000-0000-000000000000'
    and window_start = date_trunc('day', now());
  insert into prismatix_internal.budget_windows
  select * from pg_temp.px05_lock_order_project_snapshot;

  insert into pg_temp.px05_lock_order_result(passed, detail) values (v_passed, v_detail);
end;
$$;

select 'PX05 admission/settlement lock-order regression: ' || case when passed then 'PASS - ' else 'FAIL - ' end || detail
from pg_temp.px05_lock_order_result;

do $$
begin
  if not (select passed from pg_temp.px05_lock_order_result) then
    raise exception 'PX05 admission/settlement lock-order regression failed';
  end if;
end;
$$;
