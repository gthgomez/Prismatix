-- supabase/migrations/20261107060000_wave2_multimodal.sql
-- F28 (BYOK Image Generation), F29 (Durable Artifacts & Versioning), and Multimodal Integration.

-- 1. Artifacts table for durable generated code/documents with version history
create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  title text not null,
  language text not null default 'text',
  current_content text not null,
  versions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.artifacts enable row level security;

drop policy if exists "Users can view their own artifacts" on public.artifacts;
create policy "Users can view their own artifacts"
  on public.artifacts for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own artifacts" on public.artifacts;
create policy "Users can insert their own artifacts"
  on public.artifacts for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = artifacts.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update their own artifacts" on public.artifacts;
create policy "Users can update their own artifacts"
  on public.artifacts for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = artifacts.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete their own artifacts" on public.artifacts;
create policy "Users can delete their own artifacts"
  on public.artifacts for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists idx_artifacts_user_id on public.artifacts (user_id);
create index if not exists idx_artifacts_conversation_id on public.artifacts (conversation_id);

-- 2. Server-owned atomic RPC for image generation message persistence (F28)
-- Prevents authenticated client direct inserts into public.messages,
-- truthfully sets settled vs unmetered cost depending on mock status.
create or replace function public.px28_record_image_message(
  p_conversation_id uuid,
  p_content text,
  p_model text,
  p_image_result jsonb,
  p_is_mock boolean default false
)
returns public.messages
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_conv_owner uuid;
  v_new_message public.messages;
  v_cost_status text;
  v_final_cost numeric;
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  -- Defense-in-depth: Never allow client requests (authenticated role) to forge settled cost.
  -- Only server-owned execution (service_role) or authoritative backend receipt can record 'settled'.
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated' then
    if not coalesce(p_is_mock, false) then
      raise exception 'client_settlement_prohibited: authenticated clients cannot forge settled image executions';
    end if;
    v_cost_status := 'unmetered';
    v_final_cost := 0;
  else
    v_cost_status := case when p_is_mock then 'unmetered' else 'settled' end;
    v_final_cost := case when p_is_mock then 0 else coalesce((p_image_result->>'costUsd')::numeric, 0) end;
  end if;

  select user_id into v_conv_owner
  from public.conversations
  where id = p_conversation_id;

  if v_conv_owner is null or v_conv_owner != v_user_id then
    raise exception 'conversation_not_found';
  end if;

  insert into public.messages (
    id,
    conversation_id,
    role,
    content,
    model_used,
    metadata,
    created_at
  ) values (
    gen_random_uuid(),
    p_conversation_id,
    'assistant',
    p_content,
    p_model,
    jsonb_build_object(
      'type', 'image_generation',
      'imageGeneration', p_image_result,
      'cost', jsonb_build_object(
        'status', v_cost_status,
        'finalUsd', v_final_cost
      )
    ),
    now()
  )
  returning * into v_new_message;

  return v_new_message;
end;
$$;

revoke all on function public.px28_record_image_message(uuid, text, text, jsonb, boolean) from public;
revoke all on function public.px28_record_image_message(uuid, text, text, jsonb, boolean) from anon;
grant execute on function public.px28_record_image_message(uuid, text, text, jsonb, boolean) to authenticated;
grant execute on function public.px28_record_image_message(uuid, text, text, jsonb, boolean) to service_role;

-- 3. Atomic RPC for persisting artifact revisions (F29)
create or replace function public.px29_save_artifact_revision(
  p_artifact_id uuid,
  p_content text,
  p_author text default 'user'
)
returns public.artifacts
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_artifact public.artifacts;
  v_versions jsonb;
  v_new_version_num int;
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  select * into v_artifact
  from public.artifacts
  where id = p_artifact_id and user_id = v_user_id;

  if v_artifact.id is null then
    raise exception 'artifact_not_found';
  end if;

  v_versions := coalesce(v_artifact.versions, '[]'::jsonb);
  v_new_version_num := jsonb_array_length(v_versions) + 1;

  v_versions := v_versions || jsonb_build_object(
    'versionNumber', v_new_version_num,
    'content', p_content,
    'savedAt', now(),
    'author', p_author
  );

  update public.artifacts
  set
    current_content = p_content,
    versions = v_versions,
    updated_at = now()
  where id = p_artifact_id and user_id = v_user_id
  returning * into v_artifact;

  return v_artifact;
end;
$$;

revoke all on function public.px29_save_artifact_revision(uuid, text, text) from public;
revoke all on function public.px29_save_artifact_revision(uuid, text, text) from anon;
grant execute on function public.px29_save_artifact_revision(uuid, text, text) to authenticated;
grant execute on function public.px29_save_artifact_revision(uuid, text, text) to service_role;
