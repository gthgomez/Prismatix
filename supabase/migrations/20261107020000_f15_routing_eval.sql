-- supabase/migrations/20261107020000_f15_routing_eval.sql
-- F15: Routing quality feedback and preference tracking.

create table if not exists public.routing_quality_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  chosen_model text not null,
  routing_role text,
  feedback_type text not null, -- 'thumb_up', 'thumb_down', 'model_underpowered', 'model_overpriced', 'comparison_preference'
  comparison_preferred_model text,
  user_comment text,
  created_at timestamptz not null default now()
);

alter table public.routing_quality_feedback enable row level security;

create policy "Users can view own routing feedback"
  on public.routing_quality_feedback
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own routing feedback"
  on public.routing_quality_feedback
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create index if not exists idx_routing_feedback_user
  on public.routing_quality_feedback(user_id);

create index if not exists idx_routing_feedback_model
  on public.routing_quality_feedback(chosen_model);
