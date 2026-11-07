-- supabase/migrations/20261107010000_f09_project_workspaces.sql
-- F09: Real Project Workspaces with scoped instructions and conversation tagging.

-- 1. Create projects table
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text default '',
  instructions text default '',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Enable RLS
alter table public.projects enable row level security;

-- 3. Strictly account-scoped RLS policies
create policy "Users can view own projects"
  on public.projects
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own projects"
  on public.projects
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own projects"
  on public.projects
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own projects"
  on public.projects
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. Tag conversations with project_id
alter table public.conversations
  add column if not exists project_id uuid references public.projects(id) on delete set null;

-- 5. Performance indexes
create index if not exists idx_projects_user_id
  on public.projects(user_id);

create index if not exists idx_projects_user_archived
  on public.projects(user_id, archived);

create index if not exists idx_conversations_project_id
  on public.conversations(project_id);
