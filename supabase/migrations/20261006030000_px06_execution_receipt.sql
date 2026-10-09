-- PX06: terminal execution receipt lookup (read RPC only; NO new tables).
-- Findings addressed: stream/cancellation lifecycle (invariant 7), SSE robustness.
--
-- The terminal receipt is a PROJECTION over the existing PX03 execution ledger
-- and the PX05 reservation. It is not persisted. The authority tables live in
-- `prismatix_internal`, which is deliberately kept out of PostgREST, so the only
-- access path is this service-role `security definer` RPC in the exposed
-- `public` schema (same posture as the other `px03_*` / `px05_*` RPCs).
--
-- Ownership: the RPC returns NULL unless an executions row matches BOTH the
-- requested id AND the caller's subject id, so a receipt for another subject is
-- never readable and existence is never leaked to a non-owner (the router maps
-- NULL to 404).
--
-- Additive and idempotent. Behaviour needs a psql/staging run (not available in
-- the CI unit environment).

create or replace function public.px03_get_execution_receipt(
  p_subject_id uuid,
  p_execution_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  v_exec prismatix_internal.executions;
  v_calls jsonb;
  v_res prismatix_internal.budget_reservations;
begin
  select * into v_exec
    from prismatix_internal.executions
   where id = p_execution_id and subject_id = p_subject_id;
  if not found then return null; end if;

  select coalesce(
      jsonb_agg(
        to_jsonb(mc)
        order by mc.created_at, mc.stage, mc.participant, mc.attempt_number
      ),
      '[]'::jsonb
    )
    into v_calls
    from prismatix_internal.model_calls mc
   where mc.execution_id = p_execution_id;

  select * into v_res
    from prismatix_internal.budget_reservations
   where execution_id = p_execution_id;

  return jsonb_build_object(
    'execution', to_jsonb(v_exec),
    'calls', v_calls,
    'reservation', case when v_res.id is null then null else to_jsonb(v_res) end
  );
end;
$$;

revoke all on function public.px03_get_execution_receipt(uuid, uuid) from public;
revoke all on function public.px03_get_execution_receipt(uuid, uuid) from anon;
revoke all on function public.px03_get_execution_receipt(uuid, uuid) from authenticated;
grant execute on function public.px03_get_execution_receipt(uuid, uuid) to service_role;
