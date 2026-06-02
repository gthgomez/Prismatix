-- Harden router RPC privileges and codify private chat upload storage.
-- Direct authenticated clients should not be able to request spend stats for
-- arbitrary users or increment arbitrary conversation token counters.

create or replace function public.increment_token_count(
  p_conversation_id uuid,
  p_tokens integer
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversations
  set total_tokens = total_tokens + greatest(p_tokens, 0)
  where id = p_conversation_id
    and user_id = auth.uid();
$$;

create or replace function public.increment_token_count_for_user(
  p_conversation_id uuid,
  p_user_id uuid,
  p_tokens integer
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversations
  set total_tokens = total_tokens + greatest(p_tokens, 0)
  where id = p_conversation_id
    and user_id = p_user_id;
$$;

revoke all on function public.increment_token_count(uuid, integer) from public;
revoke execute on function public.increment_token_count(uuid, integer) from anon;
grant execute on function public.increment_token_count(uuid, integer) to authenticated;

revoke all on function public.increment_token_count_for_user(uuid, uuid, integer) from public;
revoke execute on function public.increment_token_count_for_user(uuid, uuid, integer) from anon;
revoke execute on function public.increment_token_count_for_user(uuid, uuid, integer) from authenticated;
grant execute on function public.increment_token_count_for_user(uuid, uuid, integer) to service_role;

revoke all on function public.get_spend_stats(uuid) from public;
revoke execute on function public.get_spend_stats(uuid) from anon;
revoke execute on function public.get_spend_stats(uuid) from authenticated;
grant execute on function public.get_spend_stats(uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-uploads',
  'chat-uploads',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat_uploads_insert_own" on storage.objects;
drop policy if exists "chat_uploads_select_own" on storage.objects;
drop policy if exists "chat_uploads_update_own" on storage.objects;
drop policy if exists "chat_uploads_delete_own" on storage.objects;

create policy "chat_uploads_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "chat_uploads_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "chat_uploads_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'chat-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'chat-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "chat_uploads_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);
