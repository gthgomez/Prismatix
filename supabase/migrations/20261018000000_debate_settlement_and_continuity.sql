-- 20261018000000_debate_settlement_and_continuity.sql
-- Forward migration for Debate Mode end-to-end repair:
-- 1. A1: Repair premature settlement in px05_commit_estimated and px05_commit_from_ledger.
--    - Enforce whole-execution estimate contract (p_estimated_usd is whole execution, never added to settled sum).
--    - Provide explicit 'estimated' basis with provenance audit row in reconciliation_jobs.
--    - Allow px05_commit_from_ledger to true up commitments when late-settling calls complete (both up and down).
--    - Truthfully record and audit budget breaches (never silently clamp actual charges).
-- 2. A2: Repair reservation release safety in px05_release_reservation.
--    - Disallow releasing reservations when model_calls rows exist (uncertain paid work).
--    - Keep hold and mark pending_reconcile.
-- 3. PX07 & D3: Persist debate metadata while preserving exact PX07 attachment validation contract.
--    - Add metadata jsonb column to public.messages.
--    - Implement canonical 10-argument public.px07_persist_message with strict attachment validation.
--    - Implement backward-compatible 9-argument public.px07_persist_message wrapper with default params.

-- ---------------------------------------------------------------------------
-- 1) Messages table: add metadata column
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object');

-- ---------------------------------------------------------------------------
-- 2) Canonical 10-arg public.px07_persist_message with metadata support
-- ---------------------------------------------------------------------------
create or replace function public.px07_persist_message(
  p_subject_id uuid,
  p_conversation_id uuid,
  p_execution_id uuid,
  p_role text,
  p_content text,
  p_token_count integer,
  p_model_used text,
  p_attachments jsonb,
  p_legacy_image_url text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_existing public.messages;
  v_message public.messages;
  v_conv_owner uuid;
  v_att jsonb;
  v_kind text;
  v_storage_ref text;
  v_video_id uuid;
  v_path text;
begin
  if p_role is null or p_role not in ('user', 'assistant') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_subject_id is null or p_conversation_id is null or p_execution_id is null then
    raise exception 'invalid_message_identity' using errcode = '22023';
  end if;
  if jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'invalid_attachment' using errcode = '22023';
  end if;
  if jsonb_array_length(v_attachments) > 16 then
    raise exception 'invalid_attachment' using errcode = '22023';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'invalid_metadata' using errcode = '22023';
  end if;

  -- conversation: create it for a user message, require ownership otherwise.
  select user_id into v_conv_owner
    from public.conversations
   where id = p_conversation_id;

  if not found and p_role = 'user' then
    insert into public.conversations (id, user_id)
    values (p_conversation_id, p_subject_id)
    on conflict (id) do nothing;

    select user_id into v_conv_owner
      from public.conversations
     where id = p_conversation_id;
  end if;

  if v_conv_owner is null or v_conv_owner <> p_subject_id then
    raise exception 'invalid_conversation' using errcode = '22023';
  end if;

  -- the execution must belong to the subject and this conversation (or be
  -- conversation-independent, i.e. conversation_id is null).
  perform 1
    from prismatix_internal.executions
   where id = p_execution_id
     and subject_id = p_subject_id
     and (conversation_id = p_conversation_id or conversation_id is null);
  if not found then
    raise exception 'invalid_execution' using errcode = '22023';
  end if;

  -- idempotency: replay with identical content/attachments returns the row.
  select * into v_existing
    from public.messages
   where execution_id = p_execution_id
     and role = p_role
   limit 1;

  if found then
    if v_existing.content is not distinct from p_content
       and v_existing.attachments = v_attachments then
      return jsonb_build_object('message_id', v_existing.id, 'inserted', false);
    end if;
    raise exception 'message_conflict' using errcode = 'PT409';
  end if;

  -- validate every attachment element (preserves exact PX07 contract)
  for v_att in select value from jsonb_array_elements(v_attachments) loop
    v_kind := v_att->>'kind';
    if v_kind is null or v_kind not in ('image', 'video', 'file') then
      raise exception 'invalid_attachment' using errcode = '22023';
    end if;

    -- `file` entries are text/code metadata only (name/size); their content is
    -- never persisted and there is no object to validate.
    if v_kind = 'file' then
      if coalesce(v_att->>'name', '') = ''
         or length(v_att->>'name') > 512 then
        raise exception 'invalid_attachment' using errcode = '22023';
      end if;
      continue;
    end if;

    if v_kind = 'image' then
      v_storage_ref := v_att->>'storageRef';
      if v_storage_ref is not null and length(v_storage_ref) > 2048 then
        raise exception 'invalid_attachment' using errcode = '22023';
      end if;
      if v_storage_ref is null
         or v_storage_ref not like 'supabase://chat-uploads/%' then
        raise exception 'invalid_attachment' using errcode = '22023';
      end if;
      v_path := substring(v_storage_ref from '^supabase://chat-uploads/(.+)$');
      if v_path is null or not starts_with(v_path, p_subject_id::text || '/') then
        raise exception 'invalid_attachment' using errcode = '22023';
      end if;
    else
      begin
        v_video_id := (v_att->>'videoAssetId')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid_attachment' using errcode = '22023';
      end;
      if v_video_id is null then
        raise exception 'invalid_attachment' using errcode = '22023';
      end if;
      perform 1
        from public.video_assets
       where id = v_video_id
         and user_id = p_subject_id;
      if not found then
        raise exception 'invalid_attachment' using errcode = '22023';
      end if;
    end if;
  end loop;

  insert into public.messages (
    conversation_id, role, content, token_count, model_used, image_url,
    execution_id, attachments, metadata
  ) values (
    p_conversation_id, p_role, p_content, greatest(coalesce(p_token_count, 0), 0),
    p_model_used, p_legacy_image_url, p_execution_id, v_attachments, v_metadata
  )
  on conflict (execution_id, role) where execution_id is not null do nothing
  returning * into v_message;

  if v_message.id is null then
    -- concurrent insert: re-read and reconcile exactly as above.
    select * into v_existing
      from public.messages
     where execution_id = p_execution_id
       and role = p_role
     limit 1;
    if found
       and v_existing.content is not distinct from p_content
       and v_existing.attachments = v_attachments then
      return jsonb_build_object('message_id', v_existing.id, 'inserted', false);
    end if;
    raise exception 'message_conflict' using errcode = 'PT409';
  end if;

  -- only a real insert advances activity, title, and the token counter.
  update public.conversations
     set last_activity_at = now(),
         title = case
                   when p_role = 'user' then coalesce(title, left(p_content, 120))
                   else title
                 end
   where id = p_conversation_id;

  perform public.increment_token_count_for_user(
    p_conversation_id, p_subject_id, greatest(coalesce(p_token_count, 0), 0)
  );

  return jsonb_build_object('message_id', v_message.id, 'inserted', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2b) Backward-compatible 9-arg wrapper for existing callers
-- ---------------------------------------------------------------------------
create or replace function public.px07_persist_message(
  p_subject_id uuid,
  p_conversation_id uuid,
  p_execution_id uuid,
  p_role text,
  p_content text,
  p_token_count integer,
  p_model_used text,
  p_attachments jsonb default '[]'::jsonb,
  p_legacy_image_url text default null
)
returns jsonb
language sql
security definer
set search_path = public, prismatix_internal
as $$
  select public.px07_persist_message(
    p_subject_id,
    p_conversation_id,
    p_execution_id,
    p_role,
    p_content,
    p_token_count,
    p_model_used,
    coalesce(p_attachments, '[]'::jsonb),
    p_legacy_image_url,
    '{}'::jsonb
  );
$$;

revoke all on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text) from public;
revoke all on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text) from anon;
revoke all on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text) from authenticated;
grant execute on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text) to service_role;

revoke all on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text, jsonb) from public;
revoke all on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text, jsonb) from anon;
revoke all on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text, jsonb) from authenticated;
grant execute on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3) A2: px05_release_reservation with active-call protection
-- ---------------------------------------------------------------------------
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
  v_project prismatix_internal.budget_windows;
  v_user prismatix_internal.budget_windows;
  v_window_start timestamptz;
  v_calls integer := 0;
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
$$;

revoke all on function public.px05_release_reservation(uuid, text) from public;
revoke all on function public.px05_release_reservation(uuid, text) from anon;
revoke all on function public.px05_release_reservation(uuid, text) from authenticated;
grant execute on function public.px05_release_reservation(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4) A1: px05_commit_estimated with whole-execution estimate contract
-- ---------------------------------------------------------------------------
create or replace function public.px05_commit_estimated(
  p_execution_id uuid,
  p_estimated_usd numeric
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
$$;

revoke all on function public.px05_commit_estimated(uuid, numeric) from public;
revoke all on function public.px05_commit_estimated(uuid, numeric) from anon;
revoke all on function public.px05_commit_estimated(uuid, numeric) from authenticated;
grant execute on function public.px05_commit_estimated(uuid, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Update px05_commit_from_ledger with late-settlement true-up capability
-- ---------------------------------------------------------------------------
create or replace function public.px05_commit_from_ledger(p_execution_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
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
$$;

revoke all on function public.px05_commit_from_ledger(uuid) from public;
revoke all on function public.px05_commit_from_ledger(uuid) from anon;
revoke all on function public.px05_commit_from_ledger(uuid) from authenticated;
grant execute on function public.px05_commit_from_ledger(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5) px03_record_model_call: guard against late dispatches after finalization
-- ---------------------------------------------------------------------------
create or replace function public.px03_record_model_call(
  p_execution_id uuid,
  p_stage text,
  p_participant text,
  p_attempt_number integer default 1,
  p_requested_model text default null,
  p_resolved_model text default null,
  p_served_model text default null,
  p_upstream_request_id text default null,
  p_status text default null,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_thinking_tokens integer default 0,
  p_input_cost numeric default 0,
  p_output_cost numeric default 0,
  p_thinking_cost numeric default 0,
  p_total_cost numeric default 0,
  p_price_snapshot jsonb default null,
  p_cost_status text default 'pending'
)
returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  v_row prismatix_internal.model_calls;
begin
  if p_cost_status not in ('settled','pending','estimated_legacy') then
    raise exception 'invalid_cost_status' using errcode = '22023';
  end if;
  if p_attempt_number is null or p_attempt_number < 1 then
    raise exception 'invalid_attempt_number' using errcode = '22023';
  end if;

  -- Guard against late dispatches after terminal settlement:
  -- Updates to existing rows (e.g. settling late usage) are allowed,
  -- but new dispatches on a finalized execution are rejected.
  if p_status = 'dispatched' and exists (
    select 1 from prismatix_internal.executions
     where id = p_execution_id
       and terminal_outcome is not null
  ) and not exists (
    select 1 from prismatix_internal.model_calls
     where execution_id = p_execution_id
       and stage = p_stage
       and participant = p_participant
       and attempt_number = p_attempt_number
  ) then
    raise exception 'execution_already_finalized' using errcode = '22023';
  end if;

  insert into prismatix_internal.model_calls (
    execution_id, stage, participant, attempt_number,
    requested_model, resolved_model, served_model, upstream_request_id, status,
    input_tokens, output_tokens, thinking_tokens,
    input_cost, output_cost, thinking_cost, total_cost,
    price_snapshot, cost_status
  ) values (
    p_execution_id, p_stage, p_participant, p_attempt_number,
    p_requested_model, p_resolved_model, p_served_model, p_upstream_request_id, p_status,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), coalesce(p_thinking_tokens, 0),
    coalesce(p_input_cost, 0), coalesce(p_output_cost, 0), coalesce(p_thinking_cost, 0),
    coalesce(p_total_cost, 0),
    p_price_snapshot, p_cost_status
  )
  on conflict (execution_id, stage, participant, attempt_number) do update set
    requested_model = excluded.requested_model,
    resolved_model = excluded.resolved_model,
    served_model = excluded.served_model,
    upstream_request_id = excluded.upstream_request_id,
    status = excluded.status,
    input_tokens = excluded.input_tokens,
    output_tokens = excluded.output_tokens,
    thinking_tokens = excluded.thinking_tokens,
    input_cost = excluded.input_cost,
    output_cost = excluded.output_cost,
    thinking_cost = excluded.thinking_cost,
    total_cost = excluded.total_cost,
    price_snapshot = excluded.price_snapshot,
    cost_status = excluded.cost_status
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.px03_record_model_call(uuid, text, text, integer, text, text, text, text, text, integer, integer, integer, numeric, numeric, numeric, numeric, jsonb, text) from public;
revoke all on function public.px03_record_model_call(uuid, text, text, integer, text, text, text, text, text, integer, integer, integer, numeric, numeric, numeric, numeric, jsonb, text) from anon;
revoke all on function public.px03_record_model_call(uuid, text, text, integer, text, text, text, text, text, integer, integer, integer, numeric, numeric, numeric, numeric, jsonb, text) from authenticated;
grant execute on function public.px03_record_model_call(uuid, text, text, integer, text, text, text, text, text, integer, integer, integer, numeric, numeric, numeric, numeric, jsonb, text) to service_role;
