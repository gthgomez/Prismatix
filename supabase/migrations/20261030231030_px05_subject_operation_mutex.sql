-- Serialize admission and settlement per subject before they acquire row locks.
-- This keeps admission's project/user-window-first path from deadlocking against
-- settlement's reservation-first path while preserving all existing accounting.
-- Each service RPC operates on one subject and is issued as its own PostgREST
-- request/transaction. Do not batch different subjects' PX05 RPCs in one SQL
-- transaction: transaction-scoped subject locks do not impose a cross-subject
-- order for callers that retain earlier locks across multiple RPC invocations.
create or replace function public.px05_lock_reservation_subject(p_execution_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  v_subject_id uuid;
begin
  if p_execution_id is null then
    raise exception 'invalid_reservation_identity' using errcode = '22023';
  end if;

  -- This lookup intentionally takes no row lock. The transaction advisory lock
  -- serializes all subject-level admission and reservation mutations.
  select subject_id into v_subject_id
  from prismatix_internal.budget_reservations
  where execution_id = p_execution_id;

  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('prismatix-px05:' || v_subject_id::text, 0));
  return v_subject_id;
end;
$$;

revoke all on function public.px05_lock_reservation_subject(uuid) from public;
revoke all on function public.px05_lock_reservation_subject(uuid) from anon;
revoke all on function public.px05_lock_reservation_subject(uuid) from authenticated;
revoke all on function public.px05_lock_reservation_subject(uuid) from service_role;

CREATE OR REPLACE FUNCTION public.px05_admit_execution(p_subject_id uuid, p_execution_id uuid, p_estimate_usd numeric, p_max_usd numeric, p_lease_seconds integer, p_request_limit integer, p_user_daily_usd numeric, p_project_daily_usd numeric, p_active_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'prismatix_internal'
AS $function$
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

  -- Serialize with settlement and other admission expiry for this subject.
  perform pg_advisory_xact_lock(
    hashtextextended('prismatix-px05:' || p_subject_id::text, 0));

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
$function$;

CREATE OR REPLACE FUNCTION public.px05_commit_reservation(p_execution_id uuid, p_actual_usd numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'prismatix_internal'
AS $function$
declare
  c_project_subject constant uuid := '00000000-0000-0000-0000-000000000000';
  v_now timestamptz := now();
  v_res prismatix_internal.budget_reservations;
  v_project prismatix_internal.budget_windows;
  v_user prismatix_internal.budget_windows;
  v_window_start timestamptz;
  v_committed numeric(12,6);
begin
  if p_execution_id is null then
    raise exception 'invalid_reservation_identity' using errcode = '22023';
  end if;

  perform public.px05_lock_reservation_subject(p_execution_id);

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

  -- The execution has terminated: release its concurrency lease in the SAME
  -- transaction (terminal settlement). Lease expiry still never forgives money.
  update prismatix_internal.execution_leases
     set released_at = v_now
   where execution_id = p_execution_id and released_at is null;

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

  -- Fixed lock order: project window THEN user window.
  select * into v_project
  from prismatix_internal.budget_windows
  where scope = 'project' and subject_id = c_project_subject and window_start = v_window_start
  for update;

  select * into v_user
  from prismatix_internal.budget_windows
  where scope = 'user' and subject_id = v_res.subject_id and window_start = v_window_start
  for update;

  update prismatix_internal.budget_windows
     set held_usd = greatest(0, held_usd - v_res.amount_usd),
         committed_usd = committed_usd + v_committed
   where id in (v_project.id, v_user.id);

  update prismatix_internal.budget_reservations
     set state = 'committed', committed_usd = v_committed, updated_at = v_now
   where id = v_res.id
  returning * into v_res;

  return jsonb_build_object(
    'state', 'committed', 'updated', true,
    'reservation_id', v_res.id, 'committed_usd', v_committed);
end;
$function$;

CREATE OR REPLACE FUNCTION public.px05_commit_from_ledger(p_execution_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'prismatix_internal'
AS $function$
declare
  c_project_subject constant uuid := '00000000-0000-0000-0000-000000000000';
  v_now timestamptz := now();
  v_res prismatix_internal.budget_reservations;
  v_project prismatix_internal.budget_windows;
  v_user prismatix_internal.budget_windows;
  v_window_start timestamptz;
  v_calls integer := 0;
  v_pending integer := 0;
  v_total numeric(12,6) := 0;
  v_diff numeric(12,6) := 0;
  v_breached boolean := false;
begin
  if p_execution_id is null then
    raise exception 'invalid_reservation_identity' using errcode = '22023';
  end if;

  perform public.px05_lock_reservation_subject(p_execution_id);

  select * into v_res
  from prismatix_internal.budget_reservations
  where execution_id = p_execution_id
  for update;

  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;

  select
      count(*),
      count(*) filter (where cost_status <> 'settled'),
      coalesce(sum(total_cost) filter (where cost_status = 'settled'), 0)
    into v_calls, v_pending, v_total
  from prismatix_internal.model_calls
  where execution_id = p_execution_id;

  v_total := round(v_total, 6);
  v_window_start := date_trunc('day', v_res.created_at);

  -- Fixed lock order: project window THEN user window.
  select * into v_project
  from prismatix_internal.budget_windows
  where scope = 'project' and subject_id = c_project_subject and window_start = v_window_start
  for update;

  select * into v_user
  from prismatix_internal.budget_windows
  where scope = 'user' and subject_id = v_res.subject_id and window_start = v_window_start
  for update;

  -- 1) Handle already-committed reservation with late-settling calls:
  if v_res.state = 'committed' then
    if v_pending = 0 and v_total <> v_res.committed_usd then
      v_diff := v_total - v_res.committed_usd;
      v_breached := v_total > v_res.amount_usd;

      -- Update budget windows by the delta (adjusted up or down)
      update prismatix_internal.budget_windows
         set committed_usd = greatest(0, committed_usd + v_diff)
       where id in (v_project.id, v_user.id);

      update prismatix_internal.budget_reservations
         set committed_usd = v_total,
             updated_at = v_now
       where id = v_res.id
      returning * into v_res;

      insert into prismatix_internal.reconciliation_jobs (execution_id, kind, payload)
      values (
        p_execution_id,
        'budget_reconciled',
        jsonb_build_object(
          'actual_usd', v_total,
          'diff_usd', v_diff,
          'reservation_amount_usd', v_res.amount_usd,
          'budget_breached', v_breached,
          'reason', case when v_diff > 0 then 'late_call_settlement_up' else 'late_call_settlement_down' end
        )
      );

      return jsonb_build_object(
        'state', 'committed', 'updated', true,
        'reservation_id', v_res.id, 'committed_usd', v_res.committed_usd,
        'budget_breached', v_breached,
        'reason', 'late_settlement_reconciled');
    end if;

    -- Already reconciled and matching actuals => idempotent no-op
    return jsonb_build_object(
      'state', v_res.state, 'updated', false,
      'reservation_id', v_res.id, 'committed_usd', v_res.committed_usd);
  end if;

  if v_res.state = 'released' then
    return jsonb_build_object(
      'state', v_res.state, 'updated', false,
      'reservation_id', v_res.id, 'committed_usd', v_res.committed_usd);
  end if;

  -- Terminal settlement: release the execution lease in the same transaction.
  update prismatix_internal.execution_leases
     set released_at = v_now
   where execution_id = p_execution_id and released_at is null;

  if v_pending > 0 then
    update prismatix_internal.budget_reservations
       set state = 'pending_reconcile', updated_at = v_now
     where id = v_res.id
    returning * into v_res;
    return jsonb_build_object(
      'state', 'pending_reconcile', 'updated', true,
      'reservation_id', v_res.id, 'committed_usd', v_res.committed_usd,
      'calls', v_calls, 'pending_calls', v_pending);
  end if;

  if v_calls = 0 then
    -- No metered dispatch at all => confirmed-zero work => release.
    update prismatix_internal.budget_windows
       set held_usd = greatest(0, held_usd - v_res.amount_usd)
     where id in (v_project.id, v_user.id);
    update prismatix_internal.budget_reservations
       set state = 'released', updated_at = v_now
     where id = v_res.id
    returning * into v_res;
    return jsonb_build_object(
      'state', 'released', 'updated', true,
      'reservation_id', v_res.id, 'committed_usd', 0,
      'reason', 'confirmed_zero_calls');
  end if;

  -- All calls settled authoritatively: commit actual total (truthful, not silently clamped).
  v_breached := v_total > v_res.amount_usd;
  update prismatix_internal.budget_windows
     set held_usd = greatest(0, held_usd - v_res.amount_usd),
         committed_usd = committed_usd + v_total
   where id in (v_project.id, v_user.id);

  update prismatix_internal.budget_reservations
     set state = 'committed', committed_usd = v_total, updated_at = v_now
   where id = v_res.id
  returning * into v_res;

  if v_breached then
    insert into prismatix_internal.reconciliation_jobs (execution_id, kind, payload)
    values (
      p_execution_id,
      'budget_breached',
      jsonb_build_object(
        'actual_usd', v_total,
        'reservation_amount_usd', v_res.amount_usd,
        'excess_usd', v_total - v_res.amount_usd
      )
    );
  end if;

  return jsonb_build_object(
    'state', 'committed', 'updated', true,
    'reservation_id', v_res.id, 'committed_usd', v_total,
    'budget_breached', v_breached,
    'basis', 'settled',
    'calls', v_calls);
end;
$function$;

CREATE OR REPLACE FUNCTION public.px05_commit_estimated(p_execution_id uuid, p_estimated_usd numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'prismatix_internal'
AS $function$
declare
  c_project_subject constant uuid := '00000000-0000-0000-0000-000000000000';
  v_now timestamptz := now();
  v_res prismatix_internal.budget_reservations;
  v_project prismatix_internal.budget_windows;
  v_user prismatix_internal.budget_windows;
  v_window_start timestamptz;
  v_calls integer := 0;
  v_settled integer := 0;
  v_pending integer := 0;
  v_unpriced integer := 0;
  v_settled_sum numeric(12,6) := 0;
  v_committed numeric(12,6);
begin
  if p_execution_id is null then
    raise exception 'invalid_reservation_identity' using errcode = '22023';
  end if;

  perform public.px05_lock_reservation_subject(p_execution_id);

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

  -- Terminal settlement: release the execution lease in the same transaction.
  update prismatix_internal.execution_leases
     set released_at = v_now
   where execution_id = p_execution_id and released_at is null;

  select
      count(*),
      count(*) filter (where cost_status = 'settled'),
      count(*) filter (where cost_status <> 'settled'),
      count(*) filter (where cost_status <> 'settled' and price_snapshot is null),
      coalesce(sum(total_cost) filter (where cost_status = 'settled'), 0)
    into v_calls, v_settled, v_pending, v_unpriced, v_settled_sum
  from prismatix_internal.model_calls
  where execution_id = p_execution_id;

  v_window_start := date_trunc('day', v_res.created_at);

  -- Fixed lock order: project window THEN user window.
  select * into v_project
  from prismatix_internal.budget_windows
  where scope = 'project' and subject_id = c_project_subject and window_start = v_window_start
  for update;

  select * into v_user
  from prismatix_internal.budget_windows
  where scope = 'user' and subject_id = v_res.subject_id and window_start = v_window_start
  for update;

  -- 1) No metered dispatch at all => confirmed-zero => release.
  if v_calls = 0 then
    update prismatix_internal.budget_windows
       set held_usd = greatest(0, held_usd - v_res.amount_usd)
     where id in (v_project.id, v_user.id);
    update prismatix_internal.budget_reservations
       set state = 'released', updated_at = v_now
     where id = v_res.id
    returning * into v_res;
    return jsonb_build_object(
      'state', 'released', 'updated', true,
      'reservation_id', v_res.id, 'reason', 'confirmed_zero_calls');
  end if;

  -- 2) All calls are settled authoritatively (no pending calls).
  if v_settled > 0 and v_pending = 0 then
    v_committed := round(v_settled_sum, 6);
    update prismatix_internal.budget_windows
       set held_usd = greatest(0, held_usd - v_res.amount_usd),
           committed_usd = committed_usd + v_committed
     where id in (v_project.id, v_user.id);
    update prismatix_internal.budget_reservations
       set state = 'committed', committed_usd = v_committed, updated_at = v_now
     where id = v_res.id
    returning * into v_res;
    return jsonb_build_object(
      'state', 'committed', 'updated', true,
      'reservation_id', v_res.id, 'committed_usd', v_committed, 'basis', 'settled');
  end if;

  -- 3) Unknown price on any pending call: never estimate, never $0.
  if v_unpriced > 0 then
    update prismatix_internal.budget_reservations
       set state = 'pending_reconcile', updated_at = v_now
     where id = v_res.id
    returning * into v_res;
    return jsonb_build_object(
      'state', 'pending_reconcile', 'updated', true,
      'reservation_id', v_res.id, 'committed_usd', v_res.committed_usd,
      'basis', 'unknown_price');
  end if;

  -- 4) Pending calls exist, but all pending calls are priced.
  -- WHOLE-EXECUTION ESTIMATE CONTRACT:
  -- p_estimated_usd represents the total modeled cost for the entire execution.
  -- v_committed is at least the already settled calls, at most the reservation ceiling.
  if v_pending > 0 then
    if p_estimated_usd is null or p_estimated_usd <= 0 then
      -- Without a positive estimate, keep the hold as pending_reconcile.
      update prismatix_internal.budget_reservations
         set state = 'pending_reconcile', updated_at = v_now
       where id = v_res.id
      returning * into v_res;
      return jsonb_build_object(
        'state', 'pending_reconcile', 'updated', true,
        'reservation_id', v_res.id, 'committed_usd', v_res.committed_usd,
        'basis', 'pending_priced_calls');
    end if;

    v_committed := round(least(v_res.amount_usd, greatest(v_settled_sum, p_estimated_usd)), 6);
    update prismatix_internal.budget_windows
       set held_usd = greatest(0, held_usd - v_res.amount_usd),
           committed_usd = committed_usd + v_committed
     where id in (v_project.id, v_user.id);

    update prismatix_internal.budget_reservations
       set state = 'committed', committed_usd = v_committed, updated_at = v_now
     where id = v_res.id
    returning * into v_res;

    insert into prismatix_internal.reconciliation_jobs (execution_id, kind, payload)
    values (
      p_execution_id,
      'budget_estimated',
      jsonb_build_object(
        'provenance', case when v_settled > 0 then 'estimated_partial_provider_usage' else 'estimated_no_provider_usage' end,
        'whole_execution_estimate_usd', p_estimated_usd,
        'settled_sum', v_settled_sum,
        'committed_usd', v_committed,
        'pending_calls', v_pending,
        'settled_calls', v_settled
      )
    );

    return jsonb_build_object(
      'state', 'committed', 'updated', true,
      'reservation_id', v_res.id, 'committed_usd', v_committed,
      'basis', 'estimated');
  end if;

  -- Default fallback: keep hold
  update prismatix_internal.budget_reservations
     set state = 'pending_reconcile', updated_at = v_now
   where id = v_res.id
  returning * into v_res;
  return jsonb_build_object(
    'state', 'pending_reconcile', 'updated', true,
    'reservation_id', v_res.id, 'committed_usd', v_res.committed_usd);
end;
$function$;

CREATE OR REPLACE FUNCTION public.px05_release_reservation(p_execution_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'prismatix_internal'
AS $function$
declare
  c_project_subject constant uuid := '00000000-0000-0000-0000-000000000000';
  v_now timestamptz := now();
  v_res prismatix_internal.budget_reservations;
  v_project prismatix_internal.budget_windows;
  v_user prismatix_internal.budget_windows;
  v_window_start timestamptz;
  v_calls integer := 0;
begin
  if p_execution_id is null then
    raise exception 'invalid_reservation_identity' using errcode = '22023';
  end if;

  perform public.px05_lock_reservation_subject(p_execution_id);

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

  -- Terminal settlement: release the execution lease in the same transaction.
  update prismatix_internal.execution_leases
     set released_at = v_now
   where execution_id = p_execution_id and released_at is null;

  -- GUARD: uncertain work is never released.
  if v_res.state = 'pending_reconcile' then
    return jsonb_build_object(
      'state', 'pending_reconcile', 'updated', false,
      'reservation_id', v_res.id,
      'reason', coalesce(nullif(p_reason, ''), 'uncertain_work'));
  end if;

  -- GUARD: verify no billable provider calls exist in model_calls.
  select count(*) into v_calls
  from prismatix_internal.model_calls
  where execution_id = p_execution_id;

  if v_calls > 0 then
    -- Dispatched or completed calls exist. Work is NOT confirmed-zero.
    -- Fail-closed: keep the hold and mark pending_reconcile.
    update prismatix_internal.budget_reservations
       set state = 'pending_reconcile', updated_at = v_now
     where id = v_res.id
    returning * into v_res;
    return jsonb_build_object(
      'state', 'pending_reconcile', 'updated', true,
      'reservation_id', v_res.id,
      'reason', 'uncertain_dispatched_work');
  end if;

  v_window_start := date_trunc('day', v_res.created_at);

  -- Fixed lock order: project window THEN user window.
  select * into v_project
  from prismatix_internal.budget_windows
  where scope = 'project' and subject_id = c_project_subject and window_start = v_window_start
  for update;

  select * into v_user
  from prismatix_internal.budget_windows
  where scope = 'user' and subject_id = v_res.subject_id and window_start = v_window_start
  for update;

  update prismatix_internal.budget_windows
     set held_usd = greatest(0, held_usd - v_res.amount_usd)
   where id in (v_project.id, v_user.id);

  update prismatix_internal.budget_reservations
     set state = 'released', updated_at = v_now
   where id = v_res.id
  returning * into v_res;

  return jsonb_build_object(
    'state', 'released', 'updated', true,
    'reservation_id', v_res.id, 'reason', p_reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.px05_reconcile_reservation(p_execution_id uuid, p_actual_usd numeric, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'prismatix_internal'
AS $function$
declare
  c_project_subject constant uuid := '00000000-0000-0000-0000-000000000000';
  v_now timestamptz := now();
  v_res prismatix_internal.budget_reservations;
  v_project prismatix_internal.budget_windows;
  v_user prismatix_internal.budget_windows;
  v_window_start timestamptz;
  v_committed numeric(12,6);
begin
  if p_execution_id is null then
    raise exception 'invalid_reservation_identity' using errcode = '22023';
  end if;

  perform public.px05_lock_reservation_subject(p_execution_id);

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

  -- Terminal settlement: release the execution lease in the same transaction.
  update prismatix_internal.execution_leases
     set released_at = v_now
   where execution_id = p_execution_id and released_at is null;

  if p_actual_usd is null or p_actual_usd::text in ('NaN','Infinity','-Infinity')
     or p_actual_usd < 0 then
    update prismatix_internal.budget_reservations
       set state = 'pending_reconcile', updated_at = v_now
     where id = v_res.id
    returning * into v_res;
    return jsonb_build_object(
      'state', 'pending_reconcile', 'updated', true,
      'reservation_id', v_res.id, 'reason', p_reason);
  end if;

  v_window_start := date_trunc('day', v_res.created_at);

  -- Fixed lock order: project window THEN user window.
  select * into v_project
  from prismatix_internal.budget_windows
  where scope = 'project' and subject_id = c_project_subject and window_start = v_window_start
  for update;

  select * into v_user
  from prismatix_internal.budget_windows
  where scope = 'user' and subject_id = v_res.subject_id and window_start = v_window_start
  for update;

  if p_actual_usd = 0 then
    update prismatix_internal.budget_windows
       set held_usd = greatest(0, held_usd - v_res.amount_usd)
     where id in (v_project.id, v_user.id);
    update prismatix_internal.budget_reservations
       set state = 'released', updated_at = v_now
     where id = v_res.id
    returning * into v_res;
  else
    v_committed := round(p_actual_usd, 6);
    update prismatix_internal.budget_windows
       set held_usd = greatest(0, held_usd - v_res.amount_usd),
           committed_usd = committed_usd + v_committed
     where id in (v_project.id, v_user.id);
    update prismatix_internal.budget_reservations
       set state = 'committed', committed_usd = v_committed, updated_at = v_now
     where id = v_res.id
    returning * into v_res;
  end if;

  insert into prismatix_internal.reconciliation_jobs (execution_id, kind, payload)
  values (
    p_execution_id,
    'budget_reconciled',
    jsonb_build_object('actual_usd', p_actual_usd, 'reason', p_reason)
  );

  return jsonb_build_object(
    'state', v_res.state, 'updated', true,
    'reservation_id', v_res.id, 'committed_usd', v_res.committed_usd,
    'reason', p_reason);
end;
$function$;
