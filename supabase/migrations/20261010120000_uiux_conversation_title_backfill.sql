-- PX12 follow-up (UI/UX): backfill legacy conversation titles.
-- Conversations created before PX07 never received a title from the first user
-- message, so the sidebar shows "New Chat"/NULL rows. Derive each title from
-- the earliest user message; leave explicit user-meaningful titles untouched.

update public.conversations c
   set title = left(v.content, 120)
  from (
    select distinct on (m.conversation_id) m.conversation_id, m.content
      from public.messages m
     where m.role = 'user'
     order by m.conversation_id, m.created_at asc, m.id asc
  ) v
 where v.conversation_id = c.id
   and (c.title is null or c.title = 'New Chat');
