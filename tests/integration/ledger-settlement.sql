-- tests/integration/ledger-settlement.sql
-- PX03 execution / model-call ledger settlement & isolation assertions.
--
-- Self-contained psql script: everything runs inside ONE transaction and is
-- ROLLED BACK, so no database state is modified. It re-applies the real PX03
-- migration file (idempotent) and then asserts the identity/constraint/RLS
-- behaviour that the execution ledger depends on:
--   * execution identity is (subject_id, client_request_key) bound to a payload
--     hash; reusing a key with a different hash raises request_key_conflict and
--     creates no row;
--   * distinct provider dispatches produce distinct model_calls rows while a
--     duplicate settlement dedupes to one row;
--   * unknown cost stays `pending` (never fabricated `$0`, never `settled`);
--   * the terminal outcome is set exactly once;
--   * reconciliation jobs are durable;
--   * clients cannot read other subjects' ledger rows and cannot write at all;
--     anon is denied; the service-role RPCs are the only write path.
--
-- Prerequisite: a Supabase database with ALL migrations applied (auth schema,
-- prismatix_internal from PX01, public.cost_logs, and the anon/authenticated/
-- service_role roles).
--
-- Run from the REPO ROOT:
--   Local:
--     supabase start && supabase db reset
--     psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--          -v ON_ERROR_STOP=1 -f tests/integration/ledger-settlement.sql
--   Staging (already-migrated schema):
--     psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f tests/integration/ledger-settlement.sql

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: two fresh users.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('px03.user_a', gen_random_uuid()::text, true);
  perform set_config('px03.user_b', gen_random_uuid()::text, true);
end $$;

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  (
    current_setting('px03.user_a')::uuid,
    'authenticated',
    'authenticated',
    'px03-a-' || current_setting('px03.user_a') || '@example.invalid',
    'px03-not-a-real-hash',
    now(),
    now()
  ),
  (
    current_setting('px03.user_b')::uuid,
    'authenticated',
    'authenticated',
    'px03-b-' || current_setting('px03.user_b') || '@example.invalid',
    'px03-not-a-real-hash',
    now(),
    now()
  );

-- ---------------------------------------------------------------------------
-- Apply the REAL migration under test (idempotent; rolled back at the end).
-- ---------------------------------------------------------------------------
\i supabase/migrations/20261006010000_px03_execution_ledger.sql

-- ---------------------------------------------------------------------------
-- 1) Schema / constraint shape.
-- ---------------------------------------------------------------------------
do $$
declare
  n bigint;
begin
  if to_regclass('prismatix_internal.executions') is null
     or to_regclass('prismatix_internal.model_calls') is null
     or to_regclass('prismatix_internal.reconciliation_jobs') is null then
    raise exception 'PX03 FAIL: one or more ledger tables are missing';
  end if;

  -- RLS enabled on all three.
  select count(*) into n
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'prismatix_internal'
    and c.relname in ('executions','model_calls','reconciliation_jobs')
    and c.relrowsecurity;
  if n <> 3 then
    raise exception 'PX03 FAIL: RLS not enabled on all ledger tables (enabled=%)', n;
  end if;

  -- No client write policies exist for anon/authenticated.
  select count(*) into n
  from pg_policies
  where schemaname = 'prismatix_internal'
    and tablename in ('executions','model_calls','reconciliation_jobs')
    and cmd in ('INSERT','UPDATE','DELETE','ALL')
    and roles::text[] && array['public','anon','authenticated']::text[];
  if n <> 0 then
    raise exception 'PX03 FAIL: % client write policies exist on ledger tables', n;
  end if;

  -- cost_status check constraint present.
  select count(*) into n
  from pg_constraint
  where conrelid = 'prismatix_internal.model_calls'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%cost_status%';
  if n < 1 then
    raise exception 'PX03 FAIL: model_calls cost_status check constraint missing';
  end if;

  -- cost_logs provenance column.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cost_logs' and column_name = 'cost_status'
  ) then
    raise exception 'PX03 FAIL: public.cost_logs.cost_status provenance column missing';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Execution identity: idempotent reuse and payload-hash conflict.
-- ---------------------------------------------------------------------------
set local role service_role;

do $$
declare
  v_first jsonb;
  v_second jsonb;
  v_id uuid;
begin
  v_first := public.px03_create_execution(
    current_setting('px03.user_a')::uuid,
    null,
    'req-A',
    'hash-1',
    'chat',
    'gpt-5.6-sol',
    'route-v1',
    'price-v1',
    'cat-v1'
  );
  if (v_first->>'reused')::boolean is not false then
    raise exception 'PX03 FAIL: first create_execution was not fresh';
  end if;
  v_id := (v_first->'execution'->>'id')::uuid;

  v_second := public.px03_create_execution(
    current_setting('px03.user_a')::uuid,
    null,
    'req-A',
    'hash-1'
  );
  if (v_second->>'reused')::boolean is not true then
    raise exception 'PX03 FAIL: identical request key + payload was not reused';
  end if;
  if (v_second->'execution'->>'id')::uuid <> v_id then
    raise exception 'PX03 FAIL: reused execution has a different id';
  end if;

  if (select count(*) from prismatix_internal.executions
      where subject_id = current_setting('px03.user_a')::uuid) <> 1 then
    raise exception 'PX03 FAIL: idempotent create produced more than one execution';
  end if;
end $$;

do $$
begin
  perform public.px03_create_execution(
    current_setting('px03.user_a')::uuid,
    null,
    'req-A',
    'hash-CHANGED'
  );
  raise exception 'PX03 FAIL: reused request key with a changed payload did not conflict';
exception
  when others then
    if sqlstate <> 'PT409' then
      raise exception 'PX03 FAIL: expected request_key_conflict (PT409), got %: %', sqlstate, sqlerrm;
    end if;
end $$;

do $$
begin
  if (select count(*) from prismatix_internal.executions
      where subject_id = current_setting('px03.user_a')::uuid
        and client_request_key = 'req-A') <> 1 then
    raise exception 'PX03 FAIL: payload-hash conflict created an extra execution';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 3) Model-call identity: distinct dispatches are distinct rows; duplicate
--    settlement dedupes; unknown cost stays pending.
-- ---------------------------------------------------------------------------
set local role service_role;

do $$
declare
  v_exec uuid;
  v_call jsonb;
  v_count bigint;
begin
  select id into v_exec from prismatix_internal.executions
   where subject_id = current_setting('px03.user_a')::uuid
     and client_request_key = 'req-A';

  -- Two distinct provider dispatches with identical usage.
  perform public.px03_record_model_call(
    v_exec, 'debate-challenger', 'worker-skeptic', 1,
    'gpt-5.6-sol', 'gpt-5.6-sol', 'gpt-5.6-sol', null, 'completed',
    10, 5, 0, 0.00001, 0.00001, 0, 0.00002,
    '{"inputRatePer1M":1}'::jsonb, 'settled'
  );
  perform public.px03_record_model_call(
    v_exec, 'debate-challenger', 'worker-critic', 1,
    'gpt-5.6-sol', 'gpt-5.6-sol', 'gpt-5.6-sol', null, 'completed',
    10, 5, 0, 0.00001, 0.00001, 0, 0.00002,
    '{"inputRatePer1M":1}'::jsonb, 'settled'
  );
  select count(*) into v_count from prismatix_internal.model_calls where execution_id = v_exec;
  if v_count <> 2 then
    raise exception 'PX03 FAIL: distinct identical-usage calls produced % rows (expected 2)', v_count;
  end if;

  -- Retry of the SAME accounting event dedupes to one row.
  perform public.px03_record_model_call(
    v_exec, 'debate-challenger', 'worker-skeptic', 1,
    'gpt-5.6-sol', 'gpt-5.6-sol', 'gpt-5.6-sol', null, 'completed',
    10, 5, 0, 0.00001, 0.00001, 0, 0.00002,
    '{"inputRatePer1M":1}'::jsonb, 'settled'
  );
  select count(*) into v_count from prismatix_internal.model_calls
   where execution_id = v_exec and participant = 'worker-skeptic';
  if v_count <> 1 then
    raise exception 'PX03 FAIL: duplicate settlement produced % rows for one accounting event', v_count;
  end if;

  -- Unknown cost stays pending with zero dollars (never fabricated).
  v_call := public.px03_record_model_call(
    v_exec, 'smd-draft', 'primary', 1,
    'gemini-2.5-flash', 'gemini-2.5-flash', null, null, 'completed',
    0, 0, 0, 0, 0, 0, 0, null, 'pending'
  );
  if v_call->>'cost_status' <> 'pending' then
    raise exception 'PX03 FAIL: unknown-cost call was not pending (got %)', v_call->>'cost_status';
  end if;
  if (v_call->>'total_cost')::numeric <> 0 then
    raise exception 'PX03 FAIL: unknown-cost call fabricated a non-zero cost';
  end if;

  -- Invalid cost_status is rejected.
  begin
    perform public.px03_record_model_call(
      v_exec, 'bad', 'primary', 1, null, null, null, null, null,
      0, 0, 0, 0, 0, 0, 0, null, 'settled_typo'
    );
    raise exception 'PX03 FAIL: invalid cost_status was accepted';
  exception
    when others then
      if sqlstate <> '22023' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Terminal outcome set exactly once + durable reconciliation.
-- ---------------------------------------------------------------------------
do $$
declare
  v_exec uuid;
  v_first jsonb;
  v_second jsonb;
  v_row prismatix_internal.executions;
  v_job jsonb;
begin
  select id into v_exec from prismatix_internal.executions
   where subject_id = current_setting('px03.user_a')::uuid
     and client_request_key = 'req-A';

  v_first := public.px03_finalize_execution(v_exec, 'completed', 'ok', 'gpt-5.6-sol');
  if (v_first->>'finalized')::boolean is not true then
    raise exception 'PX03 FAIL: first finalize did not set the terminal outcome';
  end if;

  v_second := public.px03_finalize_execution(v_exec, 'failed', 'late');
  if (v_second->>'finalized')::boolean is not false then
    raise exception 'PX03 FAIL: second finalize changed the terminal outcome';
  end if;

  select * into v_row from prismatix_internal.executions where id = v_exec;
  if v_row.status <> 'completed' or v_row.terminal_outcome <> 'ok' then
    raise exception 'PX03 FAIL: terminal outcome was not preserved exactly once (status=%, outcome=%)',
      v_row.status, v_row.terminal_outcome;
  end if;

  v_job := public.px03_enqueue_reconciliation(v_exec, 'model_call_unsettled', '{"stage":"smd-draft"}'::jsonb);
  if v_job->>'status' <> 'pending' then
    raise exception 'PX03 FAIL: reconciliation job was not durable/pending';
  end if;
  if (select count(*) from prismatix_internal.reconciliation_jobs where execution_id = v_exec) <> 1 then
    raise exception 'PX03 FAIL: reconciliation job was not persisted';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 5) Isolation: SELECT-own for authenticated, no writes, anon denied, RPCs
--    service-role only.
-- ---------------------------------------------------------------------------

-- 5a) service_role creates an execution for user B so cross-tenant reads can be
--     probed.
set local role service_role;
do $$
begin
  perform public.px03_create_execution(
    current_setting('px03.user_b')::uuid, null, 'req-B', 'hash-b'
  );
end $$;
reset role;

-- 5b) User A sees only its own execution and own model calls.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('px03.user_a'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('px03.user_a'), true);
do $$
declare
  mine bigint;
  others bigint;
begin
  select count(*) into mine from prismatix_internal.executions
   where subject_id = current_setting('px03.user_a')::uuid;
  if mine <> 1 then
    raise exception 'PX03 FAIL: A cannot select its own execution (saw %)', mine;
  end if;

  select count(*) into others from prismatix_internal.executions
   where subject_id = current_setting('px03.user_b')::uuid;
  if others <> 0 then
    raise exception 'PX03 FAIL: A can see B''s execution (cross-tenant read)';
  end if;

  -- Own model calls visible, B's not (B has none, but the policy must not leak).
  select count(*) into mine from prismatix_internal.model_calls;
  if mine < 1 then
    raise exception 'PX03 FAIL: A cannot select its own model calls';
  end if;
end $$;

do $$
begin
  insert into prismatix_internal.executions (subject_id, client_request_key, payload_hash)
  values (current_setting('px03.user_a')::uuid, 'client-forged', 'x');
  raise exception 'PX03 FAIL: client inserted into executions';
exception
  when insufficient_privilege then null; -- expected
end $$;

do $$
begin
  update prismatix_internal.executions
     set status = 'completed'
   where subject_id = current_setting('px03.user_a')::uuid;
  raise exception 'PX03 FAIL: client updated an execution row';
exception
  when insufficient_privilege then null; -- expected (no UPDATE grant/policy)
end $$;

do $$
begin
  insert into prismatix_internal.reconciliation_jobs (kind) values ('forged');
  raise exception 'PX03 FAIL: client inserted into reconciliation_jobs';
exception
  when insufficient_privilege then null; -- expected
end $$;

-- RPC execute is service-role only.
do $$
begin
  perform public.px03_create_execution(
    current_setting('px03.user_a')::uuid, null, 'rpc-forged', 'x'
  );
  raise exception 'PX03 FAIL: authenticated executed px03_create_execution';
exception
  when insufficient_privilege then null; -- expected
end $$;
reset role;

-- 5c) anon is denied entirely.
set local role anon;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare
  n bigint;
begin
  select count(*) into n from prismatix_internal.executions;
  raise exception 'PX03 FAIL: anon read prismatix_internal.executions (saw %)', n;
exception
  when insufficient_privilege then null; -- expected
end $$;
do $$
begin
  perform public.px03_create_execution(
    current_setting('px03.user_a')::uuid, null, 'anon-forged', 'x'
  );
  raise exception 'PX03 FAIL: anon executed px03_create_execution';
exception
  when insufficient_privilege then null; -- expected
end $$;
reset role;

rollback;

\echo 'tests/integration/ledger-settlement.sql: PASS (all PX03 ledger assertions held)'
