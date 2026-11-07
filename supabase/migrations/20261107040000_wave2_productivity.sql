-- supabase/migrations/20261107040000_wave2_productivity.sql
-- Wave 2 PR 4: Productivity, branching, tagging, prompt library, and server preferences (F16-F20)

-- F17 & F18: Add branching lineage, archiving, and tags to conversations
alter table public.conversations
  add column if not exists parent_conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists forked_from_message_id uuid references public.messages(id) on delete set null,
  add column if not exists archived boolean not null default false,
  add column if not exists tags text[] not null default '{}'::text[];

create index if not exists idx_conversations_parent_id on public.conversations(parent_conversation_id);
create index if not exists idx_conversations_archived on public.conversations(user_id, archived);
create index if not exists idx_conversations_tags on public.conversations using gin(tags);

-- Allow users to update their own conversations (including title, project_id, archived, tags)
drop policy if exists conversations_update_own on public.conversations;
create policy conversations_update_own on public.conversations
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- F19: Reusable prompt library
create table if not exists public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  description text default '',
  template text not null,
  variables text[] not null default '{}'::text[],
  category text default 'general',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prompt_templates_user on public.prompt_templates(user_id, category);
create index if not exists idx_prompt_templates_project on public.prompt_templates(project_id);

alter table public.prompt_templates enable row level security;

drop policy if exists prompt_templates_select_own on public.prompt_templates;
create policy prompt_templates_select_own on public.prompt_templates
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists prompt_templates_insert_own on public.prompt_templates;
create policy prompt_templates_insert_own on public.prompt_templates
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists prompt_templates_update_own on public.prompt_templates;
create policy prompt_templates_update_own on public.prompt_templates
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists prompt_templates_delete_own on public.prompt_templates;
create policy prompt_templates_delete_own on public.prompt_templates
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- F20: Cross-device user preference synchronization
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_select_own on public.user_preferences;
create policy user_preferences_select_own on public.user_preferences
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_preferences_insert_own on public.user_preferences;
create policy user_preferences_insert_own on public.user_preferences
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_preferences_update_own on public.user_preferences;
create policy user_preferences_update_own on public.user_preferences
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
