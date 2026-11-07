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

-- Enable Row Level Security (RLS) and sensible defaults
alter table public.project_documents alter column user_id set default auth.uid();
alter table public.project_document_chunks alter column user_id set default auth.uid();
alter table public.project_documents enable row level security;
alter table public.project_document_chunks enable row level security;

-- Policies for project_documents with project ownership verification
drop policy if exists "Users can view their own project documents" on public.project_documents;
create policy "Users can view their own project documents"
  on public.project_documents for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own project documents" on public.project_documents;
create policy "Users can insert their own project documents"
  on public.project_documents for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.projects p
      where p.id = project_documents.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update their own project documents" on public.project_documents;
create policy "Users can update their own project documents"
  on public.project_documents for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.projects p
      where p.id = project_documents.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete their own project documents" on public.project_documents;
create policy "Users can delete their own project documents"
  on public.project_documents for delete
  to authenticated
  using (auth.uid() = user_id);

-- Policies for project_document_chunks with document & project ownership verification
drop policy if exists "Users can view their own document chunks" on public.project_document_chunks;
create policy "Users can view their own document chunks"
  on public.project_document_chunks for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own document chunks" on public.project_document_chunks;
create policy "Users can insert their own document chunks"
  on public.project_document_chunks for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.project_documents d
      where d.id = project_document_chunks.document_id
        and d.project_id = project_document_chunks.project_id
        and d.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update their own document chunks" on public.project_document_chunks;
create policy "Users can update their own document chunks"
  on public.project_document_chunks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.project_documents d
      where d.id = project_document_chunks.document_id
        and d.project_id = project_document_chunks.project_id
        and d.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete their own document chunks" on public.project_document_chunks;
create policy "Users can delete their own document chunks"
  on public.project_document_chunks for delete
  to authenticated
  using (auth.uid() = user_id);

-- Performance and Full-Text Search Indexes
create index if not exists idx_project_documents_project_id
  on public.project_documents(project_id, user_id);

create index if not exists idx_project_document_chunks_project_id
  on public.project_document_chunks(project_id, user_id);

create index if not exists idx_project_document_chunks_document_id
  on public.project_document_chunks(document_id);

-- GIN index for full-text search over chunks
create index if not exists idx_project_document_chunks_fts
  on public.project_document_chunks using gin (to_tsvector('english', content));

-- ---------------------------------------------------------------------------
-- 3. Storage bucket for durable project files (F21)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-documents', 'project-documents', false, 20971520, null)
on conflict (id) do nothing;

-- RLS policies on storage.objects for project-documents bucket
drop policy if exists "project_documents_select_own" on storage.objects;
create policy "project_documents_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'project-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "project_documents_insert_own" on storage.objects;
create policy "project_documents_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'project-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "project_documents_delete_own" on storage.objects;
create policy "project_documents_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'project-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 4. F22: Indexed PostgreSQL full-text search RPC across complete project corpus
-- ---------------------------------------------------------------------------
create or replace function public.px22_search_project_knowledge(
  p_project_id uuid,
  p_query text,
  p_limit integer default 10
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_name text,
  chunk_index integer,
  content text,
  token_count integer,
  metadata jsonb,
  score double precision
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_tsquery tsquery;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- 1. Verify caller owns project
  if not exists (select 1 from public.projects where id = p_project_id and user_id = v_user_id) then
    raise exception 'project_not_found' using errcode = '22023';
  end if;

  if p_query is null or trim(p_query) = '' then
    return;
  end if;

  begin
    v_tsquery := websearch_to_tsquery('english', p_query);
  exception when others then
    v_tsquery := plainto_tsquery('english', p_query);
  end;

  return query
  select
    c.id as chunk_id,
    c.document_id,
    d.name as document_name,
    c.chunk_index,
    c.content,
    c.token_count,
    c.metadata,
    case
      when v_tsquery is not null and to_tsvector('english', c.content) @@ v_tsquery
        then (ts_rank_cd(to_tsvector('english', c.content), v_tsquery) * 100.0)
      when c.content ilike '%' || p_query || '%'
        then 50.0
      else 10.0
    end as score
  from public.project_document_chunks c
  join public.project_documents d on d.id = c.document_id
  where c.project_id = p_project_id
    and c.user_id = v_user_id
    and (
      (v_tsquery is not null and to_tsvector('english', c.content) @@ v_tsquery)
      or c.content ilike '%' || p_query || '%'
      or exists (
        select 1 from unnest(string_to_array(trim(p_query), ' ')) word
        where length(word) > 2 and c.content ilike '%' || word || '%'
      )
    )
  order by score desc, c.chunk_index asc
  limit coalesce(p_limit, 10);
end;
$$;

revoke all on function public.px22_search_project_knowledge(uuid, text, integer) from public, anon;
grant execute on function public.px22_search_project_knowledge(uuid, text, integer) to authenticated, service_role;
