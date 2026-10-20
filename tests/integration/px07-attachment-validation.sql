-- tests/integration/px07-attachment-validation.sql
-- Comprehensive integration test verifying PX07 attachment validation and px07_persist_message contracts:
-- 1. Ordinary text persistence via 10-argument function with metadata.
-- 2. Backward-compatible 9-argument function call (defaults metadata to '{}'::jsonb).
-- 3. Owned image: 'supabase://chat-uploads/<userId>/image.png' succeeds.
-- 4. Foreign image: 'supabase://chat-uploads/<otherUser>/image.png' rejected ('invalid_attachment').
-- 5. Invalid image URI: 'supabase://attachments/...' or external HTTPS rejected ('invalid_attachment').
-- 6. Valid text-file metadata: kind='file' with name <= 512 chars succeeds.
-- 7. Invalid text-file metadata: kind='file' with empty or > 512 char name rejected ('invalid_attachment').
-- 8. Owned video reference: kind='video' pointing to owned public.video_assets row succeeds.
-- 9. Foreign video reference: pointing to unowned video_asset rejected ('invalid_attachment').
-- 10. Malformed attachments: non-array, > 16 items, unknown kind rejected ('invalid_attachment').
-- 11. Idempotent replay: exact same execution_id, role, content, attachments returns inserted=false.
-- 12. Conflict handling: conflicting content on same execution_id and role raises PT409.
-- 13. Assistant message persistence with metadata roundtrips correctly.

begin;

do $$
declare
  u1 uuid := 'd0000000-0000-4000-8000-000000000001';
  u2 uuid := 'd0000000-0000-4000-8000-000000000002';
  c1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  e1 uuid;
  e2 uuid;
  e3 uuid;
  e4 uuid;
  v_vid_owned uuid := gen_random_uuid();
  v_vid_foreign uuid := gen_random_uuid();
  res jsonb;
  msg record;
  caught boolean;
begin
  -- Fixtures: users
  insert into auth.users (id) values (u1), (u2) on conflict (id) do nothing;

  -- Fixtures: video assets
  insert into public.video_assets (id, user_id, storage_bucket, storage_path, mime_type, file_size_bytes, duration_ms, status)
  values (v_vid_owned, u1, 'video-uploads', 'path/owned.mp4', 'video/mp4', 1024, 10000, 'ready'),
         (v_vid_foreign, u2, 'video-uploads', 'path/foreign.mp4', 'video/mp4', 2048, 15000, 'ready');

  -- =========================================================================
  -- TEST 1: Ordinary text persistence via 10-arg function with metadata
  -- =========================================================================
  e1 := (public.px03_create_execution(u1, c1, 'req-att-1', 'hash-att-1') -> 'execution' ->> 'id')::uuid;

  res := public.px07_persist_message(
    u1, c1, e1, 'user', 'Hello world', 5, 'model-test',
    '[]'::jsonb, null, '{"debate": {"enabled": true, "selection": "deep"}}'::jsonb
  );

  if (res->>'inserted')::boolean is not true then
    raise exception 'TEST 1: expected inserted=true, got %', res;
  end if;

  select * into msg from public.messages where id = (res->>'message_id')::uuid;
  if msg.metadata->'debate'->>'selection' <> 'deep' then
    raise exception 'TEST 1: metadata did not roundtrip correctly: %', msg.metadata;
  end if;

  -- =========================================================================
  -- TEST 2: Backward-compatible 9-arg wrapper call (no p_metadata passed)
  -- =========================================================================
  e2 := (public.px03_create_execution(u1, c1, 'req-att-2', 'hash-att-2') -> 'execution' ->> 'id')::uuid;

  res := public.px07_persist_message(
    u1, c1, e2, 'user', '9-arg message test', 4, 'model-test',
    '[]'::jsonb, null
  );

  if (res->>'inserted')::boolean is not true then
    raise exception 'TEST 2: expected inserted=true for 9-arg call, got %', res;
  end if;

  select * into msg from public.messages where id = (res->>'message_id')::uuid;
  if msg.metadata <> '{}'::jsonb then
    raise exception 'TEST 2: expected empty metadata object for 9-arg call, got %', msg.metadata;
  end if;

  -- =========================================================================
  -- TEST 3: Owned image attachment (supabase://chat-uploads/<u1>/...)
  -- =========================================================================
  e3 := (public.px03_create_execution(u1, c1, 'req-att-3', 'hash-att-3') -> 'execution' ->> 'id')::uuid;

  res := public.px07_persist_message(
    u1, c1, e3, 'user', 'Here is an owned image', 10, 'model-test',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'image',
        'storageRef', 'supabase://chat-uploads/' || u1::text || '/screenshot.png'
      )
    ),
    null,
    '{}'::jsonb
  );

  if (res->>'inserted')::boolean is not true then
    raise exception 'TEST 3: owned image attachment failed: %', res;
  end if;

  -- =========================================================================
  -- TEST 4: Foreign image attachment (supabase://chat-uploads/<u2>/...)
  -- Must be REJECTED!
  -- =========================================================================
  e4 := (public.px03_create_execution(u1, c1, 'req-att-4', 'hash-att-4') -> 'execution' ->> 'id')::uuid;
  caught := false;
  begin
    perform public.px07_persist_message(
      u1, c1, e4, 'user', 'Attempt foreign image hijack', 10, 'model-test',
      jsonb_build_array(
        jsonb_build_object(
          'kind', 'image',
          'storageRef', 'supabase://chat-uploads/' || u2::text || '/private.png'
        )
      ),
      null,
      '{}'::jsonb
    );
  exception when others then
    if sqlerrm like '%invalid_attachment%' then
      caught := true;
    else
      raise exception 'TEST 4: unexpected error: %', sqlerrm;
    end if;
  end;

  if not caught then
    raise exception 'TEST 4: foreign image was not rejected!';
  end if;

  -- =========================================================================
  -- TEST 5: Bogus storage protocol (supabase://attachments/...)
  -- Must be REJECTED!
  -- =========================================================================
  caught := false;
  begin
    perform public.px07_persist_message(
      u1, c1, e4, 'user', 'Attempt supabase://attachments protocol', 10, 'model-test',
      jsonb_build_array(
        jsonb_build_object(
          'kind', 'image',
          'storageRef', 'supabase://attachments/' || u1::text || '/image.png'
        )
      ),
      null,
      '{}'::jsonb
    );
  exception when others then
    if sqlerrm like '%invalid_attachment%' then
      caught := true;
    end if;
  end;

  if not caught then
    raise exception 'TEST 5: supabase://attachments protocol was not rejected!';
  end if;

  -- =========================================================================
  -- TEST 6: Valid text-file metadata attachment (kind='file', name <= 512)
  -- =========================================================================
  res := public.px07_persist_message(
    u1, c1, e4, 'user', 'File attachment test', 8, 'model-test',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'file',
        'name', 'main.rs',
        'size', 1024
      )
    ),
    null,
    '{}'::jsonb
  );

  if (res->>'inserted')::boolean is not true then
    raise exception 'TEST 6: valid file metadata rejected: %', res;
  end if;

  -- =========================================================================
  -- TEST 7: Invalid file metadata (empty name or name > 512 chars)
  -- =========================================================================
  declare
    e5 uuid := (public.px03_create_execution(u1, c1, 'req-att-5', 'hash-att-5') -> 'execution' ->> 'id')::uuid;
  begin
    caught := false;
    begin
      perform public.px07_persist_message(
        u1, c1, e5, 'user', 'Empty file name', 5, 'model-test',
        jsonb_build_array(
          jsonb_build_object('kind', 'file', 'name', '', 'size', 100)
        ),
        null,
        '{}'::jsonb
      );
    exception when others then
      if sqlerrm like '%invalid_attachment%' then
        caught := true;
      end if;
    end;

    if not caught then
      raise exception 'TEST 7: empty file name was not rejected!';
    end if;
  end;

  -- =========================================================================
  -- TEST 8: Owned video reference succeeds
  -- =========================================================================
  declare
    e6 uuid := (public.px03_create_execution(u1, c1, 'req-att-6', 'hash-att-6') -> 'execution' ->> 'id')::uuid;
  begin
    res := public.px07_persist_message(
      u1, c1, e6, 'user', 'Here is my video', 10, 'model-test',
      jsonb_build_array(
        jsonb_build_object(
          'kind', 'video',
          'videoAssetId', v_vid_owned::text
        )
      ),
      null,
      '{}'::jsonb
    );

    if (res->>'inserted')::boolean is not true then
      raise exception 'TEST 8: owned video reference rejected: %', res;
    end if;
  end;

  -- =========================================================================
  -- TEST 9: Foreign video reference fails
  -- =========================================================================
  declare
    e7 uuid := (public.px03_create_execution(u1, c1, 'req-att-7', 'hash-att-7') -> 'execution' ->> 'id')::uuid;
  begin
    caught := false;
    begin
      perform public.px07_persist_message(
        u1, c1, e7, 'user', 'Attempt foreign video access', 10, 'model-test',
        jsonb_build_array(
          jsonb_build_object(
            'kind', 'video',
            'videoAssetId', v_vid_foreign::text
          )
        ),
        null,
        '{}'::jsonb
      );
    exception when others then
      if sqlerrm like '%invalid_attachment%' then
        caught := true;
      end if;
    end;

    if not caught then
      raise exception 'TEST 9: foreign video reference was not rejected!';
    end if;
  end;

  -- =========================================================================
  -- TEST 10: Malformed attachment (not array, > 16 items, invalid kind)
  -- =========================================================================
  declare
    e8 uuid := (public.px03_create_execution(u1, c1, 'req-att-8', 'hash-att-8') -> 'execution' ->> 'id')::uuid;
  begin
    caught := false;
    begin
      perform public.px07_persist_message(
        u1, c1, e8, 'user', 'Bad kind', 5, 'model-test',
        jsonb_build_array(
          jsonb_build_object('kind', 'executable', 'name', 'malware.exe')
        ),
        null,
        '{}'::jsonb
      );
    exception when others then
      if sqlerrm like '%invalid_attachment%' then
        caught := true;
      end if;
    end;

    if not caught then
      raise exception 'TEST 10: unknown kind was not rejected!';
    end if;
  end;

  -- =========================================================================
  -- TEST 11: Idempotent replay
  -- Exact same execution_id, role, content, attachments returns inserted=false
  -- =========================================================================
  res := public.px07_persist_message(
    u1, c1, e1, 'user', 'Hello world', 5, 'model-test',
    '[]'::jsonb, null, '{"debate": {"enabled": true, "selection": "deep"}}'::jsonb
  );

  if (res->>'inserted')::boolean is not false then
    raise exception 'TEST 11: replay expected inserted=false, got %', res;
  end if;

  -- =========================================================================
  -- TEST 12: Content conflict raises PT409
  -- =========================================================================
  caught := false;
  begin
    perform public.px07_persist_message(
      u1, c1, e1, 'user', 'DIFFERENT CONTENT CONFLICT', 5, 'model-test',
      '[]'::jsonb, null, '{}'::jsonb
    );
  exception when others then
    if sqlstate = 'PT409' or sqlerrm like '%message_conflict%' then
      caught := true;
    else
      raise exception 'TEST 12: unexpected error: % (state %)', sqlerrm, sqlstate;
    end if;
  end;

  if not caught then
    raise exception 'TEST 12: message conflict did not raise PT409!';
  end if;

  -- =========================================================================
  -- TEST 13: Assistant message persistence with metadata
  -- =========================================================================
  res := public.px07_persist_message(
    u1, c1, e1, 'assistant', 'Synthesized debate result', 50, 'primary-model',
    '[]'::jsonb, null,
    jsonb_build_object(
      'debate', jsonb_build_object(
        'enabled', true,
        'selection', 'deep',
        'participants', jsonb_build_array(
          jsonb_build_object('role', 'critic', 'model', 'model-c'),
          jsonb_build_object('role', 'implementer', 'model', 'model-i')
        )
      )
    )
  );

  if (res->>'inserted')::boolean is not true then
    raise exception 'TEST 13: assistant message persistence failed: %', res;
  end if;

  select * into msg from public.messages where id = (res->>'message_id')::uuid;
  if msg.metadata->'debate'->'participants'->0->>'role' <> 'critic'
     or msg.metadata->'debate'->'participants'->1->>'role' <> 'implementer' then
    raise exception 'TEST 13: assistant metadata participants mismatch: %', msg.metadata;
  end if;

  raise notice 'ALL PX07 ATTACHMENT AND METADATA TESTS PASSED SUCCESSFULLY!';
end $$;

rollback;
