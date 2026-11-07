-- tests/integration/wave2_knowledge_persistence.sql
-- Integration test verifying PR #60 Knowledge Workstream:
-- 1. Storage bucket configuration and RLS isolation
-- 2. Project document and chunk relational ownership
-- 3. GIN Full-Text Search RPC px22_search_project_knowledge
-- 4. Cross-tenant isolation

begin;

-- Step 1: Create test users
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'alice@test.com'),
  ('22222222-2222-4222-8222-222222222222', 'bob@test.com')
on conflict (id) do nothing;

-- Step 2: Create projects
insert into public.projects (id, user_id, name, description) values
  ('aaaa1111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Alice Project', 'Project A'),
  ('bbbb2222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'Bob Project', 'Project B')
on conflict (id) do nothing;

-- Step 3: Check storage bucket configuration
do $$
declare
  v_bucket_id text;
  v_file_limit bigint;
begin
  select id, file_size_limit into v_bucket_id, v_file_limit
  from storage.buckets
  where id = 'project-documents';

  if v_bucket_id is null then
    raise exception 'FAIL: project-documents storage bucket does not exist';
  end if;

  if v_file_limit != 20971520 then
    raise exception 'FAIL: expected file_size_limit 20971520, got %', v_file_limit;
  end if;
  raise notice 'PASS: Storage bucket configured correctly';
end $$;

-- Step 4: Test document insert as Alice
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.project_documents (id, project_id, user_id, name, file_path, file_type, size_bytes, extracted_text)
values (
  'dddd1111-1111-4111-8111-111111111111',
  'aaaa1111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'Architecture.md',
  '11111111-1111-4111-8111-111111111111/aaaa1111-1111-4111-8111-111111111111/doc1/Architecture.md',
  'text/markdown',
  500,
  'Prismatix utilizes PostgreSQL Full-Text Search and Row Level Security for robust data boundary isolation.'
);

-- Insert chunk for Alice
insert into public.project_document_chunks (id, document_id, project_id, chunk_index, content, token_count)
values (
  'cccc1111-1111-4111-8111-111111111111',
  'dddd1111-1111-4111-8111-111111111111',
  'aaaa1111-1111-4111-8111-111111111111',
  0,
  'Prismatix utilizes PostgreSQL Full-Text Search and Row Level Security for robust data boundary isolation.',
  20
);

-- Step 5: Test Alice cannot insert document into Bob's project
do $$
begin
  insert into public.project_documents (id, project_id, user_id, name, file_type, size_bytes, extracted_text)
  values (
    'dddd2222-1111-4111-8111-111111111111',
    'bbbb2222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'Injected.md',
    'text/markdown',
    100,
    'Illegal cross project insert'
  );
  raise exception 'FAIL: Alice was able to insert document into Bob project!';
exception
  when insufficient_privilege or integrity_constraint_violation then
    raise notice 'PASS: Alice blocked from inserting document into Bob project';
end $$;

-- Step 6: Test Bob creates a document with similar keywords in his own project
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

insert into public.project_documents (id, project_id, user_id, name, file_type, size_bytes, extracted_text)
values (
  'dddd2222-2222-4222-8222-222222222222',
  'bbbb2222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  'BobArchitecture.md',
  'text/markdown',
  200,
  'Bob secret research notes on PostgreSQL performance tuning.'
);

insert into public.project_document_chunks (id, document_id, project_id, chunk_index, content, token_count)
values (
  'cccc2222-2222-4222-8222-222222222222',
  'dddd2222-2222-4222-8222-222222222222',
  'bbbb2222-2222-4222-8222-222222222222',
  0,
  'Bob secret research notes on PostgreSQL performance tuning.',
  12
);

-- Step 7: Test FTS RPC px22_search_project_knowledge as Alice
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
declare
  v_count integer;
  v_doc_name text;
begin
  select count(*), max(document_name) into v_count, v_doc_name
  from public.px22_search_project_knowledge('aaaa1111-1111-4111-8111-111111111111', 'PostgreSQL Security', 5);

  if v_count != 1 then
    raise exception 'FAIL: Expected 1 search result for Alice, got %', v_count;
  end if;

  if v_doc_name != 'Architecture.md' then
    raise exception 'FAIL: Expected document Architecture.md, got %', v_doc_name;
  end if;

  raise notice 'PASS: px22_search_project_knowledge returned expected result for Alice';
end $$;

-- Step 8: Test Alice cannot search Bob's project via RPC (raises project_not_found or returns 0)
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.px22_search_project_knowledge('bbbb2222-2222-4222-8222-222222222222', 'PostgreSQL', 5);

  if v_count != 0 then
    raise exception 'FAIL: Alice was able to search Bob project! Got % results', v_count;
  end if;

  raise notice 'PASS: Alice cannot search Bob project via px22_search_project_knowledge';
exception
  when others then
    if sqlerrm like '%project_not_found%' then
      raise notice 'PASS: Alice blocked from searching Bob project (project_not_found raised)';
    else
      raise;
    end if;
end $$;

-- Step 9: Cascade deletion test: deleting Alice's document purges its chunks
delete from public.project_documents where id = 'dddd1111-1111-4111-8111-111111111111';

do $$
declare
  v_chunk_count integer;
begin
  select count(*) into v_chunk_count
  from public.project_document_chunks
  where document_id = 'dddd1111-1111-4111-8111-111111111111';

  if v_chunk_count != 0 then
    raise exception 'FAIL: Expected 0 chunks after document deletion, found %', v_chunk_count;
  end if;

  raise notice 'PASS: Chunks cascaded upon document deletion';
end $$;

reset role;
rollback;
