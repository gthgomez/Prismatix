-- PX12: provenance-qualified spend totals for the spend_stats API.
-- Additive: preserve get_spend_stats for conservative preflight and older clients.

create or replace function public.get_spend_stats_qualified(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') as today_start,
      (date_trunc('week', now() at time zone 'UTC') at time zone 'UTC') as week_start,
      (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') as month_start
  ), totals as (
    select
      coalesce(sum(c.total_cost) filter (where c.created_at >= b.today_start and c.cost_status = 'settled'), 0)::numeric as today_settled,
      coalesce(sum(c.total_cost) filter (where c.created_at >= b.today_start and c.cost_status = 'pending'), 0)::numeric as today_pending,
      coalesce(sum(c.total_cost) filter (where c.created_at >= b.today_start and c.cost_status = 'estimated_legacy'), 0)::numeric as today_estimated_legacy,
      coalesce(sum(c.total_cost) filter (where c.created_at >= b.week_start and c.cost_status = 'settled'), 0)::numeric as week_settled,
      coalesce(sum(c.total_cost) filter (where c.created_at >= b.week_start and c.cost_status = 'pending'), 0)::numeric as week_pending,
      coalesce(sum(c.total_cost) filter (where c.created_at >= b.week_start and c.cost_status = 'estimated_legacy'), 0)::numeric as week_estimated_legacy,
      coalesce(sum(c.total_cost) filter (where c.created_at >= b.month_start and c.cost_status = 'settled'), 0)::numeric as month_settled,
      coalesce(sum(c.total_cost) filter (where c.created_at >= b.month_start and c.cost_status = 'pending'), 0)::numeric as month_pending,
      coalesce(sum(c.total_cost) filter (where c.created_at >= b.month_start and c.cost_status = 'estimated_legacy'), 0)::numeric as month_estimated_legacy,
      coalesce(sum(c.total_cost) filter (where c.cost_status = 'settled'), 0)::numeric as all_settled,
      coalesce(sum(c.total_cost) filter (where c.cost_status = 'pending'), 0)::numeric as all_pending,
      coalesce(sum(c.total_cost) filter (where c.cost_status = 'estimated_legacy'), 0)::numeric as all_estimated_legacy
    from bounds b
    left join public.cost_logs c on c.user_id = p_user_id
  )
  select jsonb_build_object(
    'today', jsonb_build_object(
      'settled', today_settled,
      'pending', today_pending,
      'estimatedLegacy', today_estimated_legacy
    ),
    'thisWeek', jsonb_build_object(
      'settled', week_settled,
      'pending', week_pending,
      'estimatedLegacy', week_estimated_legacy
    ),
    'thisMonth', jsonb_build_object(
      'settled', month_settled,
      'pending', month_pending,
      'estimatedLegacy', month_estimated_legacy
    ),
    'allTime', jsonb_build_object(
      'settled', all_settled,
      'pending', all_pending,
      'estimatedLegacy', all_estimated_legacy
    )
  )
  from totals;
$$;

revoke all on function public.get_spend_stats_qualified(uuid) from public, anon, authenticated;
grant execute on function public.get_spend_stats_qualified(uuid) to service_role;
