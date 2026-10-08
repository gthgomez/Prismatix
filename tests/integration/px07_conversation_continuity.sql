-- tests/integration/px07_conversation_continuity.sql
-- PX07 durable conversation continuity assertions.
--
-- Self-contained psql script: everything runs inside ONE transaction and is
-- ROLLED BACK, so no database state is modified. It (re-)applies the real PX03
-- and PX07 migrations (idempotent) and then asserts:
--   * the conversations.last_activity_at backfill and NOT NULL/default;
--   * the messages.execution_id / attachments columns and JSONB array check;
--   * the partial unique index (execution_id, role);
--   * messages_insert_own is dropped (messages are server-authored);
--   * public.px07_persist_message posture (SECURITY DEFINER, fixed search_path,
--     service_role-only EXECUTE);
--   * authenticated cannot INSERT messages;
--   * idempotent replay, content conflict (PT409), execution/conversation
--     ownership, and attachment ownership validation.
--
-- Prerequisite: a Supabase database with the auth schema and the
-- anon / authenticated / service_role roles, and the baseline migrations up to
-- (but not including) PX07. Run per docs/engineering/containment-runbook.md.
--
--   Local:
--     supabase start && supabase db reset
--     psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--          -v ON_ERROR_STOP=1 -f tests/integration/px07_conversation_continuity.sql

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: two fresh users + a conversation with messages created BEFORE the
-- migration so the backfill has something to do.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('px07.user_a', gen_random_uuid()::text, true);
  perform set_config('px07.user_b', gen_random_uuid()::text, true);
  perform set_config('px07.conv_a', gen_random_uuid()::text, true);
  perform set_config('px07.conv_new', gen_random_uuid()::text, true);
end $$;

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  (
    current_setting('px07.user_a')::uuid,
    'authenticated', 'authenticated',
    'px07-a-' || current_setting('px07.user_a') || '@example.invalid',
    'px07-not-a-real-hash', now(), now()
  ),
  (
    current_setting('px07.user_b')::uuid,
    'authenticated', 'authenticated',
    'px07-b-' || current_setting('px07.user_b') || '@example.invalid',
    'px07-not-a-real-hash', now(), now()
  );

insert into public.conversations (id, user_id, total_tokens, created_at)
values (
  current_setting('px07.conv_a')::uuid,
  current_setting('px07.user_a')::uuid,
  0,
  '2026-01-01T00:00:00Z'
);

insert into public.messages (conversation_id, role, content, token_count, created_at)
values
  (current_setting('px07.conv_a')::uuid, 'user', 'first', 1, '2026-01-02T00:00:00Z'),
  (current_setting('px07.conv_a')::uuid, 'assistant', 'second', 2, '2026-01-03T00:00:00Z');

-- ---------------------------------------------------------------------------
-- Apply the REAL migrations under test (idempotent; rolled back at the end).
-- ---------------------------------------------------------------------------
\i supabase/migrations/20261006010000_px03_execution_ledger.sql
\i supabase/migrations/20261006040000_px07_conversation_continuity.sql

-- ---------------------------------------------------------------------------
-- 1) Backfill: last_activity_at = greatest(created_at, max(message.created_at)).
-- ---------------------------------------------------------------------------
do $$
declare
  v_activity timestamptz;
  v_nullable text;
  v_default text;
begin
  select last_activity_at into v_activity
    from public.conversations
   where id = current_setting('px07.conv_a')::uuid;
  if v_activity <> '2026-01-03T00:00:00Z'::timestamptz then
    raise exception 'PX07 FAIL: last_activity_at backfill wrong (%)', v_activity;
  end if;

  select is_nullable, column_default into v_nullable, v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'conversations'
     and column_name = 'last_activity_at';
  if v_nullable <> 'NO' then
    raise exception 'PX07 FAIL: last_activity_at is still nullable';
  end if;
  if v_default is null or v_default not like '%now()%' then
    raise exception 'PX07 FAIL: last_activity_at has no now() default (default=%)', v_default;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) messages columns + JSONB array check.
-- ---------------------------------------------------------------------------
do $$
declare
  v_type text;
  v_nullable text;
begin
  select data_type, is_nullable into v_type, v_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'messages'
     and column_name = 'attachments';
  if v_type <> 'jsonb' or v_nullable <> 'NO' then
    raise exception 'PX07 FAIL: messages.attachments shape wrong (% / %)', v_type, v_nullable;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'messages'
       and column_name = 'execution_id' and data_type = 'uuid'
  ) then
    raise exception 'PX07 FAIL: messages.execution_id missing or not uuid';
  end if;

  begin
    insert into public.messages (conversation_id, role, content, attachments)
    values (current_setting('px07.conv_a')::uuid, 'user', 'bad', '"not-an-array"'::jsonb);
    raise exception 'PX07 FAIL: non-array attachments were accepted';
  exception
    when check_violation then null; -- expected
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Partial unique index + dropped INSERT policy.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'messages_execution_role_uidx'
  ) then
    raise exception 'PX07 FAIL: messages_execution_role_uidx missing';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'messages'
       and policyname = 'messages_insert_own'
  ) then
    raise exception 'PX07 FAIL: messages_insert_own still present';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'messages'
       and policyname = 'messages_select_own'
  ) then
    raise exception 'PX07 FAIL: messages_select_own missing (owner reads regressed)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) RPC posture + privileges.
-- ---------------------------------------------------------------------------
do $$
declare
  v_secdef boolean;
  v_config text[];
begin
  select p.prosecdef, p.proconfig into v_secdef, v_config
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'px07_persist_message';

  if v_secdef is null then
    raise exception 'PX07 FAIL: public.px07_persist_message does not exist';
  end if;
  if v_secdef is not true then
    raise exception 'PX07 FAIL: px07_persist_message is not SECURITY DEFINER';
  end if;
  if v_config is null
     or array_to_string(v_config, ',') not like '%search_path=public, prismatix_internal%' then
    raise exception 'PX07 FAIL: px07_persist_message has no fixed search_path (config=%)', v_config;
  end if;

  if not has_function_privilege(
    'service_role',
    'public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text)',
    'EXECUTE'
  ) then
    raise exception 'PX07 FAIL: service_role lacks EXECUTE on px07_persist_message';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text)',
    'EXECUTE'
  ) then
    raise exception 'PX07 FAIL: authenticated has EXECUTE on px07_persist_message';
  end if;
  if has_function_privilege(
    'anon',
    'public.px07_persist_message(uuid, uuid, uuid, text, text, integer, text, jsonb, text)',
    'EXECUTE'
  ) then
    raise exception 'PX07 FAIL: anon has EXECUTE on px07_persist_message';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5) authenticated cannot INSERT messages (RLS + no INSERT policy).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('px07.user_a'), 'role', 'authenticated')::text,
  true
);
select set_config('request.jwt.claim.sub', current_setting('px07.user_a'), true);
do $$
begin
  insert into public.messages (conversation_id, role, content)
  values (current_setting('px07.conv_a')::uuid, 'user', 'client-authored');
  raise exception 'PX07 FAIL: authenticated inserted a message directly';
exception
  when insufficient_privilege then null; -- expected
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 6) RPC behaviour (as service_role).
-- ---------------------------------------------------------------------------
set local role service_role;

do $$
declare
  v_exec jsonb;
  v_exec_id uuid;
  v_foreign_exec_id uuid;
  v_result jsonb;
  v_activity timestamptz;
  v_title text;
  v_conv_owner uuid;
begin
  -- Owned execution bound to conv_a.
  v_exec := public.px03_create_execution(
    current_setting('px07.user_a')::uuid,
    current_setting('px07.conv_a')::uuid,
    'px07-req-1', 'px07-hash-1'
  );
  v_exec_id := (v_exec->'execution'->>'id')::uuid;

  -- Insert + activity/title advance.
  v_result := public.px07_persist_message(
    current_setting('px07.user_a')::uuid,
    current_setting('px07.conv_a')::uuid,
    v_exec_id, 'user', 'durable hello', 7, 'opencode:deepseek-v4-pro', '[]'::jsonb, null
  );
  if (v_result->>'inserted')::boolean is not true then
    raise exception 'PX07 FAIL: first persist did not insert';
  end if;

  select last_activity_at, title into v_activity, v_title
    from public.conversations where id = current_setting('px07.conv_a')::uuid;
  if v_title <> 'durable hello' then
    raise exception 'PX07 FAIL: conversation title not set (title=%)', v_title;
  end if;
  if v_activity < now() - interval '1 minute' then
    raise exception 'PX07 FAIL: last_activity_at not advanced';
  end if;

  -- Idempotent replay.
  v_result := public.px07_persist_message(
    current_setting('px07.user_a')::uuid,
    current_setting('px07.conv_a')::uuid,
    v_exec_id, 'user', 'durable hello', 7, 'opencode:deepseek-v4-pro', '[]'::jsonb, null
  );
  if (v_result->>'inserted')::boolean is not false then
    raise exception 'PX07 FAIL: idempotent replay inserted a duplicate turn';
  end if;

  -- Genuine conflict: same (execution_id, role) with different content.
  begin
    perform public.px07_persist_message(
      current_setting('px07.user_a')::uuid,
      current_setting('px07.conv_a')::uuid,
      v_exec_id, 'user', 'different content', 7, null, '[]'::jsonb, null
    );
    raise exception 'PX07 FAIL: content conflict was accepted';
  exception
    when sqlstate 'PT409' then null; -- expected message_conflict
  end;

  -- Foreign execution → invalid_execution.
  v_exec := public.px03_create_execution(
    current_setting('px07.user_b')::uuid, null, 'px07-req-b', 'px07-hash-b'
  );
  v_foreign_exec_id := (v_exec->'execution'->>'id')::uuid;
  begin
    perform public.px07_persist_message(
      current_setting('px07.user_a')::uuid,
      current_setting('px07.conv_a')::uuid,
      v_foreign_exec_id, 'user', 'stolen', 0, null, '[]'::jsonb, null
    );
    raise exception 'PX07 FAIL: foreign execution was accepted';
  exception
    when sqlstate '22023' then null; -- expected invalid_execution
  end;

  -- A user message creates an absent conversation, owned by the subject, and
  -- sets the title.
  v_exec := public.px03_create_execution(
    current_setting('px07.user_a')::uuid,
    current_setting('px07.conv_new')::uuid,
    'px07-req-new', 'px07-hash-new'
  );
  v_exec_id := (v_exec->'execution'->>'id')::uuid;
  perform public.px07_persist_message(
    current_setting('px07.user_a')::uuid,
    current_setting('px07.conv_new')::uuid,
    v_exec_id, 'user', 'brand new chat', 0, null, '[]'::jsonb, null
  );
  select user_id, title into v_conv_owner, v_title
    from public.conversations where id = current_setting('px07.conv_new')::uuid;
  if v_conv_owner <> current_setting('px07.user_a')::uuid or v_title <> 'brand new chat' then
    raise exception 'PX07 FAIL: conversation was not created/owned/titled correctly';
  end if;
end $$;

-- Attachment validation.
do $$
declare
  v_exec_id uuid;
  v_foreign_exec_id uuid;
begin
  v_exec_id := (
    public.px03_create_execution(
      current_setting('px07.user_a')::uuid,
      current_setting('px07.conv_a')::uuid,
      'px07-req-att', 'px07-hash-att'
    )->'execution'->>'id'
  )::uuid;

  -- Foreign image path → invalid_attachment.
  begin
    perform public.px07_persist_message(
      current_setting('px07.user_a')::uuid,
      current_setting('px07.conv_a')::uuid,
      v_exec_id, 'user', 'with bad image', 0, null,
      jsonb_build_array(
        jsonb_build_object(
          'ordinal', 0, 'kind', 'image', 'available', true,
          'storageRef', 'supabase://chat-uploads/'
            || current_setting('px07.user_b') || '/x.png',
          'videoAssetId', null
        )
      ),
      null
    );
    raise exception 'PX07 FAIL: foreign image path was accepted';
  exception
    when sqlstate '22023' then null; -- expected invalid_attachment
  end;

  -- Unowned video asset → invalid_attachment.
  begin
    perform public.px07_persist_message(
      current_setting('px07.user_a')::uuid,
      current_setting('px07.conv_a')::uuid,
      v_exec_id, 'user', 'with bad video', 0, null,
      jsonb_build_array(
        jsonb_build_object(
          'ordinal', 0, 'kind', 'video', 'available', true,
          'storageRef', null, 'videoAssetId', gen_random_uuid()
        )
      ),
      null
    );
    raise exception 'PX07 FAIL: unowned video asset was accepted';
  exception
    when sqlstate '22023' then null; -- expected invalid_attachment
  end;

  -- Owned image path is accepted, and legacy_image_url projects the first image.
  perform public.px07_persist_message(
    current_setting('px07.user_a')::uuid,
    current_setting('px07.conv_a')::uuid,
    v_exec_id, 'user', 'with good image', 0, null,
    jsonb_build_array(
      jsonb_build_object(
        'ordinal', 3, 'kind', 'image', 'available', true,
        'storageRef', 'supabase://chat-uploads/'
          || current_setting('px07.user_a') || '/good.png',
        'videoAssetId', null
      )
    ),
    'supabase://chat-uploads/' || current_setting('px07.user_a') || '/good.png'
  );

  if not exists (
    select 1 from public.messages
     where conversation_id = current_setting('px07.conv_a')::uuid
       and content = 'with good image'
       and image_url = 'supabase://chat-uploads/'
         || current_setting('px07.user_a') || '/good.png'
       and attachments->0->>'ordinal' = '3'
  ) then
    raise exception 'PX07 FAIL: owned image attachment was not persisted/ordinal-preserved';
  end if;

  -- A file (text/code) attachment is accepted as metadata only.
  v_exec_id := (
    public.px03_create_execution(
      current_setting('px07.user_a')::uuid,
      current_setting('px07.conv_a')::uuid,
      'px07-req-file', 'px07-hash-file'
    )->'execution'->>'id'
  )::uuid;
  perform public.px07_persist_message(
    current_setting('px07.user_a')::uuid,
    current_setting('px07.conv_a')::uuid,
    v_exec_id, 'user', 'with file', 0, null,
    jsonb_build_array(
      jsonb_build_object(
        'ordinal', 0, 'kind', 'file', 'available', true,
        'storageRef', null, 'videoAssetId', null,
        'name', 'notes.md', 'size', 42
      )
    ),
    null
  );
  if not exists (
    select 1 from public.messages
     where conversation_id = current_setting('px07.conv_a')::uuid
       and content = 'with file'
       and attachments->0->>'kind' = 'file'
       and attachments->0->>'name' = 'notes.md'
  ) then
    raise exception 'PX07 FAIL: file attachment metadata was not persisted';
  end if;

  -- An over-long attachment array is rejected.
  v_exec_id := (
    public.px03_create_execution(
      current_setting('px07.user_a')::uuid,
      current_setting('px07.conv_a')::uuid,
      'px07-req-toomany', 'px07-hash-toomany'
    )->'execution'->>'id'
  )::uuid;
  begin
    perform public.px07_persist_message(
      current_setting('px07.user_a')::uuid,
      current_setting('px07.conv_a')::uuid,
      v_exec_id, 'user', 'too many', 0, null,
      (select jsonb_agg(jsonb_build_object('ordinal', i, 'kind', 'file', 'name', 'f'))
         from generate_series(0, 16) as i),
      null
    );
    raise exception 'PX07 FAIL: over-long attachment array was accepted';
  exception
    when sqlstate '22023' then null; -- expected invalid_attachment
  end;
end $$;

reset role;

rollback;

\echo 'tests/integration/px07_conversation_continuity.sql: PASS (continuity + ownership assertions held)'
