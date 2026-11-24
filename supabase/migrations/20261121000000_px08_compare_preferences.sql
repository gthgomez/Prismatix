-- Upgrade existing Compare groups in place, preserving server-authored transcripts.
alter table public.compare_groups
  add column if not exists preferred_side text check (preferred_side in ('A', 'B'));

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

  -- Keep modelA/modelB tied to the durable group's first ordering. Replayed
  -- calls with reversed argument order must not move an existing A/B vote.
  v_result := jsonb_build_object(
    'id', v_group.id,
    'conversationId', v_group.conversation_id,
    'preferredSide', v_group.preferred_side,
    'modelA', public.px08_compare_child(v_group.execution_a, p_conversation_id),
    'modelB', public.px08_compare_child(v_group.execution_b, p_conversation_id)
  );
  return v_result;
end;
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
     set preferred_side = p_preferred_side
   where id = p_compare_group_id and user_id = v_user
   returning * into v_group;
  if not found then
    raise exception 'invalid_compare_group' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', v_group.id,
    'preferredSide', v_group.preferred_side
  );
end;
$$;

revoke all on function public.px08_set_compare_preference(uuid, text) from public, anon;
grant execute on function public.px08_set_compare_preference(uuid, text) to authenticated;
