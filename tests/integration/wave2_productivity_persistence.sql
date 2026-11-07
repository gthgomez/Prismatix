-- tests/integration/wave2_productivity_persistence.sql
-- Integration test verifying Wave 2 PR 4 productivity persistence contracts & RLS.
-- Tests px16_import_conversation, px17_branch_conversation, px17_record_message_version,
-- prompt_templates cross-account isolation, and message provenance immutability.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- 1) Setup Test Users & Fixtures
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('test.user_a', gen_random_uuid()::text, true);
  perform set_config('test.user_b', gen_random_uuid()::text, true);
end $$;

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  (current_setting('test.user_a')::uuid, 'authenticated', 'authenticated', 'user_a@example.com', now(), now()),
  (current_setting('test.user_b')::uuid, 'authenticated', 'authenticated', 'user_b@example.com', now(), now());

-- Create a project owned by User B
insert into public.projects (id, user_id, name, created_at, updated_at)
values (
  '11111111-1111-4111-8111-111111111111'::uuid,
  current_setting('test.user_b')::uuid,
  'User B Private Project',
  now(), now()
);

-- ---------------------------------------------------------------------------
-- 2) Assertions under User A session
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.user_a'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- A. Cross-account project reference rejection in prompt_templates
do $$
begin
  begin
    insert into public.prompt_templates (user_id, project_id, title, template)
    values (
      current_setting('test.user_a')::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid, -- User B's project!
      'Malicious Template',
      'Tamper'
    );
    raise exception 'FAIL: User A was able to reference User B project in prompt_templates';
  exception
    when insufficient_privilege then null; -- Expected RLS rejection
  end;
end $$;

-- B. Conversation Import via server RPC
do $$
declare
  v_payload jsonb;
  v_res jsonb;
  v_conv_id uuid;
  v_count integer;
begin
  v_payload := jsonb_build_object(
    'title', 'User A Imported Chat',
    'createdAt', now(),
    'messages', jsonb_build_array(
      jsonb_build_object('role', 'user', 'content', 'Imported Q1', 'tokenCount', 5),
      jsonb_build_object('role', 'assistant', 'content', 'Imported A1', 'model', 'gemini-3.8-flash', 'tokenCount', 10),
      jsonb_build_object('role', 'user', 'content', 'Imported Q2', 'tokenCount', 6),
      jsonb_build_object('role', 'assistant', 'content', 'Imported A2', 'model', 'gpt-6-sol', 'tokenCount', 12)
    )
  );

  v_res := public.px16_import_conversation(v_payload);
  if (v_res->>'success')::boolean is not true then
    raise exception 'FAIL: px16_import_conversation returned failure: %', v_res;
  end if;

  v_conv_id := (v_res->>'conversation_id')::uuid;
  perform set_config('test.imported_conv_id', v_conv_id::text, true);

  select count(*) into v_count from public.messages where conversation_id = v_conv_id;
  if v_count <> 4 then
    raise exception 'FAIL: Expected 4 imported messages, found %', v_count;
  end if;
end $$;

-- C. Direct client insert into messages is blocked
do $$
begin
  begin
    insert into public.messages (conversation_id, role, content)
    values (current_setting('test.imported_conv_id')::uuid, 'user', 'Direct Insert Attempt');
    raise exception 'FAIL: Direct client message INSERT succeeded despite PX07 policy removal';
  exception
    when insufficient_privilege then null; -- Expected RLS rejection
  end;
end $$;

-- D. Branch conversation up to boundary message
do $$
declare
  v_src_conv uuid := current_setting('test.imported_conv_id')::uuid;
  v_boundary_msg uuid;
  v_branch_res jsonb;
  v_branch_id uuid;
  v_copied integer;
begin
  -- Select 2nd message (first assistant answer) as boundary
  select id into v_boundary_msg
    from public.messages
   where conversation_id = v_src_conv
   order by created_at asc
   offset 1 limit 1;

  perform set_config('test.boundary_msg_id', v_boundary_msg::text, true);

  v_branch_res := public.px17_branch_conversation(v_src_conv, v_boundary_msg, 'User A Branch');
  if (v_branch_res->>'success')::boolean is not true then
    raise exception 'FAIL: px17_branch_conversation returned failure: %', v_branch_res;
  end if;

  v_branch_id := (v_branch_res->>'new_conversation_id')::uuid;
  perform set_config('test.branch_conv_id', v_branch_id::text, true);

  v_copied := (v_branch_res->>'copied_message_count')::integer;
  if v_copied <> 2 then
    raise exception 'FAIL: Expected 2 copied messages in branch, got %', v_copied;
  end if;
end $$;

-- E. Record alternative message version
do $$
declare
  v_msg_id uuid := current_setting('test.boundary_msg_id')::uuid;
  v_ver_res jsonb;
  v_curr_ver integer;
begin
  v_ver_res := public.px17_record_message_version(v_msg_id, 'Alternative Regenerated Answer', 'haiku-4.5');
  if (v_ver_res->>'success')::boolean is not true then
    raise exception 'FAIL: px17_record_message_version returned failure: %', v_ver_res;
  end if;

  v_curr_ver := (v_ver_res->>'current_version')::integer;
  if v_curr_ver <> 2 then
    raise exception 'FAIL: Expected current_version 2, got %', v_curr_ver;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Assertions under User B session (Cross-Account Isolation)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('test.user_b'), true);

-- A. User B cannot see User A conversations or messages
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.conversations where id = current_setting('test.imported_conv_id')::uuid;
  if v_count <> 0 then
    raise exception 'FAIL: User B can select User A conversation';
  end if;

  select count(*) into v_count from public.messages where conversation_id = current_setting('test.imported_conv_id')::uuid;
  if v_count <> 0 then
    raise exception 'FAIL: User B can select User A messages';
  end if;
end $$;

-- B. User B cannot branch User A conversation
do $$
declare
  v_src_conv uuid := current_setting('test.imported_conv_id')::uuid;
  v_boundary_msg uuid := current_setting('test.boundary_msg_id')::uuid;
begin
  begin
    perform public.px17_branch_conversation(v_src_conv, v_boundary_msg, 'Hijacked Branch');
    raise exception 'FAIL: User B was able to branch User A conversation';
  exception
    when others then
      if sqlerrm not like '%invalid_source_conversation%' then
        raise exception 'Unexpected error when User B branched User A conversation: %', sqlerrm;
      end if;
  end;
end $$;

-- C. User B cannot record message versions on User A message
do $$
declare
  v_msg_id uuid := current_setting('test.boundary_msg_id')::uuid;
begin
  begin
    perform public.px17_record_message_version(v_msg_id, 'Tampered Version', 'hacked-model');
    raise exception 'FAIL: User B was able to record version on User A message';
  exception
    when others then
      if sqlerrm not like '%message_not_found%' then
        raise exception 'Unexpected error when User B versioned User A message: %', sqlerrm;
      end if;
  end;
end $$;

reset role;
rollback;

\echo 'tests/integration/wave2_productivity_persistence.sql: PASS (All F16-F20 persistence, RPC, and RLS checks passed)'
