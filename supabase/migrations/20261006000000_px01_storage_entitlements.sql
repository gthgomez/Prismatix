-- PX01: Close storage exposure and add server-managed access entitlements.
-- Findings addressed: F01, F04, F08, F19, F22.
--
-- SECURITY: fail closed. Removes the drifted dashboard-created broad storage
-- policies, strips client write access to authoritative cost/worker fields,
-- and gates paid execution behind service-managed grants. No user entitlement
-- is granted by default; rows in prismatix_internal.access_grants are created
-- out-of-band by operators (service_role only).
--
-- Idempotent: safe to re-run. Verify with tests/security/storage-isolation.sql
-- (run from the repo root against an already-migrated database):
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/security/storage-isolation.sql

-- ---------------------------------------------------------------------------
-- 1) Remove drifted broad storage policies (dashboard-created; never present
--    in any migration). The owner-only chat_uploads_*_own policies and the
--    video bucket policies are intentionally preserved. No broad policy is
--    recreated; private owner paths and service-role access are unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists "Public read access" on storage.objects;
drop policy if exists "Users can upload to own folder" on storage.objects;

-- ---------------------------------------------------------------------------
-- 2) Server-managed approved-user entitlements (internal schema, NOT exposed
--    via PostgREST: it stays out of [api].schemas and anon gets no grants).
-- ---------------------------------------------------------------------------
create schema if not exists prismatix_internal;

create table if not exists prismatix_internal.access_grants (
  subject_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','admin')),
  enabled boolean not null default false,
  allowed_features text[] not null default '{}',
  max_daily_usd numeric(12,6),
  max_per_execution_usd numeric(12,6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table prismatix_internal.access_grants enable row level security;

-- Users may SELECT only their own row. No INSERT/UPDATE/DELETE policies exist
-- for anon/authenticated, so with RLS enabled every client write path is
-- denied; writes are service_role only (no self-escalation).
drop policy if exists access_grants_select_self on prismatix_internal.access_grants;
create policy access_grants_select_self on prismatix_internal.access_grants
  for select
  to authenticated
  using (subject_id = auth.uid());

-- Grants: nothing for anon/public. authenticated may select only its own row
-- through the RLS policy above (and only if the schema were ever exposed,
-- which it is not). service_role manages rows.
revoke all on schema prismatix_internal from public;
revoke all on schema prismatix_internal from anon;
revoke all on prismatix_internal.access_grants from public;
revoke all on prismatix_internal.access_grants from anon;
grant usage on schema prismatix_internal to authenticated;
grant usage on schema prismatix_internal to service_role;
grant select on prismatix_internal.access_grants to authenticated;
grant select, insert, update, delete on prismatix_internal.access_grants to service_role;

-- Edge functions read grants through this service_role-only definer RPC in the
-- exposed public schema, so prismatix_internal never needs PostgREST exposure.
-- See supabase/functions/_shared/access_policy.ts (loadAccessGrant).
create or replace function public.get_access_grant(p_subject_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, prismatix_internal
as $$
  select to_jsonb(g)
  from prismatix_internal.access_grants g
  where g.subject_id = p_subject_id;
$$;

revoke all on function public.get_access_grant(uuid) from public;
revoke execute on function public.get_access_grant(uuid) from anon;
revoke execute on function public.get_access_grant(uuid) from authenticated;
grant execute on function public.get_access_grant(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Cost ledger is server-written only. The router (service_role) records
--    spend; clients may still read their own rows via cost_logs_select_own.
-- ---------------------------------------------------------------------------
drop policy if exists cost_logs_insert_own on public.cost_logs;

-- ---------------------------------------------------------------------------
-- 4) video_assets: keep owner SELECT (video_assets_select_own) and own-row
--    INSERT (video_assets_insert_own), remove user UPDATE, and strip
--    worker-owned fields from any non-service write via trigger.
-- ---------------------------------------------------------------------------
drop policy if exists video_assets_update_own on public.video_assets;

create or replace function public.enforce_video_asset_client_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'video_assets: UPDATE is restricted to service_role'
      using errcode = '42501';
  end if;

  -- INSERT from a non-service role: force the safe post-upload state and null
  -- every worker-owned column so clients cannot fake processing results,
  -- statuses, checksums, or Gemini metadata.
  new.status := 'uploaded';
  new.metadata := '{}'::jsonb;
  new.duration_ms := null;
  new.width := null;
  new.height := null;
  new.checksum_sha256 := null;
  new.error_code := null;
  new.error_message := null;
  return new;
end;
$$;

drop trigger if exists enforce_video_asset_client_write on public.video_assets;
create trigger enforce_video_asset_client_write
before insert or update on public.video_assets
for each row
execute function public.enforce_video_asset_client_write();
