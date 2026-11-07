-- supabase/migrations/20261107050000_wave2_knowledge.sql
-- Wave 2 PR 5: F21–F25 Knowledge & Grounded Research Schema

-- 1. Project Documents table (F21 Persistent project file library)
create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  file_path text,
  file_type text not null default 'text/plain',
  size_bytes bigint not null default 0,
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Project Document Chunks table (F22 Grounded project knowledge search)
create table if not exists public.project_document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.project_documents(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  chunk_index int not null,
  content text not null,
  token_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Enable Row Level Security (RLS)
alter table public.project_documents enable row level security;
alter table public.project_document_chunks enable row level security;

-- Policies for project_documents
create policy "Users can view their own project documents"
  on public.project_documents for select
  using (auth.uid() = user_id);

create policy "Users can insert their own project documents"
  on public.project_documents for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own project documents"
  on public.project_documents for update
  using (auth.uid() = user_id);

create policy "Users can delete their own project documents"
  on public.project_documents for delete
  using (auth.uid() = user_id);

-- Policies for project_document_chunks
create policy "Users can view their own document chunks"
  on public.project_document_chunks for select
  using (auth.uid() = user_id);

create policy "Users can insert their own document chunks"
  on public.project_document_chunks for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own document chunks"
  on public.project_document_chunks for update
  using (auth.uid() = user_id);

create policy "Users can delete their own document chunks"
  on public.project_document_chunks for delete
  using (auth.uid() = user_id);

-- Performance Indexes
create index if not exists idx_project_documents_project_id
  on public.project_documents(project_id, user_id);

create index if not exists idx_project_document_chunks_project_id
  on public.project_document_chunks(project_id, user_id);

create index if not exists idx_project_document_chunks_document_id
  on public.project_document_chunks(document_id);
