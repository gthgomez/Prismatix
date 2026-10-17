-- 20261018000000_debate_settlement_and_continuity.sql
-- Forward migration for Debate Mode end-to-end repair:
-- 1. A1: Repair premature settlement in px05_commit_estimated and px05_commit_from_ledger.
--    - When other calls remain pending, do not commit as settled or drop pending work.
--    - Provide explicit 'estimated' basis with provenance audit row in reconciliation_jobs.
--    - Allow px05_commit_from_ledger to true up commitments when late-settling calls complete.
-- 2. A2: Repair reservation release safety in px05_release_reservation.
--    - Disallow releasing reservations when model_calls rows exist (uncertain paid work).
--    - Keep hold and mark pending_reconcile.
-- 3. D3: Persist debate metadata and participant state in public.messages.
--    - Add metadata jsonb column to public.messages.
--    - Update public.px07_persist_message to accept and persist p_metadata jsonb.

-- ---------------------------------------------------------------------------
-- 1) Messages table: add metadata column
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object');

-- ---------------------------------------------------------------------------
-- 2) Update public.px07_persist_message with metadata support
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
  p_legacy_image_url text default null,
  p_metadata jsonb default '{}'::jsonb
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

  -- validate every attachment element.
  for v_att in select value from jsonb_array_elements(v_attachments) loop
    v_kind := v_att->>'kind';
    if v_kind not in ('image', 'file', 'video') then
      raise exception 'invalid_attachment' using errcode = '22023';
    end if;

    if v_kind = 'image' then
      v_storage_ref := v_att->>'storageRef';
      if v_storage_ref is not null then
        if v_storage_ref not like 'supabase://attachments/' || p_subject_id::text || '/%' then
          raise exception 'invalid_attachment' using errcode = '22023';
        end if;
        v_path := substr(v_storage_ref, length('supabase://attachments/') + 1);
        if not exists (
          select 1
            from storage.objects
           where bucket_id = 'attachments'
             and name = v_path
             and owner = p_subject_id
        ) then
          raise exception 'attachment_not_found' using errcode = '22023';
        end if;
      end if;
    elsif v_kind = 'video' then
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
           when p_role = 'user' and (title is null or title = 'New Chat') then
             substr(trim(regexp_replace(p_content, '\s+', ' ', 'g')), 1, 60)
           else title
         end,
         total_tokens = total_tokens + greatest(coalesce(p_token_count, 0), 0)
   where id = p_conversation_id;

  return jsonb_build_object('message_id', v_message.id, 'inserted', true);
end;
$$;

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
-- 4) A1: px05_commit_estimated and px05_commit_from_ledger true-up
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
  -- Commit a conservative, reservation-capped estimate covering settled calls
  -- plus the estimated pending cost. Provenance is explicitly 'estimated'.
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

    v_committed := round(least(v_settled_sum + p_estimated_usd, v_res.amount_usd), 6);
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
        'estimated_usd', p_estimated_usd,
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
  v_committed numeric(12,6);
  v_additional numeric(12,6) := 0;
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

  -- Handle already-committed reservation with late-settling calls:
  if v_res.state = 'committed' then
    if v_pending = 0 and round(v_total, 6) > v_res.committed_usd then
      v_additional := least(round(v_total, 6), v_res.amount_usd) - v_res.committed_usd;
      if v_additional > 0 then
        update prismatix_internal.budget_windows
           set committed_usd = committed_usd + v_additional
         where id in (v_project.id, v_user.id);

        update prismatix_internal.budget_reservations
           set committed_usd = v_res.committed_usd + v_additional,
               updated_at = v_now
         where id = v_res.id
        returning * into v_res;

        insert into prismatix_internal.reconciliation_jobs (execution_id, kind, payload)
        values (
          p_execution_id,
          'budget_reconciled',
          jsonb_build_object('actual_usd', v_res.committed_usd, 'additional_usd', v_additional, 'reason', 'late_call_settlement')
        );

        return jsonb_build_object(
          'state', 'committed', 'updated', true,
          'reservation_id', v_res.id, 'committed_usd', v_res.committed_usd,
          'reason', 'late_settlement_reconciled');
      end if;
    end if;

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

  -- All calls settled authoritatively: commit the total.
  v_committed := round(least(v_total, v_res.amount_usd), 6);
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
    'reservation_id', v_res.id, 'committed_usd', v_committed,
    'calls', v_calls);
end;
$$;

revoke all on function public.px05_commit_from_ledger(uuid) from public;
revoke all on function public.px05_commit_from_ledger(uuid) from anon;
revoke all on function public.px05_commit_from_ledger(uuid) from authenticated;
grant execute on function public.px05_commit_from_ledger(uuid) to service_role;
