-- tests/integration/px06_execution_receipt_isolation.sql
-- PX06 terminal-receipt RPC isolation assertions.
--
-- Self-contained psql script: everything runs inside ONE transaction and is
-- ROLLED BACK, so no database state is modified. It (re-)applies the real PX03,
-- PX05 and PX06 migrations (all additive/idempotent) and then asserts the
-- ownership + privilege contract of the read RPC that backs the terminal
-- receipt:
--   * the real fn is SECURITY DEFINER with a fixed search_path;
--   * service_role owns EXECUTE; public / anon / authenticated do not;
--   * an owned execution returns { execution, calls, reservation };
--   * a foreign subject returns NULL (no cross-tenant read, no existence leak);
--   * an unknown execution id returns NULL.
--
-- Prerequisite: a Supabase database with the auth schema and the
-- anon / authenticated / service_role roles (as created by the baseline
-- migrations). Run per docs/engineering/containment-runbook.md.
--
-- Run from the REPO ROOT:
--   Local:
--     supabase start && supabase db reset
--     psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--          -v ON_ERROR_STOP=1 -f tests/integration/px06_execution_receipt_isolation.sql
--   Staging (already-migrated schema):
--     psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 \
--          -f tests/integration/px06_execution_receipt_isolation.sql

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: two fresh users.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('px06.user_a', gen_random_uuid()::text, true);
  perform set_config('px06.user_b', gen_random_uuid()::text, true);
end $$;

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  (
    current_setting('px06.user_a')::uuid,
    'authenticated',
    'authenticated',
    'px06-a-' || current_setting('px06.user_a') || '@example.invalid',
    'px06-not-a-real-hash',
    now(),
    now()
  ),
  (
    current_setting('px06.user_b')::uuid,
    'authenticated',
    'authenticated',
    'px06-b-' || current_setting('px06.user_b') || '@example.invalid',
    'px06-not-a-real-hash',
    now(),
    now()
  );

-- ---------------------------------------------------------------------------
-- Apply the REAL migrations under test (idempotent; rolled back at the end).
-- ---------------------------------------------------------------------------
\i supabase/migrations/20261006010000_px03_execution_ledger.sql
\i supabase/migrations/20261006020000_px05_budgets_leases.sql
\i supabase/migrations/20261006030000_px06_execution_receipt.sql

-- ---------------------------------------------------------------------------
-- 1) Function posture: SECURITY DEFINER + fixed search_path.
-- ---------------------------------------------------------------------------
do $$
declare
  v_secdef boolean;
  v_config text[];
begin
  select p.prosecdef, p.proconfig into v_secdef, v_config
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname = 'px03_get_execution_receipt';

  if v_secdef is null then
    raise exception 'PX06 FAIL: public.px03_get_execution_receipt does not exist';
  end if;
  if v_secdef is not true then
    raise exception 'PX06 FAIL: receipt RPC is not SECURITY DEFINER';
  end if;
  if v_config is null
     or array_to_string(v_config, ',') not like '%search_path=public, prismatix_internal%' then
    raise exception 'PX06 FAIL: receipt RPC has no fixed search_path (config=%)', v_config;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Seed an execution + a model call + a held reservation for subject A.
-- ---------------------------------------------------------------------------
set local role service_role;

do $$
declare
  v_exec jsonb;
  v_id uuid;
begin
  v_exec := public.px03_create_execution(
    current_setting('px06.user_a')::uuid,
    null,
    'req-receipt-A',
    'hash-receipt-A',
    'chat',
    'haiku-4.5',
    'route-v1',
    'price-v1',
    'cat-v1'
  );
  if v_exec->'execution'->>'id' is null then
    raise exception 'PX06 FAIL: could not seed an execution for subject A';
  end if;
  v_id := (v_exec->'execution'->>'id')::uuid;

  perform public.px03_record_model_call(
    v_id, 'baseline', 'anthropic', 1,
    'haiku-4.5', 'claude-haiku', 'claude-haiku', null, 'completed',
    10, 5, 0, 0.00001, 0.00001, 0, 0.00002,
    '{"inputRatePer1M":1}'::jsonb, 'settled'
  );

  insert into prismatix_internal.budget_reservations
    (execution_id, subject_id, amount_usd, committed_usd, state)
  values (v_id, current_setting('px06.user_a')::uuid, 0.500000, 0.000000, 'held');
end $$;

-- ---------------------------------------------------------------------------
-- 3) Ownership: owned → row; foreign subject → NULL; unknown id → NULL.
-- ---------------------------------------------------------------------------
do $$
declare
  v_exec uuid;
  v_owned jsonb;
  v_foreign jsonb;
  v_unknown jsonb;
begin
  select id into v_exec
    from prismatix_internal.executions
   where subject_id = current_setting('px06.user_a')::uuid
     and client_request_key = 'req-receipt-A';

  v_owned := public.px03_get_execution_receipt(
    current_setting('px06.user_a')::uuid, v_exec
  );
  if v_owned is null then
    raise exception 'PX06 FAIL: owner could not read its own receipt';
  end if;
  if (v_owned->'execution'->>'id')::uuid <> v_exec then
    raise exception 'PX06 FAIL: receipt returned the wrong execution';
  end if;
  if jsonb_array_length(v_owned->'calls') <> 1 then
    raise exception 'PX06 FAIL: receipt calls projection wrong (len=%)',
      jsonb_array_length(v_owned->'calls');
  end if;
  if v_owned->'reservation'->>'state' <> 'held' then
    raise exception 'PX06 FAIL: receipt reservation projection wrong (state=%)',
      v_owned->'reservation'->>'state';
  end if;

  -- A receipt for another subject is NOT readable (NULL, not an error).
  v_foreign := public.px03_get_execution_receipt(
    current_setting('px06.user_b')::uuid, v_exec
  );
  if v_foreign is not null then
    raise exception 'PX06 FAIL: cross-subject receipt was readable (existence leaked)';
  end if;

  -- Unknown execution id → NULL.
  v_unknown := public.px03_get_execution_receipt(
    current_setting('px06.user_a')::uuid, gen_random_uuid()
  );
  if v_unknown is not null then
    raise exception 'PX06 FAIL: unknown execution id returned a receipt';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 4) Privileges: service_role only; authenticated/anon/public denied.
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_function_privilege(
    'service_role', 'public.px03_get_execution_receipt(uuid, uuid)', 'EXECUTE'
  ) then
    raise exception 'PX06 FAIL: service_role lacks EXECUTE on the receipt RPC';
  end if;
  if has_function_privilege(
    'authenticated', 'public.px03_get_execution_receipt(uuid, uuid)', 'EXECUTE'
  ) then
    raise exception 'PX06 FAIL: authenticated has EXECUTE on the receipt RPC';
  end if;
  if has_function_privilege(
    'anon', 'public.px03_get_execution_receipt(uuid, uuid)', 'EXECUTE'
  ) then
    raise exception 'PX06 FAIL: anon has EXECUTE on the receipt RPC';
  end if;
  if has_function_privilege(
    'public', 'public.px03_get_execution_receipt(uuid, uuid)', 'EXECUTE'
  ) then
    raise exception 'PX06 FAIL: public has EXECUTE on the receipt RPC';
  end if;
end $$;

-- An authenticated client attempting to call the RPC is denied outright.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('px06.user_a'), 'role', 'authenticated')::text,
  true
);
select set_config('request.jwt.claim.sub', current_setting('px06.user_a'), true);
do $$
declare
  v_exec uuid;
begin
  select id into v_exec
    from prismatix_internal.executions
   where subject_id = current_setting('px06.user_a')::uuid
     and client_request_key = 'req-receipt-A';

  begin
    perform public.px03_get_execution_receipt(
      current_setting('px06.user_a')::uuid, v_exec
    );
    raise exception 'PX06 FAIL: authenticated executed the receipt RPC';
  exception
    when insufficient_privilege then null; -- expected
  end;
end $$;
reset role;

rollback;

\echo 'tests/integration/px06_execution_receipt_isolation.sql: PASS (receipt ownership + privilege assertions held)'
