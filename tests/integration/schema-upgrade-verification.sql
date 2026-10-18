-- tests/integration/schema-upgrade-verification.sql
-- Integration verification for 20261018000000_debate_settlement_and_continuity migration upgrade:
-- 1. Migration upgrade integrity from 20261006 / 20261011 baseline to 20261018.
-- 2. Ordinary chat and assistant persistence via px07_persist_message.
-- 3. PX07 idempotency: Replaying the same (execution_id, role) with matching content returns inserted=false.
-- 4. Attachment ownership and validation:
--    - Text/code file attachment (metadata only).
--    - Owned image upload under chat-uploads bucket.
--    - Rejection of foreign image upload (PT403).
--    - Rejection of malformed/unsupported attachment (PT400).
-- 5. Token counter behavior (increment_token_count_for_user respected).
-- 6. Late dispatch prevention on terminal executions.

begin;

do $$
declare
  u1 uuid := 'a0000000-0000-4000-8000-000000000001';
  u2 uuid := 'a0000000-0000-4000-8000-000000000002';
  c1 uuid := 'b0000000-0000-4000-8000-000000000001';
  e1 uuid := 'e0000000-0000-4000-8000-000000000001';
  e2 uuid := 'e0000000-0000-4000-8000-000000000002';
  r1 jsonb;
  r2 jsonb;
  conv record;
  err_code text;
begin
  -- Setup test users
  insert into auth.users (id) values (u1), (u2) on conflict (id) do nothing;

  -- Setup conversation owned by u1
  insert into public.conversations (id, user_id, title, total_tokens)
  values (c1, u1, 'Upgrade Test Conversation', 0)
  on conflict (id) do nothing;

  -- Create valid execution e1
  e1 := (public.px03_create_execution(u1, c1, 'req-upgrade-1', 'hash-upgrade-1') -> 'execution' ->> 'id')::uuid;

  -- =========================================================================
  -- 1. Ordinary Chat Persistence (User Turn) with valid file attachment
  -- =========================================================================
  r1 := public.px07_persist_message(
    u1, c1, e1, 'user', 'Hello from upgrade test', 50, 'anthropic:haiku',
    '[{"kind":"file","name":"test.ts","size":120,"available":true}]'::jsonb,
    null,
    '{}'::jsonb
  );

  if (r1->>'inserted')::boolean is not true then
    raise exception 'TEST 1: expected inserted=true for initial user turn, got %', r1;
  end if;

  select total_tokens into conv from public.conversations where id = c1;
  if conv.total_tokens <> 50 then
    raise exception 'TEST 1: expected total_tokens=50, got %', conv.total_tokens;
  end if;

  -- =========================================================================
  -- 2. PX07 Idempotency: Replaying exact same turn returns inserted=false
  --    and does NOT double-increment total_tokens.
  -- =========================================================================
  r2 := public.px07_persist_message(
    u1, c1, e1, 'user', 'Hello from upgrade test', 50, 'anthropic:haiku',
    '[{"kind":"file","name":"test.ts","size":120,"available":true}]'::jsonb,
    null,
    '{}'::jsonb
  );

  if (r2->>'inserted')::boolean is not false then
    raise exception 'TEST 2: expected inserted=false for idempotent replay, got %', r2;
  end if;

  if (r2->>'message_id') <> (r1->>'message_id') then
    raise exception 'TEST 2: expected same message_id on replay (% vs %)', r1->>'message_id', r2->>'message_id';
  end if;

  select total_tokens into conv from public.conversations where id = c1;
  if conv.total_tokens <> 50 then
    raise exception 'TEST 2: total_tokens was double-incremented: %', conv.total_tokens;
  end if;

  -- =========================================================================
  -- 3. Assistant Turn with Debate Metadata
  -- =========================================================================
  r1 := public.px07_persist_message(
    u1, c1, e1, 'assistant', 'Synthesized debate response', 120, 'anthropic:sonnet',
    '[]'::jsonb,
    null,
    '{"debate":{"active":true,"profile":"general","trigger":"explicit","participants":[{"role":"proposer","model":"opus"}]}}'::jsonb
  );

  if (r1->>'inserted')::boolean is not true then
    raise exception 'TEST 3: expected inserted=true for assistant debate turn, got %', r1;
  end if;

  select total_tokens into conv from public.conversations where id = c1;
  if conv.total_tokens <> 170 then
    raise exception 'TEST 3: expected total_tokens=170, got %', conv.total_tokens;
  end if;

  -- =========================================================================
  -- 4. Attachment Security & Ownership
  --    - Foreign image ownership must raise 22023 (invalid_attachment)
  -- =========================================================================
  e2 := (public.px03_create_execution(u1, c1, 'req-upgrade-2', 'hash-upgrade-2') -> 'execution' ->> 'id')::uuid;

  begin
    perform public.px07_persist_message(
      u1, c1, e2, 'user', 'Attempt foreign attachment', 20, null,
      jsonb_build_array(
        jsonb_build_object(
          'kind', 'image',
          'storageRef', 'supabase://chat-uploads/' || u2 || '/foreign.png',
          'available', true
        )
      ),
      null,
      '{}'::jsonb
    );
    raise exception 'TEST 4: foreign image attachment should have failed closed!';
  exception
    when sqlstate '22023' then
      null; -- Expected: fail closed on foreign ownership
    when others then
      raise exception 'TEST 4: expected 22023 on foreign image, got % (%)', sqlstate, sqlerrm;
  end;

  -- =========================================================================
  -- 5. Attachment Validation
  --    - Malformed storageRef (not chat-uploads) must raise 22023 (invalid_attachment)
  -- =========================================================================
  begin
    perform public.px07_persist_message(
      u1, c1, e2, 'user', 'Attempt invalid attachment path', 20, null,
      jsonb_build_array(
        jsonb_build_object(
          'kind', 'image',
          'storageRef', 'supabase://attachments/' || u1 || '/malformed.png',
          'available', true
        )
      ),
      null,
      '{}'::jsonb
    );
    raise exception 'TEST 5: invalid storageRef bucket should have failed!';
  exception
    when sqlstate '22023' then
      null; -- Expected: fail closed on invalid bucket
    when others then
      raise exception 'TEST 5: expected 22023 on malformed bucket, got % (%)', sqlstate, sqlerrm;
  end;

  -- =========================================================================
  -- 6. Late Dispatch Guard on Terminal Execution
  --    - px03_record_model_call must reject new dispatches when terminal_outcome is not null
  -- =========================================================================
  e2 := (public.px03_create_execution(u1, c1, 'req-late-dispatch', 'hash-late-dispatch') -> 'execution' ->> 'id')::uuid;

  -- Finalize execution to completed
  perform public.px03_finalize_execution(e2, 'completed', 'ok', 'anthropic:sonnet');

  begin
    perform public.px03_record_model_call(
      e2, 'debate-challenger', 'late-critic', 1, 'model-late', 'model-late', 'model-late', 'req-late',
      'dispatched', 0, 0, 0, 0, 0, 0, 0, '{}'::jsonb, 'pending'
    );
    raise exception 'TEST 6: late dispatch on finalized execution should have been rejected!';
  exception
    when sqlstate '22023' then
      null; -- Expected: fail closed on late dispatch
    when others then
      raise exception 'TEST 6: expected 22023 on late dispatch, got % (%)', sqlstate, sqlerrm;
  end;

end $$;

rollback;
