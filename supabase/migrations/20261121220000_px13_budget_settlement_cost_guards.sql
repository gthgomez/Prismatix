-- PX13: reject invalid ledger money and fail closed on legacy bad settled rows.
-- Existing rows are deliberately not rewritten or validated; a bad legacy row
-- blocks settlement until it is reconciled explicitly.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'model_calls_total_cost_nonnegative_finite_ck'
      and conrelid = 'prismatix_internal.model_calls'::regclass
  ) then
    alter table prismatix_internal.model_calls
      add constraint model_calls_total_cost_nonnegative_finite_ck
      check (
        total_cost::text not in ('NaN', 'Infinity', '-Infinity')
        and total_cost >= 0
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'budget_reservations_committed_usd_nonnegative_finite_ck'
      and conrelid = 'prismatix_internal.budget_reservations'::regclass
  ) then
    alter table prismatix_internal.budget_reservations
      add constraint budget_reservations_committed_usd_nonnegative_finite_ck
      check (
        committed_usd::text not in ('NaN', 'Infinity', '-Infinity')
        and committed_usd >= 0
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'budget_reservations_amount_usd_nonnegative_finite_ck'
      and conrelid = 'prismatix_internal.budget_reservations'::regclass
  ) then
    alter table prismatix_internal.budget_reservations
      add constraint budget_reservations_amount_usd_nonnegative_finite_ck
      check (
        amount_usd::text not in ('NaN', 'Infinity', '-Infinity')
        and amount_usd >= 0
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'budget_windows_limit_usd_nonnegative_finite_ck'
      and conrelid = 'prismatix_internal.budget_windows'::regclass
  ) then
    alter table prismatix_internal.budget_windows
      add constraint budget_windows_limit_usd_nonnegative_finite_ck
      check (
        limit_usd::text not in ('NaN', 'Infinity', '-Infinity')
        and limit_usd >= 0
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'budget_windows_committed_usd_nonnegative_finite_ck'
      and conrelid = 'prismatix_internal.budget_windows'::regclass
  ) then
    alter table prismatix_internal.budget_windows
      add constraint budget_windows_committed_usd_nonnegative_finite_ck
      check (
        committed_usd::text not in ('NaN', 'Infinity', '-Infinity')
        and committed_usd >= 0
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'budget_windows_held_usd_nonnegative_finite_ck'
      and conrelid = 'prismatix_internal.budget_windows'::regclass
  ) then
    alter table prismatix_internal.budget_windows
      add constraint budget_windows_held_usd_nonnegative_finite_ck
      check (
        held_usd::text not in ('NaN', 'Infinity', '-Infinity')
        and held_usd >= 0
      ) not valid;
  end if;
end;
$$;

-- Preserve the final PX07 dispatch/finalization serialization behavior while
-- distinguishing an explicit settled $0 from an omitted/NULL settled cost.
-- Pending pre-dispatch calls may still omit the amount and store a zero
-- placeholder because their status remains pending.
create or replace function public.px03_record_model_call(
  p_execution_id uuid,
  p_stage text,
  p_participant text,
  p_attempt_number integer default 1,
  p_requested_model text default null,
  p_resolved_model text default null,
  p_served_model text default null,
  p_upstream_request_id text default null,
  p_status text default null,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_thinking_tokens integer default 0,
  p_input_cost numeric default 0,
  p_output_cost numeric default 0,
  p_thinking_cost numeric default 0,
  p_total_cost numeric default null,
  p_price_snapshot jsonb default null,
  p_cost_status text default 'pending'
)
returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  v_row prismatix_internal.model_calls;
  v_exec_status text;
  v_terminal_outcome text;
begin
  if p_cost_status not in ('settled','pending','estimated_legacy') then
    raise exception 'invalid_cost_status' using errcode = '22023';
  end if;
  if p_attempt_number is null or p_attempt_number < 1 then
    raise exception 'invalid_attempt_number' using errcode = '22023';
  end if;
  if p_cost_status = 'settled' and p_total_cost is null then
    raise exception 'settled_model_call_cost_required' using errcode = '22023';
  end if;

  -- Serialize new dispatches against execution finalization. Updates to an
  -- existing call (for example settling late usage) remain allowed.
  if p_status = 'dispatched' then
    select status, terminal_outcome into v_exec_status, v_terminal_outcome
      from prismatix_internal.executions
     where id = p_execution_id
       for share;

    if (v_terminal_outcome is not null or (v_exec_status is not null and v_exec_status != 'started')) and not exists (
      select 1 from prismatix_internal.model_calls
       where execution_id = p_execution_id
         and stage = p_stage
         and participant = p_participant
         and attempt_number = p_attempt_number
    ) then
      raise exception 'execution_already_finalized' using errcode = '22023';
    end if;
  end if;

  insert into prismatix_internal.model_calls (
    execution_id, stage, participant, attempt_number,
    requested_model, resolved_model, served_model, upstream_request_id, status,
    input_tokens, output_tokens, thinking_tokens,
    input_cost, output_cost, thinking_cost, total_cost,
    price_snapshot, cost_status
  ) values (
    p_execution_id, p_stage, p_participant, p_attempt_number,
    p_requested_model, p_resolved_model, p_served_model, p_upstream_request_id, p_status,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), coalesce(p_thinking_tokens, 0),
    coalesce(p_input_cost, 0), coalesce(p_output_cost, 0), coalesce(p_thinking_cost, 0),
    coalesce(p_total_cost, 0),
    p_price_snapshot, p_cost_status
  )
  on conflict (execution_id, stage, participant, attempt_number) do update set
    requested_model = excluded.requested_model,
    resolved_model = excluded.resolved_model,
    served_model = excluded.served_model,
    upstream_request_id = excluded.upstream_request_id,
    status = excluded.status,
    input_tokens = excluded.input_tokens,
    output_tokens = excluded.output_tokens,
    thinking_tokens = excluded.thinking_tokens,
    input_cost = excluded.input_cost,
    output_cost = excluded.output_cost,
    thinking_cost = excluded.thinking_cost,
    total_cost = excluded.total_cost,
    price_snapshot = excluded.price_snapshot,
    cost_status = excluded.cost_status
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.px03_record_model_call(uuid, text, text, integer, text, text, text, text, text, integer, integer, integer, numeric, numeric, numeric, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.px03_record_model_call(uuid, text, text, integer, text, text, text, text, text, integer, integer, integer, numeric, numeric, numeric, numeric, jsonb, text) to service_role;

create or replace function prismatix_internal.guard_invalid_budget_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state in ('committed', 'released') and new.execution_id is not null
     and exists (
       select 1
       from prismatix_internal.model_calls mc
       where mc.execution_id = new.execution_id
         and mc.cost_status = 'settled'
         and (
           mc.total_cost::text in ('NaN', 'Infinity', '-Infinity')
           or mc.total_cost < 0
         )
     ) then
    raise exception 'invalid_settled_model_call_cost'
      using errcode = '23514';
  end if;

  if new.state = 'committed' then
    if new.committed_usd::text in ('NaN', 'Infinity', '-Infinity')
       or new.committed_usd < 0 then
      raise exception 'invalid_reservation_committed_amount'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists budget_reservations_guard_invalid_settlement
  on prismatix_internal.budget_reservations;
create trigger budget_reservations_guard_invalid_settlement
before insert or update on prismatix_internal.budget_reservations
for each row execute function prismatix_internal.guard_invalid_budget_settlement();

revoke all on function prismatix_internal.guard_invalid_budget_settlement()
  from public, anon, authenticated;
grant execute on function prismatix_internal.guard_invalid_budget_settlement()
  to service_role;
