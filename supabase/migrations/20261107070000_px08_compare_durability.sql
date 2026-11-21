-- PX08: durable Compare groups without granting clients authority over messages.
-- Messages and execution receipts remain immutable server-authored records.

create table if not exists public.compare_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  execution_a uuid not null references prismatix_internal.executions(id) on delete cascade,
  execution_b uuid not null references prismatix_internal.executions(id) on delete cascade,
  compare_identity uuid not null,
  preferred_side text check (preferred_side in ('A', 'B')),
  preference_updated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint compare_groups_distinct_executions check (execution_a <> execution_b),
  constraint compare_groups_identity unique (conversation_id, execution_a, execution_b),
  constraint compare_groups_one_pair_per_request unique (conversation_id, compare_identity)
);

alter table public.compare_groups enable row level security;
drop policy if exists compare_groups_select_own on public.compare_groups;
create policy compare_groups_select_own on public.compare_groups
  for select to authenticated using (user_id = auth.uid());
revoke all on public.compare_groups from public, anon, authenticated;
grant select on public.compare_groups to authenticated;

-- Only the authenticated owner may link two executions already in this conversation.
-- The client supplies identities only; all displayed result and cost data comes from
-- immutable assistant messages and the execution ledger.
create or replace function public.px08_persist_compare(
  p_conversation_id uuid,
  p_execution_a uuid,
  p_execution_b uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  v_user uuid := auth.uid();
  v_group public.compare_groups;
  v_result jsonb;
  v_compare_identity uuid;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_execution_a is null or p_execution_b is null or p_execution_a = p_execution_b then
    raise exception 'invalid_compare_identity' using errcode = '22023';
  end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id and c.user_id = v_user) then
    raise exception 'invalid_conversation' using errcode = '42501';
  end if;
  if (select count(*) from prismatix_internal.executions e
       where e.id in (p_execution_a, p_execution_b)
         and e.subject_id = v_user and e.conversation_id = p_conversation_id
         and e.requested_mode like 'compare:%') <> 2
     or (select count(distinct e.requested_mode) from prismatix_internal.executions e
          where e.id in (p_execution_a, p_execution_b)
            and e.subject_id = v_user and e.conversation_id = p_conversation_id) <> 1 then
    raise exception 'invalid_execution' using errcode = '42501';
  end if;
  select substring(e.requested_mode from '^compare:([0-9a-fA-F-]{36})$')::uuid
    into v_compare_identity
    from prismatix_internal.executions e
   where e.id = p_execution_a;
  if v_compare_identity is null then
    raise exception 'invalid_compare_identity' using errcode = '42501';
  end if;

  insert into public.compare_groups(user_id, conversation_id, execution_a, execution_b, compare_identity)
  values (v_user, p_conversation_id, p_execution_a, p_execution_b, v_compare_identity)
  on conflict do nothing;

  select * into v_group from public.compare_groups g
   where g.conversation_id = p_conversation_id and g.compare_identity = v_compare_identity;
  if not found or not (
    (v_group.execution_a = p_execution_a and v_group.execution_b = p_execution_b)
    or (v_group.execution_a = p_execution_b and v_group.execution_b = p_execution_a)
  ) then
    raise exception 'compare_identity_conflict' using errcode = '22023';
  end if;

  -- Keep the first durable ordering, but return the requested ordering so a
  -- replay with swapped arguments still gets the expected modelA/modelB sides.
  v_result := jsonb_build_object(
    'id', v_group.id,
    'conversationId', v_group.conversation_id,
    'preferredSide', v_group.preferred_side,
    'modelA', public.px08_compare_child(p_execution_a, p_conversation_id),
    'modelB', public.px08_compare_child(p_execution_b, p_conversation_id)
  );
  return v_result;
end;
$$;

create or replace function public.px08_compare_child(p_execution_id uuid, p_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, prismatix_internal
as $$
  select jsonb_build_object(
    'executionId', e.id,
    'model', coalesce(e.served_model, e.resolved_model, e.requested_model, m.model_used),
    'content', m.content,
    'assistantMessageId', m.id,
    'status', case e.status
      when 'completed' then case when m.id is null then 'interrupted' else 'completed' end
      when 'cancelled' then 'stopped'
      when 'failed' then 'failed'
      else 'interrupted'
    end,
    'cost', c.cost,
    'costStatus', c.cost_status,
    'transcriptSaved', m.id is not null
  )
  from prismatix_internal.executions e
  left join lateral (
    select message.id, message.content, message.model_used
      from public.messages message
     where message.execution_id = e.id
       and message.conversation_id = p_conversation_id
       and message.role = 'assistant'
     order by message.created_at desc, message.id desc
     limit 1
  ) m on true
  left join lateral (
    select sum(mc.total_cost)::numeric as cost,
      case when bool_or(mc.cost_status = 'pending') then 'pending'
           when bool_and(mc.cost_status = 'settled') then 'settled'
           when bool_or(mc.cost_status = 'estimated_legacy') then 'estimated'
           when count(*) = 0 then 'unknown' else 'unknown' end as cost_status
    from prismatix_internal.model_calls mc where mc.execution_id = e.id
  ) c on true
  where e.id = p_execution_id;
$$;

create or replace function public.px08_get_compare_groups(p_conversation_id uuid, p_execution_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, prismatix_internal
as $$
declare v_user uuid := auth.uid(); v_groups jsonb;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id and c.user_id = v_user) then
    raise exception 'invalid_conversation' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'conversationId', g.conversation_id, 'preferredSide', g.preferred_side,
    'modelA', public.px08_compare_child(g.execution_a, p_conversation_id),
    'modelB', public.px08_compare_child(g.execution_b, p_conversation_id)
  ) order by g.created_at, g.id), '[]'::jsonb)
    into v_groups from public.compare_groups g
   where g.user_id = v_user and g.conversation_id = p_conversation_id
     and (g.execution_a = any(coalesce(p_execution_ids, '{}'::uuid[]))
       or g.execution_b = any(coalesce(p_execution_ids, '{}'::uuid[])));
  return v_groups;
end;
$$;

-- Store the owner's A/B selection on the durable group. A NULL side clears it.
create or replace function public.px08_set_compare_preference(
  p_compare_group_id uuid,
  p_preferred_side text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_group public.compare_groups;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_preferred_side is not null and p_preferred_side not in ('A', 'B') then
    raise exception 'invalid_preferred_side' using errcode = '22023';
  end if;
  update public.compare_groups
     set preferred_side = p_preferred_side,
         preference_updated_at = case when p_preferred_side is null then null else now() end
   where id = p_compare_group_id and user_id = v_user
   returning * into v_group;
  if not found then
    raise exception 'invalid_compare_group' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', v_group.id,
    'preferredSide', v_group.preferred_side,
    'preferenceUpdatedAt', v_group.preference_updated_at
  );
end;
$$;

revoke all on function public.px08_persist_compare(uuid, uuid, uuid) from public, anon;
revoke all on function public.px08_compare_child(uuid, uuid) from public, anon, authenticated;
revoke all on function public.px08_get_compare_groups(uuid, uuid[]) from public, anon;
revoke all on function public.px08_set_compare_preference(uuid, text) from public, anon;
grant execute on function public.px08_persist_compare(uuid, uuid, uuid) to authenticated;
grant execute on function public.px08_get_compare_groups(uuid, uuid[]) to authenticated;
grant execute on function public.px08_set_compare_preference(uuid, text) to authenticated;
