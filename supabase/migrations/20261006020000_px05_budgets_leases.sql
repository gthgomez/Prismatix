-- PX05: Atomic budgets, distributed rate limits and all-path quotas.
-- Findings addressed: F04-F06, F19, F25.
--
-- The Postgres database becomes the SINGLE authority for spend and concurrency.
-- Rate/concurrency enforcement previously lived in per-runtime in-memory Maps
-- (not shared across isolates) and there was no atomic budget reserve/reconcile.
-- This migration adds:
--
--   prismatix_internal.budget_windows      - per-scope daily USD windows
--   prismatix_internal.budget_reservations - one held/committed/released hold per execution
--   prismatix_internal.execution_leases    - at most one active execution per subject
--   prismatix_internal.admission_requests  - per-minute request rate counter
--
-- and one transactional reserve/admit RPC plus commit/release RPCs, all
-- SECURITY DEFINER with a fixed search_path and EXECUTE granted to service_role
-- ONLY. prismatix_internal stays OUT of PostgREST (see PX01/PX03), so the
-- public-schema RPCs are the only access path.
--
-- MONEY SAFETY:
--   * The admission RPC reserves the configured MAXIMUM billable work (not the
--     expected output) and requires committed + held + max <= limit for BOTH the
--     user and the shared project window.
--   * Unknown / ambiguous usage is never silently released or turned into
--     $0.00: commit(null) keeps the hold and marks the reservation
--     `pending_reconcile`.
--   * Lease expiry marks the lease released but does NOT release the monetary
--     hold; uncertain paid work stays held/pending_reconcile.
--
-- PROJECT SCOPE: the RPC signature carries no project id, so the project window
-- is the shared deployment-wide window keyed by the fixed sentinel subject
-- `00000000-0000-0000-0000-000000000000`. All accounts therefore share one
-- project budget: a brand-new account cannot obtain a fresh project budget.
--
-- Additive and idempotent. Verify with tests/integration/admission-concurrency.sql
-- (real assertion script; the two-session portion uses dblink).

-- ---------------------------------------------------------------------------
-- 1) Authority tables.
-- ---------------------------------------------------------------------------

create table if not exists prismatix_internal.budget_windows (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('user','project')),
  subject_id uuid not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  limit_usd numeric(12,6) not null default 0,
  committed_usd numeric(12,6) not null default 0,
  held_usd numeric(12,6) not null default 0,
  unique (scope, subject_id, window_start)
);

create table if not exists prismatix_internal.budget_reservations (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid unique,
  subject_id uuid not null,
  amount_usd numeric(12,6) not null default 0,
  committed_usd numeric(12,6) not null default 0,
  state text not null default 'held'
    check (state in ('held','committed','released','pending_reconcile')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists prismatix_internal.execution_leases (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null,
  execution_id uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  released_at timestamptz
);

-- At most ONE active lease per subject: the authoritative concurrency cap.
create unique index if not exists execution_leases_one_active_per_subject
  on prismatix_internal.execution_leases (subject_id)
  where released_at is null;

create table if not exists prismatix_internal.admission_requests (
  subject_id uuid not null,
  window_start timestamptz not null,
  "count" integer not null default 0,
  unique (subject_id, window_start)
);

create index if not exists budget_reservations_subject_state_idx
  on prismatix_internal.budget_reservations (subject_id, state);

create index if not exists execution_leases_expiry_idx
  on prismatix_internal.execution_leases (subject_id, expires_at)
  where released_at is null;

-- ---------------------------------------------------------------------------
-- 2) RLS: service-role only. No anon/authenticated policies exist, so with RLS
--    enabled every client read/write is denied. The tables are not exposed via
--    PostgREST; the public-schema definer RPCs are the only path.
-- ---------------------------------------------------------------------------

alter table prismatix_internal.budget_windows enable row level security;
alter table prismatix_internal.budget_reservations enable row level security;
alter table prismatix_internal.execution_leases enable row level security;
alter table prismatix_internal.admission_requests enable row level security;

revoke all on prismatix_internal.budget_windows from public;
revoke all on prismatix_internal.budget_windows from anon;
revoke all on prismatix_internal.budget_windows from authenticated;
revoke all on prismatix_internal.budget_reservations from public;
revoke all on prismatix_internal.budget_reservations from anon;
revoke all on prismatix_internal.budget_reservations from authenticated;
revoke all on prismatix_internal.execution_leases from public;
revoke all on prismatix_internal.execution_leases from anon;
revoke all on prismatix_internal.execution_leases from authenticated;
revoke all on prismatix_internal.admission_requests from public;
revoke all on prismatix_internal.admission_requests from anon;
revoke all on prismatix_internal.admission_requests from authenticated;

grant select, insert, update, delete on prismatix_internal.budget_windows to service_role;
grant select, insert, update, delete on prismatix_internal.budget_reservations to service_role;
grant select, insert, update, delete on prismatix_internal.execution_leases to service_role;
grant select, insert, update, delete on prismatix_internal.admission_requests to service_role;

-- ---------------------------------------------------------------------------
-- 3) One transactional reserve/admit RPC.
-- ---------------------------------------------------------------------------

create or replace function public.px05_admit_execution(
  p_subject_id uuid,
  p_execution_id uuid,
  p_estimate_usd numeric,
  p_max_usd numeric,
  p_lease_seconds integer,
  p_request_limit integer,
  p_user_daily_usd numeric,
  p_project_daily_usd numeric,
  p_active_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  c_project_subject constant uuid := '00000000-0000-0000-0000-000000000000';
  v_now timestamptz := now();
  v_window_start timestamptz := date_trunc('day', now());
  v_window_end timestamptz := date_trunc('day', now()) + interval '1 day';
  v_minute timestamptz := date_trunc('minute', now());
  v_project prismatix_internal.budget_windows;
  v_user prismatix_internal.budget_windows;
  v_res prismatix_internal.budget_reservations;
  v_lease prismatix_internal.execution_leases;
  v_request_count integer;
  v_active integer;
  v_retry integer;
  v_remaining numeric;
begin
  -- ---- parameter validation (fail closed) --------------------------------
  if p_subject_id is null or p_execution_id is null then
    raise exception 'invalid_admission_identity' using errcode = '22023';
  end if;
  if p_max_usd is null or p_max_usd::text in ('NaN','Infinity','-Infinity') or p_max_usd < 0 then
    raise exception 'invalid_admission_parameters' using errcode = '22023', detail = 'p_max_usd';
  end if;
  if p_estimate_usd is null or p_estimate_usd::text in ('NaN','Infinity','-Infinity')
     or p_estimate_usd < 0 then
    raise exception 'invalid_admission_parameters' using errcode = '22023', detail = 'p_estimate_usd';
  end if;
  if p_user_daily_usd is null or p_user_daily_usd::text in ('NaN','Infinity','-Infinity')
     or p_user_daily_usd <= 0 then
    raise exception 'invalid_admission_parameters' using errcode = '22023', detail = 'p_user_daily_usd';
  end if;
  if p_project_daily_usd is null or p_project_daily_usd::text in ('NaN','Infinity','-Infinity')
     or p_project_daily_usd <= 0 then
    raise exception 'invalid_admission_parameters' using errcode = '22023', detail = 'p_project_daily_usd';
  end if;
  if p_lease_seconds is null or p_lease_seconds <= 0 then
    raise exception 'invalid_admission_parameters' using errcode = '22023', detail = 'p_lease_seconds';
  end if;
  if p_request_limit is null or p_request_limit <= 0 then
    raise exception 'invalid_admission_parameters' using errcode = '22023', detail = 'p_request_limit';
  end if;
  if p_active_limit is null or p_active_limit <= 0 then
    raise exception 'invalid_admission_parameters' using errcode = '22023', detail = 'p_active_limit';
  end if;

  -- ---- lock the PROJECT window first, THEN the USER window (fixed order) ---
  insert into prismatix_internal.budget_windows
    (scope, subject_id, window_start, window_end, limit_usd)
  values ('project', c_project_subject, v_window_start, v_window_end, p_project_daily_usd)
  on conflict (scope, subject_id, window_start)
  do update set limit_usd = excluded.limit_usd, window_end = excluded.window_end;

  select * into v_project
  from prismatix_internal.budget_windows
  where scope = 'project'
    and subject_id = c_project_subject
    and window_start = v_window_start
  for update;

  insert into prismatix_internal.budget_windows
    (scope, subject_id, window_start, window_end, limit_usd)
  values ('user', p_subject_id, v_window_start, v_window_end, p_user_daily_usd)
  on conflict (scope, subject_id, window_start)
  do update set limit_usd = excluded.limit_usd, window_end = excluded.window_end;

  select * into v_user
  from prismatix_internal.budget_windows
  where scope = 'user'
    and subject_id = p_subject_id
    and window_start = v_window_start
  for update;

  v_remaining := greatest(0, least(
    v_user.limit_usd - v_user.committed_usd - v_user.held_usd,
    v_project.limit_usd - v_project.committed_usd - v_project.held_usd
  ));

  -- ---- idempotency: an existing live reservation is reused ----------------
  select * into v_res
  from prismatix_internal.budget_reservations
  where execution_id = p_execution_id;

  if found then
    if v_res.state in ('held','pending_reconcile') then
      select * into v_lease
      from prismatix_internal.execution_leases
      where execution_id = p_execution_id and released_at is null
      order by acquired_at desc
      limit 1;
      return jsonb_build_object(
        'admitted', true, 'reason', 'already_admitted',
        'reservation_id', v_res.id, 'lease_id', v_lease.id,
        'retry_after_seconds', 0, 'remaining_usd', v_remaining);
    end if;
    return jsonb_build_object(
      'admitted', false, 'reason', 'already_settled',
      'reservation_id', v_res.id, 'lease_id', null,
      'retry_after_seconds', 0, 'remaining_usd', v_remaining);
  end if;

  -- ---- per-minute request rate (atomic conditional upsert) ----------------
  insert into prismatix_internal.admission_requests (subject_id, window_start, "count")
  values (p_subject_id, v_minute, 1)
  on conflict (subject_id, window_start)
  do update set "count" = prismatix_internal.admission_requests."count" + 1
  where prismatix_internal.admission_requests."count" < p_request_limit
  returning "count" into v_request_count;

  if v_request_count is null then
    v_retry := greatest(1, ceil(extract(epoch from (v_minute + interval '1 minute' - v_now)))::integer);
    return jsonb_build_object(
      'admitted', false, 'reason', 'rate_limited',
      'reservation_id', null, 'lease_id', null,
      'retry_after_seconds', v_retry, 'remaining_usd', v_remaining);
  end if;

  -- ---- expire stale leases; KEEP monetary holds for uncertain work --------
  with expired as (
    update prismatix_internal.execution_leases
       set released_at = v_now
     where subject_id = p_subject_id
       and released_at is null
       and expires_at <= v_now
    returning execution_id
  )
  update prismatix_internal.budget_reservations r
     set state = 'pending_reconcile', updated_at = v_now
   where r.execution_id in (select execution_id from expired)
     and r.state = 'held';

  -- ---- active-run limit ---------------------------------------------------
  select count(*) into v_active
  from prismatix_internal.execution_leases
  where subject_id = p_subject_id
    and released_at is null
    and expires_at > v_now;

  if v_active >= p_active_limit then
    select greatest(1, ceil(extract(epoch from (min(expires_at) - v_now)))::integer)
      into v_retry
    from prismatix_internal.execution_leases
    where subject_id = p_subject_id
      and released_at is null
      and expires_at > v_now;
    return jsonb_build_object(
      'admitted', false, 'reason', 'active_limit',
      'reservation_id', null, 'lease_id', null,
      'retry_after_seconds', coalesce(v_retry, 1), 'remaining_usd', v_remaining);
  end if;

  -- ---- budget ceiling for BOTH windows ------------------------------------
  if v_project.committed_usd + v_project.held_usd + p_max_usd > v_project.limit_usd
     or v_user.committed_usd + v_user.held_usd + p_max_usd > v_user.limit_usd then
    return jsonb_build_object(
      'admitted', false, 'reason', 'budget_exhausted',
      'reservation_id', null, 'lease_id', null,
      'retry_after_seconds', 0, 'remaining_usd', v_remaining);
  end if;

  -- ---- acquire the lease (partial unique index backstops the cap) ---------
  insert into prismatix_internal.execution_leases
    (subject_id, execution_id, acquired_at, expires_at, heartbeat_at)
  values (p_subject_id, p_execution_id, v_now,
          v_now + make_interval(secs => p_lease_seconds), v_now)
  on conflict (subject_id) where released_at is null do nothing
  returning * into v_lease;

  if v_lease.id is null then
    return jsonb_build_object(
      'admitted', false, 'reason', 'active_limit',
      'reservation_id', null, 'lease_id', null,
      'retry_after_seconds', 1, 'remaining_usd', v_remaining);
  end if;

  -- ---- hold the reservation and increment held_usd on BOTH windows --------
  insert into prismatix_internal.budget_reservations
    (execution_id, subject_id, amount_usd, committed_usd, state)
  values (p_execution_id, p_subject_id, p_max_usd, 0, 'held')
  returning * into v_res;

  update prismatix_internal.budget_windows
     set held_usd = held_usd + p_max_usd
   where id in (v_project.id, v_user.id);

  v_remaining := greatest(0, least(
    v_user.limit_usd - v_user.committed_usd - v_user.held_usd - p_max_usd,
    v_project.limit_usd - v_project.committed_usd - v_project.held_usd - p_max_usd
  ));

  return jsonb_build_object(
    'admitted', true, 'reason', 'admitted',
    'reservation_id', v_res.id, 'lease_id', v_lease.id,
    'retry_after_seconds', 0, 'remaining_usd', v_remaining);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Commit / release RPCs.
-- ---------------------------------------------------------------------------

-- commit moves held -> committed with the actual amount and decrements held.
-- A NULL / negative / nonfinite actual means UNKNOWN or AMBIGUOUS usage: the
-- hold is kept and the reservation becomes `pending_reconcile` (never $0.00,
-- never silently released).
create or replace function public.px05_commit_reservation(
  p_execution_id uuid,
  p_actual_usd numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  c_project_subject constant uuid := '00000000-0000-0000-0000-000000000000';
  v_now timestamptz := now();
  v_res prismatix_internal.budget_reservations;
  v_window_start timestamptz;
  v_committed numeric(12,6);
begin
  if p_execution_id is null then
    raise exception 'invalid_reservation_identity' using errcode = '22023';
  end if;

  select * into v_res
  from prismatix_internal.budget_reservations
  where execution_id = p_execution_id
  for update;

  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;

  if v_res.state in ('committed','released') then
    return jsonb_build_object(
      'state', v_res.state, 'updated', false,
      'reservation_id', v_res.id, 'committed_usd', v_res.committed_usd);
  end if;

  if p_actual_usd is null or p_actual_usd::text in ('NaN','Infinity','-Infinity')
     or p_actual_usd < 0 then
    update prismatix_internal.budget_reservations
       set state = 'pending_reconcile', updated_at = v_now
     where id = v_res.id
    returning * into v_res;
    return jsonb_build_object(
      'state', 'pending_reconcile', 'updated', true,
      'reservation_id', v_res.id, 'committed_usd', v_res.committed_usd);
  end if;

  v_committed := round(p_actual_usd, 6);
  v_window_start := date_trunc('day', v_res.created_at);

  update prismatix_internal.budget_windows
     set held_usd = greatest(0, held_usd - v_res.amount_usd),
         committed_usd = committed_usd + v_committed
   where window_start = v_window_start
     and ((scope = 'user' and subject_id = v_res.subject_id)
          or (scope = 'project' and subject_id = c_project_subject));

  update prismatix_internal.budget_reservations
     set state = 'committed', committed_usd = v_committed, updated_at = v_now
   where id = v_res.id
  returning * into v_res;

  return jsonb_build_object(
    'state', 'committed', 'updated', true,
    'reservation_id', v_res.id, 'committed_usd', v_committed);
end;
$$;

-- release is ONLY for confirmed-zero work (no provider call was made). It
-- decrements held_usd. Never call this for uncertain paid work.
create or replace function public.px05_release_reservation(
  p_execution_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  c_project_subject constant uuid := '00000000-0000-0000-0000-000000000000';
  v_now timestamptz := now();
  v_res prismatix_internal.budget_reservations;
  v_window_start timestamptz;
begin
  if p_execution_id is null then
    raise exception 'invalid_reservation_identity' using errcode = '22023';
  end if;

  select * into v_res
  from prismatix_internal.budget_reservations
  where execution_id = p_execution_id
  for update;

  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;

  if v_res.state in ('committed','released') then
    return jsonb_build_object(
      'state', v_res.state, 'updated', false,
      'reservation_id', v_res.id, 'reason', p_reason);
  end if;

  v_window_start := date_trunc('day', v_res.created_at);

  update prismatix_internal.budget_windows
     set held_usd = greatest(0, held_usd - v_res.amount_usd)
   where window_start = v_window_start
     and ((scope = 'user' and subject_id = v_res.subject_id)
          or (scope = 'project' and subject_id = c_project_subject));

  update prismatix_internal.budget_reservations
     set state = 'released', updated_at = v_now
   where id = v_res.id
  returning * into v_res;

  return jsonb_build_object(
    'state', 'released', 'updated', true,
    'reservation_id', v_res.id, 'reason', p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) RPC grants: service_role only. No client may execute.
-- ---------------------------------------------------------------------------

revoke all on function public.px05_admit_execution(uuid, uuid, numeric, numeric, integer, integer, numeric, numeric, integer) from public;
revoke all on function public.px05_admit_execution(uuid, uuid, numeric, numeric, integer, integer, numeric, numeric, integer) from anon;
revoke all on function public.px05_admit_execution(uuid, uuid, numeric, numeric, integer, integer, numeric, numeric, integer) from authenticated;
grant execute on function public.px05_admit_execution(uuid, uuid, numeric, numeric, integer, integer, numeric, numeric, integer) to service_role;

revoke all on function public.px05_commit_reservation(uuid, numeric) from public;
revoke all on function public.px05_commit_reservation(uuid, numeric) from anon;
revoke all on function public.px05_commit_reservation(uuid, numeric) from authenticated;
grant execute on function public.px05_commit_reservation(uuid, numeric) to service_role;

revoke all on function public.px05_release_reservation(uuid, text) from public;
revoke all on function public.px05_release_reservation(uuid, text) from anon;
revoke all on function public.px05_release_reservation(uuid, text) from authenticated;
grant execute on function public.px05_release_reservation(uuid, text) to service_role;
