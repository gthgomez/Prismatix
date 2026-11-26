-- Dynamic BYOK inventory authorization. Rows remain service-role only.
-- Rollback: provider settings must be reverted alongside this migration; dropping
-- the two columns discards snapshots/revisions but does not destroy credentials.
alter table prismatix_internal.user_provider_keys
  add column if not exists credential_revision text not null default gen_random_uuid()::text,
  add column if not exists inventory jsonb;

alter table prismatix_internal.user_provider_keys drop constraint if exists user_provider_keys_provider_check;
alter table prismatix_internal.user_provider_keys add constraint user_provider_keys_provider_check
  check (provider in ('opencode','opencode_go','commandcode','openrouter','anthropic','openai','google','nvidia','deepinfra','brave'));

alter table prismatix_internal.user_provider_prefs alter column default_provider drop default;
alter table prismatix_internal.user_provider_prefs drop constraint if exists user_provider_prefs_default_provider_check;
alter table prismatix_internal.user_provider_prefs add constraint user_provider_prefs_default_provider_check
  check (default_provider in ('opencode','opencode_go','commandcode','openrouter','anthropic','openai','google','nvidia','deepinfra'));

-- Every legacy server-key OpenCode row is explicitly unverified and disabled.
update prismatix_internal.user_provider_keys
set enabled = false, inventory = jsonb_build_object('status','unverified','discoveredAt',null,'checkedAt',now(),'modelCount',0,'routes','[]'::jsonb),
    credential_revision = gen_random_uuid()::text
where provider = 'opencode' and inventory is null;

create or replace function public.set_user_provider_key(p_subject_id uuid,p_provider text,p_ciphertext text,p_last4 text,p_fingerprint text,p_enabled boolean)
returns void language plpgsql security definer set search_path = pg_catalog, prismatix_internal as $$
begin
  insert into prismatix_internal.user_provider_keys(subject_id,provider,key_ciphertext,key_last4,key_fingerprint,enabled,credential_revision,inventory,updated_at)
  values(p_subject_id,p_provider,p_ciphertext,p_last4,p_fingerprint,coalesce(p_enabled,false),gen_random_uuid()::text,null,now())
  on conflict(subject_id,provider) do update set key_ciphertext=excluded.key_ciphertext,key_last4=excluded.key_last4,key_fingerprint=excluded.key_fingerprint,
    enabled=excluded.enabled,credential_revision=gen_random_uuid()::text,inventory=null,updated_at=now();
end $$;

create or replace function public.set_user_provider_enabled(p_subject_id uuid,p_provider text,p_enabled boolean)
returns void language plpgsql security definer set search_path = pg_catalog, prismatix_internal as $$
begin
  if coalesce(p_enabled,false) and p_provider <> 'brave' and not exists(select 1 from prismatix_internal.user_provider_keys k where k.subject_id=p_subject_id and k.provider=p_provider and k.key_ciphertext is not null and k.inventory->>'status'='verified' and (k.inventory->>'discoveredAt')::timestamptz > now()-interval '24 hours') then
    raise exception 'provider_inventory_not_verified' using errcode='22023';
  end if;
  update prismatix_internal.user_provider_keys set enabled=coalesce(p_enabled,false),credential_revision=gen_random_uuid()::text,updated_at=now()
  where subject_id=p_subject_id and provider=p_provider;
  if not found then insert into prismatix_internal.user_provider_keys(subject_id,provider,enabled) values(p_subject_id,p_provider,false); end if;
end $$;

create or replace function public.set_user_default_provider(p_subject_id uuid,p_provider text)
returns void language plpgsql security definer set search_path = pg_catalog, prismatix_internal as $$
begin
  if p_provider not in ('opencode','opencode_go','commandcode','openrouter','anthropic','openai','google','nvidia','deepinfra') then raise exception 'invalid default provider' using errcode='22023'; end if;
  if not exists(select 1 from prismatix_internal.user_provider_keys k where k.subject_id=p_subject_id and k.provider=p_provider and k.enabled and k.key_ciphertext is not null and k.inventory->>'status'='verified' and (k.inventory->>'discoveredAt')::timestamptz > now()-interval '24 hours' and exists (select 1 from jsonb_array_elements(k.inventory->'routes') r where not (coalesce(k.inventory->'restrictedRouteIds','[]'::jsonb) ? (r->>'id')))) then
    raise exception 'provider_inventory_not_verified' using errcode='22023';
  end if;
  insert into prismatix_internal.user_provider_prefs(subject_id,default_provider,updated_at) values(p_subject_id,p_provider,now())
  on conflict(subject_id) do update set default_provider=excluded.default_provider,updated_at=now();
end $$;

create or replace function public.get_user_provider_config(p_subject_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,prismatix_internal as $$
  select jsonb_build_object(
    'default_provider', (select p.default_provider from prismatix_internal.user_provider_prefs p where p.subject_id=p_subject_id and exists(
      select 1 from prismatix_internal.user_provider_keys k where k.subject_id=p.subject_id and k.provider=p.default_provider and k.enabled and k.key_ciphertext is not null and k.inventory->>'status'='verified' and (k.inventory->>'discoveredAt')::timestamptz > now()-interval '24 hours' and exists (select 1 from jsonb_array_elements(k.inventory->'routes') r where not (coalesce(k.inventory->'restrictedRouteIds','[]'::jsonb) ? (r->>'id'))))),
    'providers', coalesce((select jsonb_agg(jsonb_build_object('provider',k.provider,'enabled',k.enabled,'has_key',(k.key_ciphertext is not null),'key_last4',k.key_last4,'updated_at',k.updated_at,'credential_revision',k.credential_revision,'inventory',k.inventory)) from prismatix_internal.user_provider_keys k where k.subject_id=p_subject_id),'[]'::jsonb));
$$;

create or replace function public.save_user_provider_inventory(p_subject_id uuid,p_provider text,p_credential_revision text,p_expected_ciphertext text,p_inventory jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,prismatix_internal as $$
begin
  update prismatix_internal.user_provider_keys k set inventory=p_inventory,credential_revision=gen_random_uuid()::text,updated_at=now()
  where k.subject_id=p_subject_id and k.provider=p_provider and k.key_ciphertext=p_expected_ciphertext and k.credential_revision=p_credential_revision;
  return found;
end $$;

create or replace function public.get_user_provider_dispatch_key(p_subject_id uuid,p_provider text,p_credential_revision text,p_route_id text)
returns text language plpgsql volatile security definer set search_path=pg_catalog,prismatix_internal as $$
declare result text;
begin
  select k.key_ciphertext into result from prismatix_internal.user_provider_keys k
  where k.subject_id=p_subject_id and k.provider=p_provider and k.enabled and k.key_ciphertext is not null and k.credential_revision=p_credential_revision
    and k.inventory->>'status'='verified' and (k.inventory->>'discoveredAt')::timestamptz > now()-interval '24 hours'
    and not (coalesce(k.inventory->'restrictedRouteIds','[]'::jsonb) ? p_route_id)
    and exists(select 1 from jsonb_array_elements(k.inventory->'routes') r
      where r->>'id'=p_route_id and ((r->'tariff'->>'expiresAt') is null or (r->'tariff'->>'expiresAt')::timestamptz > now()))
  for update;
  return result;
end $$;

revoke all on function public.save_user_provider_inventory(uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.get_user_provider_dispatch_key(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.save_user_provider_inventory(uuid,text,text,text,jsonb) to service_role;
grant execute on function public.get_user_provider_dispatch_key(uuid,text,text,text) to service_role;

-- Provider dispatch failures can invalidate the exact snapshot generation the
-- router just used without clobbering a replacement credential's new snapshot.
create or replace function public.invalidate_user_provider_inventory(
  p_subject_id uuid,p_provider text,p_credential_revision text,p_route_id text,p_status text
)
returns boolean language plpgsql security definer set search_path=pg_catalog,prismatix_internal as $$
declare current_inventory jsonb;
begin
  select inventory into current_inventory from prismatix_internal.user_provider_keys
  where subject_id=p_subject_id and provider=p_provider and credential_revision=p_credential_revision for update;
  if not found then return false; end if;
  if p_status='invalid_revoked' then
    update prismatix_internal.user_provider_keys set inventory=jsonb_set(jsonb_set(coalesce(current_inventory,'{}'::jsonb),'{status}','"invalid_revoked"'::jsonb),'{routes}','[]'::jsonb),credential_revision=gen_random_uuid()::text,updated_at=now()
    where subject_id=p_subject_id and provider=p_provider and credential_revision=p_credential_revision;
  elsif p_status in ('restricted','unavailable') then
    update prismatix_internal.user_provider_keys set inventory=jsonb_set(coalesce(current_inventory,'{}'::jsonb),'{restrictedRouteIds}',
      (select coalesce(jsonb_agg(distinct value),'[]'::jsonb) from jsonb_array_elements_text(coalesce(current_inventory->'restrictedRouteIds','[]'::jsonb)) e(value) where value<>p_route_id) || jsonb_build_array(p_route_id)),credential_revision=gen_random_uuid()::text,updated_at=now()
    where subject_id=p_subject_id and provider=p_provider and credential_revision=p_credential_revision;
  elsif p_status='retired' then
    update prismatix_internal.user_provider_keys set inventory=jsonb_set(coalesce(current_inventory,'{}'::jsonb),'{routes}',
      (select coalesce(jsonb_agg(route),'[]'::jsonb) from jsonb_array_elements(coalesce(current_inventory->'routes','[]'::jsonb)) route where route->>'id'<>p_route_id)),credential_revision=gen_random_uuid()::text,updated_at=now()
    where subject_id=p_subject_id and provider=p_provider and credential_revision=p_credential_revision;
  else
    raise exception 'invalid_provider_inventory_status' using errcode='22023';
  end if;
  return found;
end $$;

revoke all on function public.invalidate_user_provider_inventory(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.invalidate_user_provider_inventory(uuid,text,text,text,text) to service_role;

-- Public enrichment snapshots are versioned separately from account inventory.
-- Only server code can write this source. The catalog has no credential fields.
create table if not exists prismatix_internal.provider_catalog_snapshots (
  version text primary key,
  fetched_at timestamptz not null default now(),
  models jsonb not null check (jsonb_typeof(models) = 'object')
);
alter table prismatix_internal.provider_catalog_snapshots enable row level security;
revoke all on prismatix_internal.provider_catalog_snapshots from public, anon, authenticated;

create or replace function public.get_provider_catalog_snapshot()
returns jsonb language sql stable security definer set search_path=pg_catalog,prismatix_internal as $$
  select to_jsonb(s) from prismatix_internal.provider_catalog_snapshots s order by fetched_at desc limit 1;
$$;

create or replace function public.save_provider_catalog_snapshot(p_version text, p_models jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,prismatix_internal as $$
begin
  if p_version !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_models) <> 'object' or p_models = '{}'::jsonb
      or pg_column_size(p_models) > 1048576 then
    raise exception 'invalid_provider_catalog' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('prismatix_provider_catalog', 0));
  insert into prismatix_internal.provider_catalog_snapshots(version,models) values (p_version,p_models)
  on conflict (version) do update set fetched_at=now();
  delete from prismatix_internal.provider_catalog_snapshots
  where version in (select version from prismatix_internal.provider_catalog_snapshots order by fetched_at desc offset 5);
end $$;

revoke all on function public.get_provider_catalog_snapshot() from public,anon,authenticated;
revoke all on function public.save_provider_catalog_snapshot(text,jsonb) from public,anon,authenticated;
grant execute on function public.get_provider_catalog_snapshot() to service_role;
grant execute on function public.save_provider_catalog_snapshot(text,jsonb) to service_role;
