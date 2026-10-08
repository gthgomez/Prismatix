-- PX07: durable conversation continuity, attachments and bounded context.
-- Findings addressed: conversation continuity/attachments (PX07-Lite).
--
-- Additive only:
--   * conversations gain `title` and `last_activity_at` (backfilled from the
--     newest message, then defaulted to now() and made NOT NULL);
--   * messages gain a durable `execution_id` identity and a bounded JSONB
--     `attachments` projection (no relational attachments table);
--   * a partial unique index makes (execution_id, role) idempotent;
--   * the unused client INSERT policy on messages is dropped: messages are
--     server-authored through the service-role-only RPC below.
--
-- The single write path is public.px07_persist_message, a SECURITY DEFINER RPC
-- in the exposed `public` schema (prismatix_internal stays out of PostgREST).
-- Belt-and-suspenders never stores base64, signed URLs, or another subject's
-- storage path. Verify with tests/integration/px07_conversation_continuity.sql.

-- ---------------------------------------------------------------------------
-- 1) conversations: title + last_activity_at.
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column if not exists title text,
  add column if not exists last_activity_at timestamptz;

update public.conversations c
   set last_activity_at = greatest(
         c.created_at,
         coalesce(
           (select max(m.created_at) from public.messages m where m.conversation_id = c.id),
           c.created_at
         )
       )
 where c.last_activity_at is null;

alter table public.conversations
  alter column last_activity_at set default now();

alter table public.conversations
  alter column last_activity_at set not null;

-- Cursor index for `order by last_activity_at desc, id desc`.
create index if not exists conversations_subject_activity_idx
  on public.conversations (user_id, last_activity_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 2) messages: durable execution identity + JSONB attachments.
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists execution_id uuid;

alter table public.messages
  add column if not exists attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array');

-- One message per (execution, role). NULL execution_id rows (legacy) are exempt.
create unique index if not exists messages_execution_role_uidx
  on public.messages (execution_id, role)
  where execution_id is not null;

create index if not exists messages_conversation_created_id_idx
  on public.messages (conversation_id, created_at asc, id asc);

-- Messages are server-authored (the router writes via service_role). Remove the
-- unused client INSERT policy; select-own stays. conversations_insert_own is
-- unused by the client but intentionally left unchanged to bound this diff.
drop policy if exists messages_insert_own on public.messages;

-- ---------------------------------------------------------------------------
-- 3) Service-role-only write RPC.
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
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
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
    if v_kind is null or v_kind not in ('image', 'video', 'file') then
      raise exception 'invalid_attachment' using errcode = '22023';
    end if;

    -- `file` entries are text/code metadata only (name/size); their content is
    -- never persisted and there is no object to validate.
    if v_kind = 'file' then
      if coalesce(v_att->>'name', '') = '' then
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
    execution_id, attachments
  ) values (
    p_conversation_id, p_role, p_content, greatest(coalesce(p_token_count, 0), 0),
    p_model_used, p_legacy_image_url, p_execution_id, v_attachments
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

revoke all on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text) from public;
revoke all on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text) from anon;
revoke all on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text) from authenticated;
grant execute on function public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text) to service_role;
