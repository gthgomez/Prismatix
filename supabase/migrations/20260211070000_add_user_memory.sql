-- Long-term user memory tables for Prismatix router

create table if not exists public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  source_window_end_at timestamptz not null,
  summary_text text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists user_memories_conversation_window_end_uniq
  on public.user_memories (conversation_id, source_window_end_at);

create index if not exists user_memories_user_created_idx
  on public.user_memories (user_id, created_at desc);

create table if not exists public.conversation_memory_state (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_summarized_at timestamptz,
  last_summarized_message_created_at timestamptz,
  last_summarized_total_tokens bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists conversation_memory_state_user_updated_idx
  on public.conversation_memory_state (user_id, updated_at desc);

alter table public.user_memories enable row level security;
alter table public.conversation_memory_state enable row level security;

drop policy if exists user_memories_select_own on public.user_memories;
create policy user_memories_select_own on public.user_memories
  for select
  using (auth.uid() = user_id);

drop policy if exists user_memories_insert_own on public.user_memories;
create policy user_memories_insert_own on public.user_memories
  for insert
  with check (auth.uid() = user_id);

drop policy if exists user_memories_update_own on public.user_memories;
create policy user_memories_update_own on public.user_memories
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_memories_delete_own on public.user_memories;
create policy user_memories_delete_own on public.user_memories
  for delete
  using (auth.uid() = user_id);

drop policy if exists conversation_memory_state_select_own on public.conversation_memory_state;
create policy conversation_memory_state_select_own on public.conversation_memory_state
  for select
  using (auth.uid() = user_id);

drop policy if exists conversation_memory_state_insert_own on public.conversation_memory_state;
create policy conversation_memory_state_insert_own on public.conversation_memory_state
  for insert
  with check (auth.uid() = user_id);

drop policy if exists conversation_memory_state_update_own on public.conversation_memory_state;
create policy conversation_memory_state_update_own on public.conversation_memory_state
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists conversation_memory_state_delete_own on public.conversation_memory_state;
create policy conversation_memory_state_delete_own on public.conversation_memory_state
  for delete
  using (auth.uid() = user_id);
