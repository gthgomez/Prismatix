-- supabase/migrations/20261107040000_wave2_productivity.sql
-- Wave 2 PR 4: Productivity, branching, tagging, prompt library, and server preferences (F16-F20)

-- F17 & F18: Add branching lineage, archiving, and tags to conversations
alter table public.conversations
  add column if not exists parent_conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists forked_from_message_id uuid references public.messages(id) on delete set null,
  add column if not exists archived boolean not null default false,
  add column if not exists tags text[] not null default '{}'::text[];

create index if not exists idx_conversations_parent_id on public.conversations(parent_conversation_id);
create index if not exists idx_conversations_archived on public.conversations(user_id, archived);
create index if not exists idx_conversations_tags on public.conversations using gin(tags);

-- Allow users to update their own conversations with related-record validation
drop policy if exists conversations_update_own on public.conversations;
create policy conversations_update_own on public.conversations
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
    and (parent_conversation_id is null or exists (select 1 from public.conversations c where c.id = parent_conversation_id and c.user_id = auth.uid()))
  );

-- F19: Reusable prompt library with project ownership protection
create table if not exists public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  description text default '',
  template text not null,
  variables text[] not null default '{}'::text[],
  category text default 'general',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prompt_templates_user on public.prompt_templates(user_id, category);
create index if not exists idx_prompt_templates_project on public.prompt_templates(project_id);

alter table public.prompt_templates enable row level security;

drop policy if exists prompt_templates_select_own on public.prompt_templates;
create policy prompt_templates_select_own on public.prompt_templates
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists prompt_templates_insert_own on public.prompt_templates;
create policy prompt_templates_insert_own on public.prompt_templates
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  );

drop policy if exists prompt_templates_update_own on public.prompt_templates;
create policy prompt_templates_update_own on public.prompt_templates
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  );

drop policy if exists prompt_templates_delete_own on public.prompt_templates;
create policy prompt_templates_delete_own on public.prompt_templates
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- F20: Cross-device user preference synchronization
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_select_own on public.user_preferences;
create policy user_preferences_select_own on public.user_preferences
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_preferences_insert_own on public.user_preferences;
create policy user_preferences_insert_own on public.user_preferences
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_preferences_update_own on public.user_preferences;
create policy user_preferences_update_own on public.user_preferences
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Provenance protection: prevent rewriting server-authored fields on messages
-- ---------------------------------------------------------------------------
create or replace function public.trg_protect_message_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow service_role or superuser to manage records
  if current_user = 'service_role' or auth.role() = 'service_role' or current_user = 'postgres' then
    return new;
  end if;

  -- Disallow modifying critical immutable server fields
  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.role is distinct from old.role
     or new.execution_id is distinct from old.execution_id
     or new.token_count is distinct from old.token_count
     or new.created_at is distinct from old.created_at
     or (new.model_used is distinct from old.model_used and old.execution_id is not null)
     or (new.content is distinct from old.content and old.role = 'assistant' and old.execution_id is not null) then
    raise exception 'unauthorized_message_mutation: server-authored message fields cannot be altered' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_message_provenance on public.messages;
create trigger trg_enforce_message_provenance
  before update on public.messages
  for each row execute function public.trg_protect_message_provenance();

-- ---------------------------------------------------------------------------
-- F16: Server-controlled conversation import RPC
-- ---------------------------------------------------------------------------
create or replace function public.px16_import_conversation(
  p_conversation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_conv_id uuid;
  v_title text;
  v_proj_id uuid;
  v_created_at timestamptz;
  v_last_activity timestamptz;
  v_existing_owner uuid;
  v_msgs jsonb;
  v_msg jsonb;
  v_msg_id uuid;
  v_role text;
  v_content text;
  v_model text;
  v_tokens integer;
  v_msg_created timestamptz;
  v_msg_meta jsonb;
  v_inserted_msgs integer := 0;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_conversation is null or jsonb_typeof(p_conversation) <> 'object' then
    raise exception 'invalid_import_payload' using errcode = '22023';
  end if;

  -- Validate or generate conversation id
  begin
    v_conv_id := (p_conversation->>'id')::uuid;
  exception when others then
    v_conv_id := gen_random_uuid();
  end;
  if v_conv_id is null then
    v_conv_id := gen_random_uuid();
  end if;

  v_title := coalesce(nullif(trim(p_conversation->>'title'), ''), 'Imported Conversation');
  
  -- Project verification
  if p_conversation->>'projectId' is not null and p_conversation->>'projectId' <> '' then
    begin
      v_proj_id := (p_conversation->>'projectId')::uuid;
      if not exists (select 1 from public.projects where id = v_proj_id and user_id = v_user_id) then
        v_proj_id := null; -- detach if not owned
      end if;
    exception when others then
      v_proj_id := null;
    end;
  end if;

  begin
    v_created_at := coalesce((p_conversation->>'createdAt')::timestamptz, now());
  exception when others then
    v_created_at := now();
  end;

  begin
    v_last_activity := coalesce((p_conversation->>'lastActivityAt')::timestamptz, v_created_at);
  exception when others then
    v_last_activity := v_created_at;
  end;

  -- Check if conversation already exists
  select user_id into v_existing_owner from public.conversations where id = v_conv_id;
  if v_existing_owner is not null then
    if v_existing_owner <> v_user_id then
      -- Collision with another user's conversation ID -> re-key to safe fresh UUID
      v_conv_id := gen_random_uuid();
      insert into public.conversations (id, user_id, title, project_id, created_at, last_activity_at)
      values (v_conv_id, v_user_id, v_title, v_proj_id, v_created_at, v_last_activity);
    else
      -- Owned by current user: update title/activity if newer
      update public.conversations
         set title = coalesce(title, v_title),
             last_activity_at = greatest(last_activity_at, v_last_activity)
       where id = v_conv_id;
    end if;
  else
    insert into public.conversations (id, user_id, title, project_id, created_at, last_activity_at)
    values (v_conv_id, v_user_id, v_title, v_proj_id, v_created_at, v_last_activity);
  end if;

  -- Process messages
  v_msgs := p_conversation->'messages';
  if v_msgs is not null and jsonb_typeof(v_msgs) = 'array' then
    for v_msg in select value from jsonb_array_elements(v_msgs) loop
      v_content := v_msg->>'content';
      if v_content is null or trim(v_content) = '' then
        continue;
      end if;

      v_role := coalesce(v_msg->>'role', 'user');
      if v_role not in ('user', 'assistant') then
        v_role := 'user';
      end if;

      begin
        v_msg_id := (v_msg->>'id')::uuid;
      exception when others then
        v_msg_id := gen_random_uuid();
      end;
      if v_msg_id is null then
        v_msg_id := gen_random_uuid();
      end if;

      v_model := nullif(trim(v_msg->>'model'), '');
      begin
        v_tokens := coalesce((v_msg->>'tokenCount')::integer, 0);
      exception when others then
        v_tokens := 0;
      end;

      begin
        v_msg_created := coalesce((v_msg->>'createdAt')::timestamptz, v_created_at) + (v_inserted_msgs * interval '1 millisecond');
      exception when others then
        v_msg_created := v_created_at + (v_inserted_msgs * interval '1 millisecond');
      end;

      v_msg_meta := jsonb_build_object(
        'imported', true,
        'imported_at', now(),
        'source_model', v_model,
        'historical_cost', v_msg->'cost'
      );

      -- Insert message atomically without execution_id (exempt from router unique constraint)
      insert into public.messages (
        id, conversation_id, role, content, token_count, model_used,
        image_url, attachments, created_at, metadata
      ) values (
        v_msg_id, v_conv_id, v_role, v_content, greatest(0, v_tokens), v_model,
        null, '[]'::jsonb, v_msg_created, v_msg_meta
      )
      on conflict (id) do nothing;

      v_inserted_msgs := v_inserted_msgs + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'success', true,
    'conversation_id', v_conv_id,
    'messages_count', v_inserted_msgs
  );
end;
$$;

revoke all on function public.px16_import_conversation(jsonb) from public, anon;
grant execute on function public.px16_import_conversation(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- F17: Server-controlled conversation branching RPC
-- ---------------------------------------------------------------------------
create or replace function public.px17_branch_conversation(
  p_source_conversation_id uuid,
  p_from_message_id uuid,
  p_branch_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_src_title text;
  v_src_proj uuid;
  v_boundary_created_at timestamptz;
  v_new_conv_id uuid;
  v_title text;
  v_copied integer := 0;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- 1. Verify caller owns source conversation
  select title, project_id into v_src_title, v_src_proj
    from public.conversations
   where id = p_source_conversation_id
     and user_id = v_user_id;

  if not found then
    raise exception 'invalid_source_conversation' using errcode = '22023';
  end if;

  -- 2. Verify boundary message belongs to source conversation
  select created_at into v_boundary_created_at
    from public.messages
   where id = p_from_message_id
     and conversation_id = p_source_conversation_id;

  if not found then
    raise exception 'invalid_boundary_message' using errcode = '22023';
  end if;

  -- 3. Create branch conversation
  v_new_conv_id := gen_random_uuid();
  v_title := coalesce(nullif(trim(p_branch_title), ''), 'Branch: ' || coalesce(v_src_title, 'Conversation'));

  insert into public.conversations (
    id, user_id, title, project_id, parent_conversation_id, forked_from_message_id,
    created_at, last_activity_at
  ) values (
    v_new_conv_id, v_user_id, v_title, v_src_proj, p_source_conversation_id, p_from_message_id,
    now(), now()
  );

  -- 4. Copy messages up to boundary atomically using CTE with deterministic row ordering
  with ordered_source as (
    select id, row_number() over (order by created_at asc, id asc) as seq
      from public.messages
     where conversation_id = p_source_conversation_id
  ),
  boundary_point as (
    select seq as max_seq
      from ordered_source
     where id = p_from_message_id
  )
  insert into public.messages (
    id, conversation_id, role, content, token_count, model_used,
    image_url, attachments, created_at, metadata
  )
  select
    gen_random_uuid(),
    v_new_conv_id,
    m.role,
    m.content,
    m.token_count,
    m.model_used,
    m.image_url,
    coalesce(m.attachments, '[]'::jsonb),
    m.created_at,
    jsonb_build_object(
      'branched_from_message_id', m.id,
      'branched_from_conversation_id', p_source_conversation_id
    )
  from public.messages m
  join ordered_source os on os.id = m.id
  join boundary_point bp on os.seq <= bp.max_seq
  order by os.seq asc;

  get diagnostics v_copied = row_count;

  return jsonb_build_object(
    'success', true,
    'new_conversation_id', v_new_conv_id,
    'copied_message_count', v_copied,
    'title', v_title
  );
end;
$$;

revoke all on function public.px17_branch_conversation(uuid, uuid, text) from public, anon;
grant execute on function public.px17_branch_conversation(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- F17: Message alternative version recording RPC
-- ---------------------------------------------------------------------------
create or replace function public.px17_record_message_version(
  p_message_id uuid,
  p_content text,
  p_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_msg public.messages;
  v_versions jsonb;
  v_next_version integer;
  v_new_entry jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select m.* into v_msg
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.id = p_message_id
     and c.user_id = v_user_id;

  if not found then
    raise exception 'message_not_found' using errcode = '22023';
  end if;

  -- Load existing versions or create initial version from current row
  if v_msg.metadata ? 'versions' and jsonb_typeof(v_msg.metadata->'versions') = 'array' then
    v_versions := v_msg.metadata->'versions';
  else
    v_versions := jsonb_build_array(jsonb_build_object(
      'version', 1,
      'content', v_msg.content,
      'model', v_msg.model_used,
      'timestamp', extract(epoch from v_msg.created_at) * 1000
    ));
  end if;

  v_next_version := jsonb_array_length(v_versions) + 1;
  v_new_entry := jsonb_build_object(
    'version', v_next_version,
    'content', p_content,
    'model', coalesce(p_model, v_msg.model_used),
    'timestamp', extract(epoch from now()) * 1000
  );

  v_versions := v_versions || jsonb_build_array(v_new_entry);

  update public.messages
     set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{versions}', v_versions)
   where id = p_message_id;

  return jsonb_build_object(
    'success', true,
    'versions', v_versions,
    'current_version', v_next_version
  );
end;
$$;

revoke all on function public.px17_record_message_version(uuid, text, text) from public, anon;
grant execute on function public.px17_record_message_version(uuid, text, text) to authenticated, service_role;
