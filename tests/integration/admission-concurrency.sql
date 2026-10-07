-- tests/integration/admission-concurrency.sql
-- PX05 atomic budget admission / lease / quota assertions.
--
-- Self-contained psql assertion script. It re-applies the REAL PX05 migration
-- (idempotent) and then asserts the money/concurrency invariants the router and
-- video paths depend on:
--   * schema, RLS and service-role-only RPC grants are present;
--   * per-user budget exhaustion denies with ZERO reservation and no held money;
--   * the per-minute request rate and the active-lease limit are enforced;
--   * unknown/ambiguous usage becomes `pending_reconcile` and NEVER forgives the
--     held money (never silently $0.00);
--   * lease expiry marks the lease released but does NOT release the monetary
--     hold (uncertain paid work stays held/pending_reconcile);
--   * the project window is SHARED: a brand-new account cannot obtain a fresh
--     project budget once the project total is consumed;
--   * confirmed-zero work can be released;
--   * 50 concurrent admission attempts across two sessions never oversubscribe
--     the shared project window (requires the `dblink` extension; skipped with a
--     loud notice when unavailable).
--
-- Prerequisite: a Supabase database with ALL migrations applied (auth schema,
-- prismatix_internal from PX01/PX03). The PX05 tables intentionally have NO FK
-- to auth.users, so the budget assertions need no auth fixture rows.
--
-- Run from the REPO ROOT:
--   Local:
--     supabase start && supabase db reset
--     psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--          -v ON_ERROR_STOP=1 -f tests/integration/admission-concurrency.sql
--   Staging (already-migrated schema):
--     psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f tests/integration/admission-concurrency.sql
--
-- NOTE: this script was authored but NOT executed in the PX05 work environment
-- (no psql/Postgres server available). It is a real assertion script, not a
-- comment: every check raises on failure.

\set ON_ERROR_STOP on

-- Apply the REAL migration under test (idempotent DDL; committed).
\i supabase/migrations/20261006020000_px05_budgets_leases.sql

-- ---------------------------------------------------------------------------
-- 1) Schema / RLS / grants (self-contained, rolled back).
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  n bigint;
begin
  if to_regclass('prismatix_internal.budget_windows') is null
     or to_regclass('prismatix_internal.budget_reservations') is null
     or to_regclass('prismatix_internal.execution_leases') is null
     or to_regclass('prismatix_internal.admission_requests') is null then
    raise exception 'PX05 FAIL: one or more budget/lease tables are missing';
  end if;

  -- RLS enabled on all four tables.
  select count(*) into n
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'prismatix_internal'
    and c.relname in ('budget_windows','budget_reservations','execution_leases','admission_requests')
    and c.relrowsecurity;
  if n <> 4 then
    raise exception 'PX05 FAIL: RLS not enabled on all budget tables (enabled=%)', n;
  end if;

  -- No client policies at all: service-role only.
  select count(*) into n
  from pg_policies
  where schemaname = 'prismatix_internal'
    and tablename in ('budget_windows','budget_reservations','execution_leases','admission_requests');
  if n <> 0 then
    raise exception 'PX05 FAIL: % client policies exist on budget tables (expected 0)', n;
  end if;

  -- Partial unique index: at most one ACTIVE lease per subject.
  select count(*) into n
  from pg_indexes
  where schemaname = 'prismatix_internal'
    and tablename = 'execution_leases'
    and indexdef ilike '%unique%'
    and indexdef ilike '%where (released_at is null)%';
  if n < 1 then
    raise exception 'PX05 FAIL: missing partial unique active-lease index';
  end if;

  -- The five RPCs exist.
  select count(*) into n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in (
      'px05_admit_execution','px05_commit_reservation','px05_commit_from_ledger',
      'px05_release_reservation','px05_reconcile_reservation');
  if n <> 5 then
    raise exception 'PX05 FAIL: expected 5 px05_* RPCs, found %', n;
  end if;
end $$;

-- Every reservation mutator locks the PROJECT window before the USER window
-- (same fixed order as admit), so no lock cycle is possible. Assert the static
-- ordering from the stored function definitions.
do $$
declare
  fn text;
  def text;
begin
  foreach fn in array array[
    'px05_admit_execution','px05_commit_reservation','px05_commit_from_ledger',
    'px05_release_reservation','px05_reconcile_reservation'
  ] loop
    select pg_get_functiondef(p.oid) into def
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = fn;

    if def is null then
      raise exception 'PX05 FAIL: function % not found', fn;
    end if;
    if position('scope = ''project''' in def) = 0
       or position('scope = ''user''' in def) = 0 then
      raise exception 'PX05 FAIL: % does not lock both windows', fn;
    end if;
    if position('scope = ''project''' in def) > position('scope = ''user''' in def) then
      raise exception 'PX05 FAIL: % locks the user window before the project window', fn;
    end if;
  end loop;
end $$;

-- service_role may execute; authenticated/anon may not.
do $$
declare
  n bigint;
begin
  select count(*) into n
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in (
      'px05_admit_execution','px05_commit_reservation','px05_commit_from_ledger',
      'px05_release_reservation','px05_reconcile_reservation')
    and grantee = 'authenticated';
  if n <> 0 then
    raise exception 'PX05 FAIL: authenticated can execute a px05_* RPC (% grants)', n;
  end if;

  select count(*) into n
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in (
      'px05_admit_execution','px05_commit_reservation','px05_commit_from_ledger',
      'px05_release_reservation','px05_reconcile_reservation')
    and grantee = 'anon';
  if n <> 0 then
    raise exception 'PX05 FAIL: anon can execute a px05_* RPC (% grants)', n;
  end if;

  select count(*) into n
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in (
      'px05_admit_execution','px05_commit_reservation','px05_commit_from_ledger',
      'px05_release_reservation','px05_reconcile_reservation')
    and grantee = 'service_role';
  if n <> 5 then
    raise exception 'PX05 FAIL: service_role is missing px05_* execute grants (found %)', n;
  end if;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- 2) Functional admission assertions (self-contained, rolled back).
-- ---------------------------------------------------------------------------
begin;

-- The ledger-summed commit assertions create real executions, which FK to
-- auth.users; create the two subjects they need (rolled back at the end).
insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000008','authenticated','authenticated','px05-u8@example.invalid','x', now(), now()),
  ('a0000000-0000-4000-8000-000000000009','authenticated','authenticated','px05-u9@example.invalid','x', now(), now());

set local role service_role;

do $$
declare
  c_project constant uuid := '00000000-0000-0000-0000-000000000000';
  u1 uuid := 'a0000000-0000-4000-8000-000000000001';
  u2 uuid := 'a0000000-0000-4000-8000-000000000002';
  u3 uuid := 'a0000000-0000-4000-8000-000000000003';
  u4 uuid := 'a0000000-0000-4000-8000-000000000004';
  u5 uuid := 'a0000000-0000-4000-8000-000000000005';
  u6 uuid := 'a0000000-0000-4000-8000-000000000006';
  u7 uuid := 'a0000000-0000-4000-8000-000000000007';
  u8 uuid := 'a0000000-0000-4000-8000-000000000008';
  u9 uuid := 'a0000000-0000-4000-8000-000000000009';
  u10 uuid := 'a0000000-0000-4000-8000-000000000010';
  v_exec uuid;
  v_exec2 uuid;
  v_exec3 uuid;
  e1 uuid := 'b0000000-0000-4000-8000-000000000001';
  e2 uuid := 'b0000000-0000-4000-8000-000000000002';
  e3 uuid := 'b0000000-0000-4000-8000-000000000003';
  v jsonb;
  held numeric;
  committed numeric;
  res prismatix_internal.budget_reservations;
begin
  -- 2a) Per-user budget exhaustion: first admit holds; second denies with ZERO
  --     reservation (no new hold, no reservation row for the denied execution).
  v := public.px05_admit_execution(u1, e1, 0.05, 0.10, 900, 100, 0.10, 100, 1);
  if (v->>'admitted')::boolean is not true then
    raise exception 'PX05 FAIL: first admit was not admitted (%)', v;
  end if;
  select held_usd into held from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u1 and window_start = date_trunc('day', now());
  if held <> 0.10 then
    raise exception 'PX05 FAIL: user window held_usd = % (expected 0.10)', held;
  end if;

  v := public.px05_admit_execution(u1, e2, 0.05, 0.10, 900, 100, 0.10, 100, 1);
  if (v->>'admitted')::boolean is not false or v->>'reason' <> 'budget_exhausted' then
    raise exception 'PX05 FAIL: budget exhaustion was not denied (%)', v;
  end if;
  if v->>'reservation_id' is not null then
    raise exception 'PX05 FAIL: denied admission returned a reservation';
  end if;
  if exists (select 1 from prismatix_internal.budget_reservations where execution_id = e2) then
    raise exception 'PX05 FAIL: denied admission created a reservation row';
  end if;
  select held_usd into held from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u1 and window_start = date_trunc('day', now());
  if held <> 0.10 then
    raise exception 'PX05 FAIL: denied admission changed held_usd to %', held;
  end if;

  -- 2b) Unknown/ambiguous usage => pending_reconcile, held money preserved.
  v := public.px05_commit_reservation(e1, null);
  if v->>'state' <> 'pending_reconcile' then
    raise exception 'PX05 FAIL: null actual did not become pending_reconcile (%)', v;
  end if;
  select * into res from prismatix_internal.budget_reservations where execution_id = e1;
  if res.state <> 'pending_reconcile' or res.committed_usd <> 0 then
    raise exception 'PX05 FAIL: unknown usage was not kept pending/held (state=%, committed=%)',
      res.state, res.committed_usd;
  end if;
  select held_usd into held from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u1 and window_start = date_trunc('day', now());
  if held <> 0.10 then
    raise exception 'PX05 FAIL: unknown usage forgave held money (held=%)', held;
  end if;

  -- 2b-guard) A release mis-call must NOT forgive pending_reconcile work.
  v := public.px05_release_reservation(e1, 'mis-call');
  if (v->>'updated')::boolean is not false or v->>'state' <> 'pending_reconcile' then
    raise exception 'PX05 FAIL: release forgave pending_reconcile work (%)', v;
  end if;
  select held_usd into held from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u1 and window_start = date_trunc('day', now());
  if held <> 0.10 then
    raise exception 'PX05 FAIL: release mis-call changed held_usd to %', held;
  end if;

  -- 2c) Known actual commits: held decremented by the reserved amount, committed
  --     incremented by the actual amount.
  v := public.px05_commit_reservation(e1, 0.04);
  if v->>'state' <> 'committed' then
    raise exception 'PX05 FAIL: known actual did not commit (%)', v;
  end if;
  select held_usd, committed_usd into held, committed
    from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u1 and window_start = date_trunc('day', now());
  if held <> 0 or committed <> 0.04 then
    raise exception 'PX05 FAIL: commit math wrong (held=%, committed=%)', held, committed;
  end if;

  -- 2d) Commit is idempotent; a late different actual cannot rewrite it.
  v := public.px05_commit_reservation(e1, 0.99);
  if (v->>'updated')::boolean is not false then
    raise exception 'PX05 FAIL: second commit was not a no-op (%)', v;
  end if;
  select committed_usd into committed from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u1 and window_start = date_trunc('day', now());
  if committed <> 0.04 then
    raise exception 'PX05 FAIL: late commit rewrote committed_usd to %', committed;
  end if;

  -- 2e) Per-minute request rate. request_limit = 2.
  v := public.px05_admit_execution(u2, e1, 0.01, 0.01, 900, 2, 100, 100, 1);
  if (v->>'admitted')::boolean is not true then
    raise exception 'PX05 FAIL: rate test first admit denied (%)', v;
  end if;
  -- Expire the active lease so the active-limit check does not shadow the rate.
  update prismatix_internal.execution_leases set expires_at = now() - interval '1 minute'
   where subject_id = u2 and released_at is null;
  v := public.px05_admit_execution(u2, e2, 0.01, 0.01, 900, 2, 100, 100, 1);
  if (v->>'admitted')::boolean is not true then
    raise exception 'PX05 FAIL: rate test second admit denied (%)', v;
  end if;
  v := public.px05_admit_execution(u2, e3, 0.01, 0.01, 900, 2, 100, 100, 1);
  if (v->>'admitted')::boolean is not false or v->>'reason' <> 'rate_limited' then
    raise exception 'PX05 FAIL: per-minute rate limit not enforced (%)', v;
  end if;

  -- 2f) Active-run limit: a second concurrent execution for the same subject is
  --     denied while the first lease is live.
  v := public.px05_admit_execution(u3, e1, 0.01, 0.01, 900, 100, 100, 100, 1);
  if (v->>'admitted')::boolean is not true then
    raise exception 'PX05 FAIL: active test first admit denied (%)', v;
  end if;
  v := public.px05_admit_execution(u3, e2, 0.01, 0.01, 900, 100, 100, 100, 1);
  if (v->>'admitted')::boolean is not false or v->>'reason' <> 'active_limit' then
    raise exception 'PX05 FAIL: active-run limit not enforced (%)', v;
  end if;

  -- 2g) Lease expiry does NOT forgive uncertain paid work. u3 has a live 0.01
  --     hold; set the user daily ceiling to exactly 0.01, expire the lease, and
  --     prove a new admit is denied while the old hold survives.
  update prismatix_internal.budget_windows set limit_usd = 0.01
   where scope = 'user' and subject_id = u3 and window_start = date_trunc('day', now());
  update prismatix_internal.execution_leases set expires_at = now() - interval '1 minute'
   where subject_id = u3 and released_at is null;
  v := public.px05_admit_execution(u3, e3, 0.01, 0.01, 900, 100, 0.01, 100, 1);
  if (v->>'admitted')::boolean is not false or v->>'reason' <> 'budget_exhausted' then
    raise exception 'PX05 FAIL: lease expiry forgave held money (%)', v;
  end if;
  select * into res from prismatix_internal.budget_reservations where execution_id = e1;
  if res.subject_id <> u3 or res.state not in ('held','pending_reconcile') then
    raise exception 'PX05 FAIL: expired-lease reservation was forgiven (state=%)', res.state;
  end if;
  if not exists (
    select 1 from prismatix_internal.execution_leases
    where subject_id = u3 and execution_id = e1 and released_at is not null
  ) then
    raise exception 'PX05 FAIL: stale lease was not marked released';
  end if;
  select held_usd into held from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u3 and window_start = date_trunc('day', now());
  if held <> 0.01 then
    raise exception 'PX05 FAIL: stale lease changed held_usd to %', held;
  end if;

  -- 2h) The project window is SHARED. Project daily = 0.10; two subjects of 0.05
  --     consume it; a brand-new subject is denied even though its own window is
  --     fresh (a new account cannot obtain a fresh project budget).
  v := public.px05_admit_execution(u4, e1, 0.05, 0.05, 900, 100, 100, 0.10, 1);
  if (v->>'admitted')::boolean is not true then
    raise exception 'PX05 FAIL: project test u4 denied (%)', v;
  end if;
  v := public.px05_admit_execution(u5, e1, 0.05, 0.05, 900, 100, 100, 0.10, 1);
  if (v->>'admitted')::boolean is not true then
    raise exception 'PX05 FAIL: project test u5 denied (%)', v;
  end if;
  v := public.px05_admit_execution(u6, e1, 0.05, 0.05, 900, 100, 100, 0.10, 1);
  if (v->>'admitted')::boolean is not false or v->>'reason' <> 'budget_exhausted' then
    raise exception 'PX05 FAIL: new account obtained a fresh project budget (%)', v;
  end if;
  select held_usd into held from prismatix_internal.budget_windows
   where scope = 'project' and subject_id = c_project and window_start = date_trunc('day', now());
  if held <> 0.10 then
    raise exception 'PX05 FAIL: shared project held_usd = % (expected 0.10)', held;
  end if;

  -- 2i) Confirmed-zero work can be released (hold returned).
  v := public.px05_admit_execution(u7, e1, 0.20, 0.20, 900, 100, 100, 100, 1);
  if (v->>'admitted')::boolean is not true then
    raise exception 'PX05 FAIL: release test admit denied (%)', v;
  end if;
  v := public.px05_release_reservation(e1, 'no_provider_call');
  if v->>'state' <> 'released' then
    raise exception 'PX05 FAIL: release did not release (%)', v;
  end if;
  select held_usd into held from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u7 and window_start = date_trunc('day', now());
  if held <> 0 then
    raise exception 'PX05 FAIL: release did not return the hold (held=%)', held;
  end if;

  -- 2j) Authoritative ledger-summed commit: the committed amount is the SUM of
  --     the execution's settled model_calls (all stages), not a single-stage
  --     estimate. This is what makes the daily window reflect true multi-stage
  --     cost.
  v_exec := (public.px03_create_execution(u8, null, 'px05-ledger-1', 'hash-1')
               -> 'execution' ->> 'id')::uuid;
  perform public.px03_record_model_call(
    v_exec, 'baseline', 'primary', 1, null, null, null, null, 'completed',
    10, 5, 0, 0.010, 0.020, 0, 0.030, null, 'settled');
  perform public.px03_record_model_call(
    v_exec, 'debate-challenger', 'worker', 1, null, null, null, null, 'completed',
    10, 5, 0, 0.005, 0.005, 0, 0.010, null, 'settled');

  v := public.px05_admit_execution(u8, v_exec, 0.05, 0.5, 900, 100, 100, 100, 1);
  if (v->>'admitted')::boolean is not true then
    raise exception 'PX05 FAIL: ledger commit admit denied (%)', v;
  end if;
  v := public.px05_commit_from_ledger(v_exec);
  if v->>'state' <> 'committed' or (v->>'committed_usd')::numeric <> 0.04 then
    raise exception 'PX05 FAIL: ledger commit did not sum settled calls (%)', v;
  end if;
  select held_usd, committed_usd into held, committed
    from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u8 and window_start = date_trunc('day', now());
  if held <> 0 or committed <> 0.04 then
    raise exception 'PX05 FAIL: ledger commit window math wrong (held=%, committed=%)',
      held, committed;
  end if;

  -- 2k) Any unsettled call keeps the hold pending_reconcile (no partial commit).
  v_exec2 := (public.px03_create_execution(u9, null, 'px05-ledger-2', 'hash-2')
                -> 'execution' ->> 'id')::uuid;
  perform public.px03_record_model_call(
    v_exec2, 'baseline', 'primary', 1, null, null, null, null, 'completed',
    10, 5, 0, 0, 0, 0, 0, null, 'pending');

  v := public.px05_admit_execution(u9, v_exec2, 0.05, 0.5, 900, 100, 100, 100, 1);
  if (v->>'admitted')::boolean is not true then
    raise exception 'PX05 FAIL: pending-ledger admit denied (%)', v;
  end if;
  v := public.px05_commit_from_ledger(v_exec2);
  if v->>'state' <> 'pending_reconcile' then
    raise exception 'PX05 FAIL: pending call committed a partial amount (%)', v;
  end if;
  select held_usd into held from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u9 and window_start = date_trunc('day', now());
  if held <> 0.5 then
    raise exception 'PX05 FAIL: pending-ledger commit forgave held (held=%)', held;
  end if;

  -- 2l) Explicit reconciliation resolves a pending hold with a recorded reason.
  v_exec3 := gen_random_uuid();
  v := public.px05_admit_execution(u10, v_exec3, 0.2, 0.2, 900, 100, 100, 100, 1);
  if (v->>'admitted')::boolean is not true then
    raise exception 'PX05 FAIL: reconcile admit denied (%)', v;
  end if;
  v := public.px05_reconcile_reservation(v_exec3, 0, 'video_processing_complete');
  if v->>'state' <> 'released' then
    raise exception 'PX05 FAIL: reconcile did not release (%)', v;
  end if;
  select held_usd into held from prismatix_internal.budget_windows
   where scope = 'user' and subject_id = u10 and window_start = date_trunc('day', now());
  if held <> 0 then
    raise exception 'PX05 FAIL: reconcile did not return the hold (held=%)', held;
  end if;
  if not exists (
    select 1 from prismatix_internal.reconciliation_jobs
    where kind = 'budget_reconciled'
      and payload->>'reason' = 'video_processing_complete'
  ) then
    raise exception 'PX05 FAIL: reconcile did not record an audit reason';
  end if;
end $$;

reset role;
rollback;

-- ---------------------------------------------------------------------------
-- 3) Two-session concurrency: 50 admits across two sessions never oversubscribe
--    the shared project window. Requires dblink; skipped loudly if unavailable.
--    Fixtures are committed (dblink connections cannot see uncommitted rows) and
--    cleaned up afterwards.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists dblink;
  exception when others then
    raise notice 'PX05 NOTE: dblink unavailable (%). Skipping two-session concurrency assertions.', sqlerrm;
  end;
end $$;

do $$
declare
  c_project constant uuid := '00000000-0000-0000-0000-000000000000';
  v_conn text;
  v_admitted integer := 0;
  v_denied integer := 0;
  i integer;
  rec record;
  v_result jsonb;
  held numeric;
  limit_usd numeric := 1.00;
  per_exec numeric := 0.10;
  expected_admits integer := 10;
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    raise notice 'PX05 NOTE: dblink extension not installed; concurrency assertions skipped.';
    return;
  end if;

  -- Clean any prior run for this window (test DB only).
  delete from prismatix_internal.budget_reservations
   where created_at >= date_trunc('day', now());
  delete from prismatix_internal.execution_leases
   where acquired_at >= date_trunc('day', now());
  delete from prismatix_internal.budget_windows
   where window_start = date_trunc('day', now());
  delete from prismatix_internal.admission_requests
   where window_start >= date_trunc('minute', now()) - interval '1 minute';

  v_conn := 'dbname=' || current_database();
  perform dblink_connect('px05_s1', v_conn);
  perform dblink_connect('px05_s2', v_conn);

  -- 25 async admits per session; each subject is distinct so the per-user lease
  -- limit never masks the shared project budget.
  for i in 1..25 loop
    perform dblink_send_query('px05_s1', format(
      $q$select public.px05_admit_execution(
            %L::uuid, gen_random_uuid(), %L, %L, 900, 1000, 100, %L, 1)$q$,
      ('c0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      per_exec, per_exec, limit_usd
    ));
  end loop;
  for i in 26..50 loop
    perform dblink_send_query('px05_s2', format(
      $q$select public.px05_admit_execution(
            %L::uuid, gen_random_uuid(), %L, %L, 900, 1000, 100, %L, 1)$q$,
      ('c0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      per_exec, per_exec, limit_usd
    ));
  end loop;

  -- Drain session 1.
  for i in 1..25 loop
    for rec in select * from dblink_get_result('px05_s1') as t(r jsonb) loop
      v_result := rec.r;
      if (v_result->>'admitted')::boolean then v_admitted := v_admitted + 1;
      else v_denied := v_denied + 1; end if;
    end loop;
  end loop;
  -- Drain session 2.
  for i in 1..25 loop
    for rec in select * from dblink_get_result('px05_s2') as t(r jsonb) loop
      v_result := rec.r;
      if (v_result->>'admitted')::boolean then v_admitted := v_admitted + 1;
      else v_denied := v_denied + 1; end if;
    end loop;
  end loop;

  perform dblink_disconnect('px05_s1');
  perform dblink_disconnect('px05_s2');

  if v_admitted <> expected_admits then
    raise exception 'PX05 FAIL: % of 50 concurrent admits were admitted (expected exactly %)',
      v_admitted, expected_admits;
  end if;
  if v_denied <> (50 - expected_admits) then
    raise exception 'PX05 FAIL: % concurrent admits were denied (expected %)',
      v_denied, 50 - expected_admits;
  end if;

  select held_usd into held from prismatix_internal.budget_windows
   where scope = 'project' and subject_id = c_project and window_start = date_trunc('day', now());
  if held <> limit_usd then
    raise exception 'PX05 FAIL: concurrent holds oversubscribed the project window (held=%, limit=%)',
      held, limit_usd;
  end if;
  if held > limit_usd then
    raise exception 'PX05 FAIL: project window oversubscribed';
  end if;

  -- A NEW session (fresh connection = restart/session reset) still sees the
  -- exhausted project window: quota authority is the database, not memory.
  perform dblink_connect('px05_s3', v_conn);
  perform dblink_send_query('px05_s3', format(
    $q$select public.px05_admit_execution(
          'd0000000-0000-4000-8000-000000000099'::uuid, gen_random_uuid(), %L, %L, 900, 1000, 100, %L, 1)$q$,
    per_exec, per_exec, limit_usd
  ));
  for rec in select * from dblink_get_result('px05_s3') as t(r jsonb) loop
    v_result := rec.r;
  end loop;
  perform dblink_disconnect('px05_s3');
  if (v_result->>'admitted')::boolean is not false then
    raise exception 'PX05 FAIL: a fresh session reset the shared project budget (%)', v_result;
  end if;

  -- Cleanup committed fixtures.
  delete from prismatix_internal.budget_reservations
   where created_at >= date_trunc('day', now());
  delete from prismatix_internal.execution_leases
   where acquired_at >= date_trunc('day', now());
  delete from prismatix_internal.budget_windows
   where window_start = date_trunc('day', now());
  delete from prismatix_internal.admission_requests
   where window_start >= date_trunc('minute', now()) - interval '1 minute';
end $$;

\echo 'tests/integration/admission-concurrency.sql: PASS (all PX05 admission assertions held)'
