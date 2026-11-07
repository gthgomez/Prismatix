-- 20261107000000_f05_global_chat_search.sql
-- F05: Global, account-scoped full-text chat search across conversations and message bodies.
--
-- SECURITY:
-- - Runs as `security invoker` so Postgres automatically enforces Row Level Security (RLS).
-- - Caller must be authenticated (`auth.uid() = user_id`).
-- - Treats query text strictly as parameter data (plainto_tsquery + parameterized ilike fallback),
--   never constructing dynamic SQL.

create index if not exists idx_messages_content_fts
  on public.messages
  using gin (to_tsvector('english', content));

create index if not exists idx_conversations_title_fts
  on public.conversations
  using gin (to_tsvector('english', coalesce(title, '')));

create or replace function public.search_account_chat_history(
  p_query text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  conversation_id uuid,
  conversation_title text,
  message_id uuid,
  role text,
  snippet text,
  created_at timestamptz,
  match_type text
)
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid;
  v_clean text;
  v_tsquery tsquery;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return;
  end if;

  v_clean := trim(coalesce(p_query, ''));
  if v_clean = '' then
    return;
  end if;

  -- Treat input as plain search text, resisting SQL injection or operator syntax
  v_tsquery := plainto_tsquery('english', v_clean);

  return query
  with matched_messages as (
    select
      m.conversation_id,
      coalesce(c.title, 'Untitled Conversation') as conversation_title,
      m.id as message_id,
      m.role,
      ts_headline(
        'english',
        m.content,
        v_tsquery,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, ShortWord=3, HighlightAll=FALSE, MaxFragments=1'
      ) as snippet,
      m.created_at,
      'message'::text as match_type,
      ts_rank(to_tsvector('english', m.content), v_tsquery) as rank
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where c.user_id = v_user_id
      and (
        (v_tsquery != ''::tsquery and to_tsvector('english', m.content) @@ v_tsquery)
        or m.content ilike '%' || v_clean || '%'
      )
  ),
  matched_conversations as (
    select
      c.id as conversation_id,
      coalesce(c.title, 'Untitled Conversation') as conversation_title,
      null::uuid as message_id,
      null::text as role,
      coalesce(c.title, 'Untitled Conversation') as snippet,
      c.created_at,
      'title'::text as match_type,
      0.5::real as rank
    from public.conversations c
    where c.user_id = v_user_id
      and (
        (v_tsquery != ''::tsquery and to_tsvector('english', coalesce(c.title, '')) @@ v_tsquery)
        or c.title ilike '%' || v_clean || '%'
      )
  ),
  combined as (
    select * from matched_messages
    union all
    select * from matched_conversations
  )
  select
    combined.conversation_id,
    combined.conversation_title,
    combined.message_id,
    combined.role,
    combined.snippet,
    combined.created_at,
    combined.match_type
  from combined
  order by combined.rank desc, combined.created_at desc
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
end;
$$;

revoke all on function public.search_account_chat_history(text, integer, integer) from public;
grant execute on function public.search_account_chat_history(text, integer, integer) to authenticated;
