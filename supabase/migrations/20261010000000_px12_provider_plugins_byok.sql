-- PX12: Provider plug-ins + BYOK.
--
-- Every non-OpenCode provider becomes an opt-in plug-in: a user connects their
-- own API key and toggles the provider on. Keys are stored as AES-256-GCM
-- ciphertext (encrypted/decrypted in the edge function; see
-- supabase/functions/_shared/byok_crypto.ts) and are NEVER returned to a
-- client. Plaintext exists only in edge-function memory.
--
-- SECURITY: fail closed. The internal schema is not PostgREST-exposed and all
-- RPCs are service_role-only; ownership is enforced by the calling edge
-- function which passes the authenticated subject id explicitly.
--
-- Idempotent: safe to re-run.

create schema if not exists prismatix_internal;

-- ---------------------------------------------------------------------------
-- 1) Per-user provider credentials (BYOK).
-- ---------------------------------------------------------------------------
create table if not exists prismatix_internal.user_provider_keys (
  subject_id uuid not null references auth.users(id) on delete cascade,
  provider text not null
    check (provider in ('opencode','openrouter','anthropic','openai','google','nvidia','deepinfra')),
  enabled boolean not null default false,
  -- base64(iv || AES-256-GCM ciphertext). NULL means no key stored yet.
  key_ciphertext text,
  -- Display-only tail ("ab12"); never sufficient to reconstruct the key.
  key_last4 text,
  -- sha256 hex of the plaintext; for dedupe/audit only.
  key_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (subject_id, provider)
);

alter table prismatix_internal.user_provider_keys enable row level security;

-- Select-own only (defense in depth; the schema is not exposed anyway).
-- No INSERT/UPDATE/DELETE policy exists, so with RLS on every client write is
-- denied; writes are service_role only.
drop policy if exists user_provider_keys_select_self on prismatix_internal.user_provider_keys;
create policy user_provider_keys_select_self on prismatix_internal.user_provider_keys
  for select
  to authenticated
  using (subject_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2) Per-user default provider preference (which first-class gateway to use).
-- ---------------------------------------------------------------------------
create table if not exists prismatix_internal.user_provider_prefs (
  subject_id uuid primary key references auth.users(id) on delete cascade,
  default_provider text not null default 'opencode'
    check (default_provider in ('opencode','openrouter')),
  updated_at timestamptz not null default now()
);

alter table prismatix_internal.user_provider_prefs enable row level security;

drop policy if exists user_provider_prefs_select_self on prismatix_internal.user_provider_prefs;
create policy user_provider_prefs_select_self on prismatix_internal.user_provider_prefs
  for select
  to authenticated
  using (subject_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3) Grants.
-- ---------------------------------------------------------------------------
revoke all on schema prismatix_internal from public;
revoke all on schema prismatix_internal from anon;
revoke all on prismatix_internal.user_provider_keys from public;
revoke all on prismatix_internal.user_provider_keys from anon;
revoke all on prismatix_internal.user_provider_prefs from public;
revoke all on prismatix_internal.user_provider_prefs from anon;
grant usage on schema prismatix_internal to authenticated;
grant usage on schema prismatix_internal to service_role;
grant select on prismatix_internal.user_provider_keys to authenticated;
grant select on prismatix_internal.user_provider_prefs to authenticated;
grant select, insert, update, delete on prismatix_internal.user_provider_keys to service_role;
grant select, insert, update, delete on prismatix_internal.user_provider_prefs to service_role;

-- ---------------------------------------------------------------------------
-- 4) RPCs (service_role only). Metadata never includes the ciphertext except
--    through get_user_provider_key_material, which the router alone calls.
-- ---------------------------------------------------------------------------

-- Upsert a credential row. Encryption happens in the edge function.
create or replace function public.set_user_provider_key(
  p_subject_id uuid,
  p_provider text,
  p_ciphertext text,
  p_last4 text,
  p_fingerprint text,
  p_enabled boolean
)
returns void
language sql
security definer
set search_path = public, prismatix_internal
as $$
  insert into prismatix_internal.user_provider_keys
    (subject_id, provider, key_ciphertext, key_last4, key_fingerprint, enabled, updated_at)
  values
    (p_subject_id, p_provider, p_ciphertext, p_last4, p_fingerprint, coalesce(p_enabled, false), now())
  on conflict (subject_id, provider) do update set
    key_ciphertext = excluded.key_ciphertext,
    key_last4 = excluded.key_last4,
    key_fingerprint = excluded.key_fingerprint,
    enabled = excluded.enabled,
    updated_at = now();
$$;

-- Toggle a provider without touching the stored key.
create or replace function public.set_user_provider_enabled(
  p_subject_id uuid,
  p_provider text,
  p_enabled boolean
)
returns void
language sql
security definer
set search_path = public, prismatix_internal
as $$
  insert into prismatix_internal.user_provider_keys
    (subject_id, provider, enabled, updated_at)
  values
    (p_subject_id, p_provider, coalesce(p_enabled, false), now())
  on conflict (subject_id, provider) do update set
    enabled = excluded.enabled,
    updated_at = now();
$$;

-- Remove a credential row entirely (disconnect).
create or replace function public.delete_user_provider_key(
  p_subject_id uuid,
  p_provider text
)
returns void
language sql
security definer
set search_path = public, prismatix_internal
as $$
  delete from prismatix_internal.user_provider_keys
  where subject_id = p_subject_id and provider = p_provider;
$$;

-- Choose the default gateway; choosing it also turns it on.
create or replace function public.set_user_default_provider(
  p_subject_id uuid,
  p_provider text
)
returns void
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
begin
  if p_provider not in ('opencode','openrouter') then
    raise exception 'invalid default provider: %', p_provider using errcode = '22023';
  end if;

  insert into prismatix_internal.user_provider_prefs (subject_id, default_provider, updated_at)
  values (p_subject_id, p_provider, now())
  on conflict (subject_id) do update set
    default_provider = excluded.default_provider,
    updated_at = now();

  insert into prismatix_internal.user_provider_keys (subject_id, provider, enabled, updated_at)
  values (p_subject_id, p_provider, true, now())
  on conflict (subject_id, provider) do update set
    enabled = true,
    updated_at = now();
end;
$$;

-- Metadata-only read (no ciphertext) for the client-facing settings surface.
create or replace function public.get_user_provider_config(p_subject_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, prismatix_internal
as $$
  select jsonb_build_object(
    'default_provider',
    coalesce(
      (select default_provider from prismatix_internal.user_provider_prefs where subject_id = p_subject_id),
      'opencode'
    ),
    'providers',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'provider', k.provider,
            'enabled', k.enabled,
            'has_key', (k.key_ciphertext is not null),
            'key_last4', k.key_last4,
            'updated_at', k.updated_at
          )
        )
        from prismatix_internal.user_provider_keys k
        where k.subject_id = p_subject_id
      ),
      '[]'::jsonb
    )
  );
$$;

-- Ciphertext read for the router only.
create or replace function public.get_user_provider_key_material(
  p_subject_id uuid,
  p_provider text
)
returns text
language sql
stable
security definer
set search_path = public, prismatix_internal
as $$
  select key_ciphertext
  from prismatix_internal.user_provider_keys
  where subject_id = p_subject_id and provider = p_provider;
$$;

revoke all on function public.set_user_provider_key(uuid, text, text, text, text, boolean) from public;
revoke all on function public.set_user_provider_enabled(uuid, text, boolean) from public;
revoke all on function public.delete_user_provider_key(uuid, text) from public;
revoke all on function public.set_user_default_provider(uuid, text) from public;
revoke all on function public.get_user_provider_config(uuid) from public;
revoke all on function public.get_user_provider_key_material(uuid, text) from public;

revoke execute on function public.set_user_provider_key(uuid, text, text, text, text, boolean) from anon, authenticated;
revoke execute on function public.set_user_provider_enabled(uuid, text, boolean) from anon, authenticated;
revoke execute on function public.delete_user_provider_key(uuid, text) from anon, authenticated;
revoke execute on function public.set_user_default_provider(uuid, text) from anon, authenticated;
revoke execute on function public.get_user_provider_config(uuid) from anon, authenticated;
revoke execute on function public.get_user_provider_key_material(uuid, text) from anon, authenticated;

grant execute on function public.set_user_provider_key(uuid, text, text, text, text, boolean) to service_role;
grant execute on function public.set_user_provider_enabled(uuid, text, boolean) to service_role;
grant execute on function public.delete_user_provider_key(uuid, text) to service_role;
grant execute on function public.set_user_default_provider(uuid, text) to service_role;
grant execute on function public.get_user_provider_config(uuid) to service_role;
grant execute on function public.get_user_provider_key_material(uuid, text) to service_role;
