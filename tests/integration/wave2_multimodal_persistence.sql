-- tests/integration/wave2_multimodal_persistence.sql
-- Integration test verifying PR #61 Multimodal & Accounting:
-- 1. Artifacts table schema & cross-tenant RLS isolation
-- 2. px29_save_artifact_revision versioning RPC
-- 3. px28_record_image_message server-owned message persistence & truthful cost status

begin;

-- Step 1: Create test users
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'alice@test.com'),
  ('22222222-2222-4222-8222-222222222222', 'bob@test.com')
on conflict (id) do nothing;

-- Step 2: Create conversations
insert into public.conversations (id, user_id, title) values
  ('aaaa1111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Alice Conv'),
  ('bbbb2222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'Bob Conv')
on conflict (id) do nothing;

-- Step 3: Test Alice creates an artifact in her conversation
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.artifacts (id, user_id, conversation_id, title, language, current_content, versions)
values (
  '1111aaaa-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'aaaa1111-1111-4111-8111-111111111111',
  'App.tsx',
  'typescript',
  'export const App = () => <div>Hello World</div>;',
  '[{"versionNumber": 1, "content": "export const App = () => <div>Hello World</div>;", "author": "assistant"}]'::jsonb
);

-- Step 4: Test Alice cannot insert artifact into Bob's conversation
do $$
begin
  insert into public.artifacts (id, user_id, conversation_id, title, language, current_content)
  values (
    '2222aaaa-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'bbbb2222-2222-4222-8222-222222222222',
    'Exploit.tsx',
    'typescript',
    'malicious content'
  );
  raise exception 'FAIL: Alice was able to insert artifact into Bob conversation!';
exception
  when insufficient_privilege or integrity_constraint_violation then
    raise notice 'PASS: Alice blocked from inserting artifact into Bob conversation';
end $$;

-- Step 5: Test px29_save_artifact_revision RPC for Alice
do $$
declare
  v_res public.artifacts;
  v_version_count int;
begin
  select * into v_res
  from public.px29_save_artifact_revision(
    '1111aaaa-1111-4111-8111-111111111111',
    'export const App = () => <div>Hello Prismatix v2</div>;',
    'user'
  );

  v_version_count := jsonb_array_length(v_res.versions);
  if v_version_count != 2 then
    raise exception 'FAIL: Expected 2 versions after revision, got %', v_version_count;
  end if;

  if v_res.current_content != 'export const App = () => <div>Hello Prismatix v2</div>;' then
    raise exception 'FAIL: Content was not updated correctly';
  end if;

  raise notice 'PASS: px29_save_artifact_revision updated version history and content';
end $$;

-- Step 6: Test Bob cannot update Alice's artifact via RPC
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $$
begin
  perform public.px29_save_artifact_revision(
    '1111aaaa-1111-4111-8111-111111111111',
    'Hacked content',
    'user'
  );
  raise exception 'FAIL: Bob was able to update Alice artifact!';
exception
  when others then
    if sqlerrm like '%artifact_not_found%' then
      raise notice 'PASS: Bob blocked from updating Alice artifact (artifact_not_found raised)';
    else
      raise;
    end if;
end $$;

-- Step 7: Test px28_record_image_message for Alice (Mock image: truthful unmetered cost)
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
declare
  v_msg public.messages;
  v_cost_status text;
  v_final_usd numeric;
begin
  select * into v_msg
  from public.px28_record_image_message(
    'aaaa1111-1111-4111-8111-111111111111',
    'Futuristic city at twilight',
    'dall-e-3',
    '{"imageUrl": "data:image/svg+xml;...", "costUsd": 0.040, "isMock": true}'::jsonb,
    true
  );

  v_cost_status := v_msg.metadata->'cost'->>'status';
  v_final_usd := (v_msg.metadata->'cost'->>'finalUsd')::numeric;

  if v_cost_status != 'unmetered' then
    raise exception 'FAIL: Expected unmetered cost status for mock image, got %', v_cost_status;
  end if;

  if v_final_usd != 0 then
    raise exception 'FAIL: Expected 0 final cost for mock image, got %', v_final_usd;
  end if;

  raise notice 'PASS: px28_record_image_message correctly recorded unmetered status for mock image';
end $$;

-- Step 8: Test Alice cannot record image into Bob's conversation
do $$
begin
  perform public.px28_record_image_message(
    'bbbb2222-2222-4222-8222-222222222222',
    'Attacking bob',
    'dall-e-3',
    '{}'::jsonb,
    true
  );
  raise exception 'FAIL: Alice was able to record image in Bob conversation!';
exception
  when others then
    if sqlerrm like '%conversation_not_found%' then
      raise notice 'PASS: Alice blocked from recording image in Bob conversation';
    else
      raise;
    end if;
end $$;

-- Step 9: Test Alice (authenticated) cannot forge settled cost by setting p_is_mock = false
do $$
begin
  perform public.px28_record_image_message(
    'aaaa1111-1111-4111-8111-111111111111',
    'Forged settled image attempt',
    'dall-e-3',
    '{"imageUrl": "https://fake.url/image.png", "costUsd": 50.0}'::jsonb,
    false
  );
  raise exception 'FAIL: Alice was able to record forged settled image message!';
exception
  when others then
    if sqlerrm like '%client_settlement_prohibited%' then
      raise notice 'PASS: Alice blocked from forging settled image execution (client_settlement_prohibited raised)';
    else
      raise;
    end if;
end $$;

-- Step 10: Test service_role can record settled execution
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
declare
  v_msg public.messages;
begin
  select * into v_msg
  from public.px28_record_image_message(
    'aaaa1111-1111-4111-8111-111111111111',
    'Authoritative backend image generation',
    'dall-e-3',
    '{"imageUrl": "https://storage.prismatix.ai/images/gen1.png", "costUsd": 0.040, "isMock": false}'::jsonb,
    false
  );

  if v_msg.metadata->'cost'->>'status' != 'settled' then
    raise exception 'FAIL: Expected settled status from backend service_role, got %', v_msg.metadata->'cost'->>'status';
  end if;

  if (v_msg.metadata->'cost'->>'finalUsd')::numeric != 0.040 then
    raise exception 'FAIL: Expected 0.040 final cost, got %', v_msg.metadata->'cost'->>'finalUsd';
  end if;

  raise notice 'PASS: Backend service_role successfully recorded authoritative settled image message';
end $$;

reset role;
rollback;
