-- tests/security/storage-isolation.sql
-- PX01 storage isolation & client-write containment assertions.
--
-- Self-contained psql script: everything runs inside ONE transaction and is
-- ROLLED BACK, so no database state is modified. It stages the legacy drift
-- (the dashboard-created broad policies) on top of an already-migrated schema,
-- proves the drift is actually exploitable, re-applies the real PX01 migration
-- file, and then asserts the contained post-migration state. A migration that
-- merely adds restrictive-looking policies without dropping the broad ones
-- CANNOT pass: the anonymous visibility assertion flips from ">= 2 rows"
-- (staged drift) to "exactly 0 rows" (post-migration) around the real
-- migration file.
--
-- Prerequisite: a Supabase database with ALL migrations applied (the script
-- needs the auth/storage schemas, public.cost_logs, public.video_assets, and
-- the anon/authenticated/service_role roles).
--
-- Run from the REPO ROOT:
--   Local:
--     supabase start && supabase db reset
--     psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--          -v ON_ERROR_STOP=1 -f tests/security/storage-isolation.sql
--   Staging (already-migrated schema):
--     psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f tests/security/storage-isolation.sql

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: two fresh users, the buckets, and one private object per user.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('px01.user_a', gen_random_uuid()::text, true);
  perform set_config('px01.user_b', gen_random_uuid()::text, true);
end $$;

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  (
    current_setting('px01.user_a')::uuid,
    'authenticated',
    'authenticated',
    'px01-a-' || current_setting('px01.user_a') || '@example.invalid',
    'px01-not-a-real-hash',
    now(),
    now()
  ),
  (
    current_setting('px01.user_b')::uuid,
    'authenticated',
    'authenticated',
    'px01-b-' || current_setting('px01.user_b') || '@example.invalid',
    'px01-not-a-real-hash',
    now(),
    now()
  );

insert into storage.buckets (id, name, public)
values
  ('chat-uploads', 'chat-uploads', false),
  ('video-artifacts', 'video-artifacts', false)
on conflict (id) do nothing;

insert into storage.objects (id, bucket_id, name, owner)
values
  (
    gen_random_uuid(),
    'chat-uploads',
    current_setting('px01.user_a') || '/fixture-a.png',
    current_setting('px01.user_a')::uuid
  ),
  (
    gen_random_uuid(),
    'chat-uploads',
    current_setting('px01.user_b') || '/fixture-b.png',
    current_setting('px01.user_b')::uuid
  );

-- ---------------------------------------------------------------------------
-- PHASE 1: stage the drifted production state (legacy broad policies present)
-- and prove the exposure is real before the migration is applied.
-- ---------------------------------------------------------------------------
drop policy if exists "Public read access" on storage.objects;
drop policy if exists "Users can upload to own folder" on storage.objects;

create policy "Public read access" on storage.objects
  for select
  to public
  using (true);

create policy "Users can upload to own folder" on storage.objects
  for insert
  to authenticated
  with check ((storage.foldername(name))[1] = auth.uid()::text);

-- Drift assertion 1: anonymous role can enumerate storage object rows.
set local role anon;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare
  visible bigint;
begin
  select count(*) into visible from storage.objects;
  if visible < 2 then
    raise exception 'PX01 drift fixture failed: expected the legacy broad read policy to expose >= 2 storage objects to anon, saw % (cannot stage the drifted state)', visible;
  end if;
end $$;
reset role;

-- Drift assertion 2: an authenticated user can insert object rows into a
-- bucket they have no authorized path into (cross-bucket upload exposure).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('px01.user_b'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('px01.user_b'), true);
do $$
begin
  insert into storage.objects (id, bucket_id, name, owner)
  values (
    gen_random_uuid(),
    'video-artifacts',
    current_setting('px01.user_b') || '/drift-probe.png',
    current_setting('px01.user_b')::uuid
  );
exception
  when insufficient_privilege then
    raise exception 'PX01 drift fixture failed: the legacy upload policy did not allow the cross-bucket insert (cannot stage the drifted state)';
end $$;
reset role;

-- Remove the drift probe row so post-migration counts are exact.
delete from storage.objects
where bucket_id = 'video-artifacts'
  and name like '%/drift-probe.png';

-- ---------------------------------------------------------------------------
-- PHASE 2: apply the REAL migration under test (idempotent; re-applied inside
-- this transaction and rolled back at the end).
-- ---------------------------------------------------------------------------
\i supabase/migrations/20261006000000_px01_storage_entitlements.sql

-- ---------------------------------------------------------------------------
-- PHASE 3: post-migration containment assertions.
-- ---------------------------------------------------------------------------

-- 3a) Anonymous row access denied: zero visible object rows, no inserts.
set local role anon;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare
  visible bigint;
begin
  select count(*) into visible from storage.objects;
  if visible <> 0 then
    raise exception 'PX01 FAIL: anonymous role can still see % storage.objects rows after the migration', visible;
  end if;
end $$;
do $$
begin
  insert into storage.objects (id, bucket_id, name)
  values (gen_random_uuid(), 'chat-uploads', 'px01-anon-probe.png');
  raise exception 'PX01 FAIL: anonymous insert into storage.objects succeeded after the migration';
exception
  when insufficient_privilege then
    null; -- expected: denied
end $$;
reset role;

-- 3b) Owner A sees its own object and nothing else.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('px01.user_a'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('px01.user_a'), true);
do $$
declare
  total bigint;
  own bigint;
  someone_elses bigint;
begin
  select count(*) into total from storage.objects;
  select count(*) into own from storage.objects
   where bucket_id = 'chat-uploads'
     and name = current_setting('px01.user_a') || '/fixture-a.png';
  select count(*) into someone_elses from storage.objects
   where name = current_setting('px01.user_b') || '/fixture-b.png';
  if own <> 1 then
    raise exception 'PX01 FAIL: owner A cannot see its own authorized fixture (expected 1, saw %)', own;
  end if;
  if someone_elses <> 0 then
    raise exception 'PX01 FAIL: account A can see account B''s fixture object (cross-tenant read)';
  end if;
  if total <> 1 then
    raise exception 'PX01 FAIL: account A sees % objects, expected exactly its own 1', total;
  end if;
end $$;
reset role;

-- 3c) Owner B sees its own object and cannot see A's.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('px01.user_b'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('px01.user_b'), true);
do $$
declare
  total bigint;
  own bigint;
  someone_elses bigint;
begin
  select count(*) into total from storage.objects;
  select count(*) into own from storage.objects
   where bucket_id = 'chat-uploads'
     and name = current_setting('px01.user_b') || '/fixture-b.png';
  select count(*) into someone_elses from storage.objects
   where name = current_setting('px01.user_a') || '/fixture-a.png';
  if own <> 1 then
    raise exception 'PX01 FAIL: owner B cannot see its own authorized fixture (expected 1, saw %)', own;
  end if;
  if someone_elses <> 0 then
    raise exception 'PX01 FAIL: account B can see account A''s fixture object (cross-tenant read)';
  end if;
  if total <> 1 then
    raise exception 'PX01 FAIL: account B sees % objects, expected exactly its own 1', total;
  end if;
end $$;
reset role;

-- 3d) The private owner path still works: A may insert into its own
-- chat-uploads folder, but not into buckets it has no authorized path into.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('px01.user_a'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('px01.user_a'), true);
do $$
begin
  insert into storage.objects (id, bucket_id, name, owner)
  values (
    gen_random_uuid(),
    'chat-uploads',
    current_setting('px01.user_a') || '/post-migration.png',
    current_setting('px01.user_a')::uuid
  );
exception
  when insufficient_privilege then
    raise exception 'PX01 FAIL: owner A can no longer insert into its own chat-uploads folder (private owner path was weakened)';
end $$;
do $$
begin
  insert into storage.objects (id, bucket_id, name, owner)
  values (
    gen_random_uuid(),
    'video-artifacts',
    current_setting('px01.user_a') || '/denied.png',
    current_setting('px01.user_a')::uuid
  );
  raise exception 'PX01 FAIL: A inserted into video-artifacts after the migration (broad upload policy still active)';
exception
  when insufficient_privilege then
    null; -- expected: denied
end $$;
reset role;

-- 3e) No broad allowing policy remains on storage.objects.
do $$
declare
  legacy bigint;
  broad bigint;
begin
  select count(*) into legacy
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname in ('Public read access', 'Users can upload to own folder');
  if legacy <> 0 then
    raise exception 'PX01 FAIL: % legacy broad policy rows are still registered on storage.objects', legacy;
  end if;

  select count(*) into broad
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and roles::text[] && array['public', 'anon']::text[]
    and (
      (cmd in ('SELECT', 'ALL') and btrim(coalesce(qual, '')) = 'true')
      or (cmd in ('INSERT', 'ALL') and btrim(coalesce(with_check, '')) = 'true')
    );
  if broad <> 0 then
    raise exception 'PX01 FAIL: % broad allowing (using/with_check true) policies for public/anon remain on storage.objects', broad;
  end if;
end $$;

-- 3f) Entitlements: service-managed, no self-escalation, not anon-readable.
insert into prismatix_internal.access_grants (subject_id, role, enabled, allowed_features)
values
  (current_setting('px01.user_a')::uuid, 'user', true, array['chat', 'video']::text[]),
  (current_setting('px01.user_b')::uuid, 'user', false, '{}'::text[]);

set local role anon;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare
  n bigint;
begin
  select count(*) into n from prismatix_internal.access_grants;
  raise exception 'PX01 FAIL: anon could read % access_grants rows', n;
exception
  when insufficient_privilege then
    null; -- expected: denied
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('px01.user_a'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('px01.user_a'), true);
do $$
declare
  mine bigint;
  others bigint;
  affected bigint;
begin
  select count(*) into mine from prismatix_internal.access_grants
   where subject_id = current_setting('px01.user_a')::uuid;
  select count(*) into others from prismatix_internal.access_grants
   where subject_id <> current_setting('px01.user_a')::uuid;
  if mine <> 1 then
    raise exception 'PX01 FAIL: A cannot select its own access_grants row (access_grants_select_self broken)';
  end if;
  if others <> 0 then
    raise exception 'PX01 FAIL: A can see other subjects'' access_grants rows';
  end if;

  -- The migration grants `authenticated` SELECT only on access_grants, so
  -- client writes are denied at the table ACL before RLS is ever consulted
  -- (42501). That denial is the containment. If an environment ever loosens
  -- the grants, RLS must still filter every row: 0 affected. Both outcomes
  -- pass; any row actually read or written fails.
  begin
    update prismatix_internal.access_grants
       set enabled = true,
           allowed_features = array['chat', 'review', 'video', 'memory', 'smd']::text[]
     where subject_id = current_setting('px01.user_b')::uuid;
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'PX01 FAIL: A updated another subject''s grant (self-escalation possible)';
    end if;
  exception
    when insufficient_privilege then
      null; -- expected: table-level ACL denies UPDATE to authenticated
  end;

  begin
    update prismatix_internal.access_grants
       set enabled = true
     where subject_id = current_setting('px01.user_a')::uuid;
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'PX01 FAIL: A updated its own grant (self-escalation possible)';
    end if;
  exception
    when insufficient_privilege then
      null; -- expected: table-level ACL denies UPDATE to authenticated
  end;

  begin
    delete from prismatix_internal.access_grants
     where subject_id = current_setting('px01.user_a')::uuid;
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'PX01 FAIL: A deleted access_grants rows';
    end if;
  exception
    when insufficient_privilege then
      null; -- expected: table-level ACL denies DELETE to authenticated
  end;
end $$;
do $$
begin
  insert into prismatix_internal.access_grants (subject_id, enabled, allowed_features)
  values (current_setting('px01.user_a')::uuid, true, array['chat']::text[]);
  raise exception 'PX01 FAIL: A inserted an access_grants row (self-escalation possible)';
exception
  when insufficient_privilege then
    null; -- expected: denied (no INSERT policy for authenticated)
end $$;
do $$
declare
  g jsonb;
begin
  g := public.get_access_grant(current_setting('px01.user_a')::uuid);
  raise exception 'PX01 FAIL: authenticated executed the service-only get_access_grant RPC (% returned)', g;
exception
  when insufficient_privilege then
    null; -- expected: denied
end $$;
reset role;

-- service_role path: the RPC the edge functions use returns A's grant, and
-- unknown subjects get NULL (no entitlement granted by default).
set local role service_role;
do $$
declare
  g jsonb;
begin
  g := public.get_access_grant(current_setting('px01.user_a')::uuid);
  if g is null then
    raise exception 'PX01 FAIL: service_role got NULL from get_access_grant for A';
  end if;
  if g->>'subject_id' <> current_setting('px01.user_a') then
    raise exception 'PX01 FAIL: get_access_grant returned the wrong subject';
  end if;
  if (g->>'enabled')::boolean is not true then
    raise exception 'PX01 FAIL: expected A''s fixture grant to be enabled';
  end if;
  if not ((g->'allowed_features') ? 'video') then
    raise exception 'PX01 FAIL: expected video in A''s allowed_features';
  end if;
  if public.get_access_grant(gen_random_uuid()) is not null then
    raise exception 'PX01 FAIL: a grant exists for an unknown subject (migration granted entitlements by default)';
  end if;
end $$;
reset role;

-- 3g) Cost ledger: clients may read their own rows but never write the ledger.
insert into public.cost_logs (user_id, model, input_tokens, output_tokens, total_cost)
values (current_setting('px01.user_a')::uuid, 'px01-probe-model', 1, 1, 0.000001);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('px01.user_a'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('px01.user_a'), true);
do $$
declare
  mine bigint;
begin
  select count(*) into mine from public.cost_logs
   where user_id = current_setting('px01.user_a')::uuid;
  if mine < 1 then
    raise exception 'PX01 FAIL: A cannot read its own cost_logs rows (cost_logs_select_own broken)';
  end if;
end $$;
do $$
begin
  insert into public.cost_logs (user_id, model, input_tokens, output_tokens, total_cost)
  values (current_setting('px01.user_a')::uuid, 'px01-forged', 0, 0, 0);
  raise exception 'PX01 FAIL: client insert into cost_logs succeeded after the migration';
exception
  when insufficient_privilege then
    null; -- expected: denied (cost_logs_insert_own removed)
end $$;
reset role;

-- 3h) video_assets: client INSERT is stripped of worker-owned fields, client
-- UPDATE is impossible, non-service superuser UPDATE is rejected by the
-- trigger, and the service_role write path is untouched.
do $$
begin
  perform set_config('px01.probe_path', current_setting('px01.user_a') || '/px01-probe/source.mp4', true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('px01.user_a'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('px01.user_a'), true);
do $$
begin
  -- Client forges a fully-processed asset; the trigger must strip all of it.
  insert into public.video_assets (
    user_id, storage_bucket, storage_path, mime_type, file_size_bytes,
    status, metadata, duration_ms, width, height, checksum_sha256,
    error_code, error_message
  )
  values (
    current_setting('px01.user_a')::uuid,
    'video-uploads',
    current_setting('px01.probe_path'),
    'video/mp4',
    1024,
    'ready',
    '{"attacker":"controlled"}'::jsonb,
    999, 640, 480, 'deadbeef',
    'none', 'forged'
  );
end $$;
do $$
declare
  affected bigint;
begin
  -- Post-migration there is no UPDATE policy for authenticated. Where the
  -- table grant still exists (Supabase default), RLS filters every row:
  -- 0 affected. Where the grant was revoked, the ACL denies outright. Both
  -- are containment; a row actually updated is not.
  begin
    update public.video_assets
       set status = 'ready',
           metadata = '{"forged":true}'::jsonb
     where storage_path = current_setting('px01.probe_path');
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'PX01 FAIL: client UPDATE on video_assets affected % rows (video_assets_update_own not removed)', affected;
    end if;
  exception
    when insufficient_privilege then
      null; -- expected under revoked grants: denied before RLS
  end;
end $$;
reset role;

do $$
declare
  r public.video_assets;
begin
  select * into r from public.video_assets
   where storage_path = current_setting('px01.probe_path');
  if r.id is null then
    raise exception 'PX01 FAIL: client-inserted probe asset row is missing';
  end if;
  if r.status::text <> 'uploaded' then
    raise exception 'PX01 FAIL: client-forged status "%" was not forced to uploaded', r.status::text;
  end if;
  if r.metadata::text <> '{}' then
    raise exception 'PX01 FAIL: client-forged metadata % was not forced to empty', r.metadata::text;
  end if;
  if r.duration_ms is not null or r.width is not null or r.height is not null
     or r.checksum_sha256 is not null or r.error_code is not null or r.error_message is not null then
    raise exception 'PX01 FAIL: worker-owned columns were not nulled on client INSERT';
  end if;
  if r.user_id::text <> current_setting('px01.user_a') then
    raise exception 'PX01 FAIL: probe asset row belongs to the wrong user';
  end if;
end $$;

-- Non-service role that bypasses RLS (superuser) is still rejected by the
-- trigger: authoritative worker fields are not client-writable.
do $$
begin
  update public.video_assets
     set status = 'ready'
   where storage_path = current_setting('px01.probe_path');
  raise exception 'PX01 FAIL: non-service UPDATE on video_assets succeeded (trigger not enforcing)';
exception
  when insufficient_privilege then
    null; -- expected: enforce_video_asset_client_write rejects it
end $$;

-- service_role write path preserved.
set local role service_role;
do $$
declare
  affected bigint;
begin
  update public.video_assets
     set status = 'processing',
         metadata = '{"gemini_state":"PROCESSING"}'::jsonb
   where storage_path = current_setting('px01.probe_path');
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'PX01 FAIL: service_role UPDATE on video_assets was blocked (% rows affected)', affected;
  end if;
end $$;
reset role;

do $$
declare
  r public.video_assets;
begin
  select * into r from public.video_assets
   where storage_path = current_setting('px01.probe_path');
  if r.status::text <> 'processing' then
    raise exception 'PX01 FAIL: service_role write did not persist (status=%)', r.status::text;
  end if;
end $$;

-- anon INSERT denied.
set local role anon;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  insert into public.video_assets (user_id, storage_bucket, storage_path, mime_type, file_size_bytes)
  values (
    current_setting('px01.user_a')::uuid,
    'video-uploads',
    current_setting('px01.user_a') || '/px01-anon/source.mp4',
    'video/mp4',
    10
  );
  raise exception 'PX01 FAIL: anon insert into video_assets succeeded';
exception
  when insufficient_privilege then
    null; -- expected: denied
end $$;
reset role;

-- 3i) video_jobs: clients cannot enqueue directly. The only enqueue path is
-- the entitlement-gated video-intake function (service_role client); the
-- owner SELECT path (video_jobs_select_own) is preserved.
do $$
begin
  perform set_config('px01.probe_asset_id', id::text, true)
  from public.video_assets
  where storage_path = current_setting('px01.probe_path');
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('px01.user_a'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('px01.user_a'), true);
do $$
begin
  insert into public.video_jobs (asset_id, status)
  values (current_setting('px01.probe_asset_id')::uuid, 'queued');
  raise exception 'PX01 FAIL: client insert into video_jobs succeeded after the migration (enqueue without entitlement possible)';
exception
  when insufficient_privilege then
    null; -- expected: denied (video_jobs_insert_own removed)
end $$;
reset role;

set local role service_role;
do $$
declare
  affected bigint;
begin
  insert into public.video_jobs (asset_id, status)
  values (current_setting('px01.probe_asset_id')::uuid, 'queued');
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'PX01 FAIL: service_role could not enqueue a video_jobs row (gated video-intake path broken)';
  end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('px01.user_a'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('px01.user_a'), true);
do $$
declare
  visible bigint;
begin
  select count(*) into visible from public.video_jobs
   where asset_id = current_setting('px01.probe_asset_id')::uuid;
  if visible <> 1 then
    raise exception 'PX01 FAIL: owner A cannot see the job row for its own asset (video_jobs_select_own broken)';
  end if;
end $$;
reset role;

rollback;

\echo 'tests/security/storage-isolation.sql: PASS (all PX01 containment assertions held)'
