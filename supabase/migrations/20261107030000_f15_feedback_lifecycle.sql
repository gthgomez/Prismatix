-- supabase/migrations/20261107030000_f15_feedback_lifecycle.sql
-- F15 repair: feedback lifecycle, idempotency unique constraint, and update/delete RLS policies.

-- Ensure unique constraint on (user_id, message_id, feedback_type) for idempotency and toggle support
create unique index if not exists idx_routing_feedback_user_msg_type
  on public.routing_quality_feedback(user_id, message_id, feedback_type);

-- Allow authenticated users to update their own feedback records
drop policy if exists "Users can update own routing feedback" on public.routing_quality_feedback;
create policy "Users can update own routing feedback"
  on public.routing_quality_feedback
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Allow authenticated users to delete (toggle off) their own feedback records
drop policy if exists "Users can delete own routing feedback" on public.routing_quality_feedback;
create policy "Users can delete own routing feedback"
  on public.routing_quality_feedback
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Allow authenticated users to update metadata on messages in their own conversations (e.g. comparison results / preferences)
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own
  on public.messages
  for update
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

