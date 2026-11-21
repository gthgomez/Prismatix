-- Qualified spend totals preserve settlement provenance per user/window.
-- Run after the migration in a disposable database; transaction rolls back.
\set ON_ERROR_STOP on
begin;

do $$
declare
  u1 constant uuid := '11111111-1111-4111-8111-111111111111';
  u2 constant uuid := '22222222-2222-4222-8222-222222222222';
  qualified jsonb;
  function_id regprocedure := 'public.get_spend_stats_qualified(uuid)'::regprocedure;
begin
  if not has_function_privilege('service_role', function_id, 'EXECUTE') then
    raise exception 'service_role must execute qualified spend stats';
  end if;
  if has_function_privilege('anon', function_id, 'EXECUTE')
     or has_function_privilege('authenticated', function_id, 'EXECUTE') then
    raise exception 'qualified spend stats must be service_role-only';
  end if;

  insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
  values (u1, 'authenticated', 'authenticated', 'qualified-u1@example.invalid', 'unused', now(), now()),
         (u2, 'authenticated', 'authenticated', 'qualified-u2@example.invalid', 'unused', now(), now());

  insert into public.cost_logs(
    user_id, model, input_tokens, output_tokens, thinking_tokens,
    input_cost, output_cost, thinking_cost, total_cost, created_at, cost_status
  ) values
    (u1, 'fixture', 1, 1, 0, 0, 0, 0, 0.100000, now(), 'settled'),
    (u1, 'fixture', 1, 1, 0, 0, 0, 0, 0.200000, now(), 'pending'),
    (u1, 'fixture', 1, 1, 0, 0, 0, 0, 0.300000, now(), 'estimated_legacy'),
    (u1, 'fixture', 1, 1, 0, 0, 0, 0, 0.400000, now() - interval '45 days', 'settled'),
    (u2, 'fixture', 1, 1, 0, 0, 0, 0, 0.900000, now(), 'pending');

  qualified := public.get_spend_stats_qualified(u1);
  if (qualified #>> '{today,settled}')::numeric <> 0.1
     or (qualified #>> '{today,pending}')::numeric <> 0.2
     or (qualified #>> '{today,estimatedLegacy}')::numeric <> 0.3 then
    raise exception 'today categories mixed or mis-scoped: %', qualified->'today';
  end if;
  if (qualified #>> '{thisWeek,settled}')::numeric <> 0.1
     or (qualified #>> '{thisWeek,pending}')::numeric <> 0.2
     or (qualified #>> '{thisWeek,estimatedLegacy}')::numeric <> 0.3 then
    raise exception 'week categories mixed or mis-scoped: %', qualified->'thisWeek';
  end if;
  if (qualified #>> '{thisMonth,settled}')::numeric <> 0.1
     or (qualified #>> '{thisMonth,pending}')::numeric <> 0.2
     or (qualified #>> '{thisMonth,estimatedLegacy}')::numeric <> 0.3 then
    raise exception 'month categories mixed or mis-scoped: %', qualified->'thisMonth';
  end if;
  if (qualified #>> '{allTime,settled}')::numeric <> 0.5
     or (qualified #>> '{allTime,pending}')::numeric <> 0.2
     or (qualified #>> '{allTime,estimatedLegacy}')::numeric <> 0.3 then
    raise exception 'all-time categories mixed or mis-scoped: %', qualified->'allTime';
  end if;

  qualified := public.get_spend_stats_qualified(u2);
  if (qualified #>> '{today,settled}')::numeric <> 0
     or (qualified #>> '{today,pending}')::numeric <> 0.9
     or (qualified #>> '{today,estimatedLegacy}')::numeric <> 0
     or (qualified #>> '{allTime,settled}')::numeric <> 0 then
    raise exception 'qualified stats were not scoped to second user: %', qualified;
  end if;
end;
$$;

rollback;
