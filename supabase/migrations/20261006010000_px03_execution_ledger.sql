-- PX03: Replace cost-content identity with an execution / model-call ledger.
-- Findings addressed: F03, F06, F07, F19, F21.
--
-- The legacy cost ledger derived its idempotency key from CONTENT
-- (buildCostLogIdempotencyKey hashed conversation/model/tokens/cost), so two
-- genuinely separate executions with identical usage collapsed into one row,
-- and persistCostLog overwrote any caller-supplied key. This migration adds the
-- durable identity foundation:
--
--   prismatix_internal.executions          - one row per client request
--   prismatix_internal.model_calls         - one row per provider dispatch
--   prismatix_internal.reconciliation_jobs - durable deferred accounting work
--
-- Additive only. It does NOT add budget reservations/windows/leases (PX05) and
-- does NOT fabricate a backfill of historical actual usage. Existing
-- public.cost_logs rows keep their `legacy:` keys and are labelled
-- `estimated_legacy` provenance.
--
-- TRANSPORT: prismatix_internal stays OUT of PostgREST ([api].schemas =
-- public, graphql_public), exactly as PX01 established. The edge functions
-- write and read the ledger through service_role-only `security definer` RPCs
-- in the exposed `public` schema, mirroring public.get_access_grant.
--
-- Verify with tests/integration/ledger-settlement.sql (self-contained,
-- BEGIN/ROLLBACK) against an already-migrated database.

-- ---------------------------------------------------------------------------
-- 1) Authority tables (schema created by PX01).
-- ---------------------------------------------------------------------------

create table if not exists prismatix_internal.executions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid,
  client_request_key text not null,
  payload_hash text not null,
  status text not null default 'started'
    check (status in ('started','completed','cancelled','failed','indeterminate')),
  requested_mode text,
  requested_model text,
  resolved_model text,
  served_model text,
  route_version text,
  pricing_version text,
  catalog_version text,
  terminal_outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, client_request_key)
);

create table if not exists prismatix_internal.model_calls (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references prismatix_internal.executions (id) on delete cascade,
  stage text,
  participant text,
  attempt_number integer not null default 1,
  requested_model text,
  resolved_model text,
  served_model text,
  upstream_request_id text,
  status text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  thinking_tokens integer not null default 0,
  input_cost numeric(12,6) not null default 0,
  output_cost numeric(12,6) not null default 0,
  thinking_cost numeric(12,6) not null default 0,
  total_cost numeric(12,6) not null default 0,
  price_snapshot jsonb,
  cost_status text not null default 'pending'
    check (cost_status in ('settled','pending','estimated_legacy')),
  created_at timestamptz not null default now(),
  -- NULLS NOT DISTINCT keeps the accounting identity well-defined when a stage
  -- or participant is absent: two rows with the same NULL identity must dedupe,
  -- not silently coexist (Postgres' default NULLS DISTINCT would allow both).
  unique nulls not distinct (execution_id, stage, participant, attempt_number)
);

create table if not exists prismatix_internal.reconciliation_jobs (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','running','done','failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reconciliation_jobs_pending_idx
  on prismatix_internal.reconciliation_jobs (status, created_at);

create index if not exists executions_subject_created_idx
  on prismatix_internal.executions (subject_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2) Row level security: service-role writes only; SELECT-own for subjects.
--    No INSERT/UPDATE/DELETE policy exists for anon/authenticated, so with RLS
--    enabled every client write path is denied. The SELECT-own policies are
--    defence-in-depth (the schema is not PostgREST-exposed).
-- ---------------------------------------------------------------------------

alter table prismatix_internal.executions enable row level security;
alter table prismatix_internal.model_calls enable row level security;
alter table prismatix_internal.reconciliation_jobs enable row level security;

drop policy if exists executions_select_own on prismatix_internal.executions;
create policy executions_select_own on prismatix_internal.executions
  for select
  to authenticated
  using (subject_id = auth.uid());

drop policy if exists model_calls_select_own on prismatix_internal.model_calls;
create policy model_calls_select_own on prismatix_internal.model_calls
  for select
  to authenticated
  using (
    exists (
      select 1
      from prismatix_internal.executions e
      where e.id = model_calls.execution_id
        and e.subject_id = auth.uid()
    )
  );

-- reconciliation_jobs: RLS enabled with no policy at all — service_role only.

revoke all on prismatix_internal.executions from public;
revoke all on prismatix_internal.executions from anon;
revoke all on prismatix_internal.model_calls from public;
revoke all on prismatix_internal.model_calls from anon;
revoke all on prismatix_internal.reconciliation_jobs from public;
revoke all on prismatix_internal.reconciliation_jobs from anon;

grant select on prismatix_internal.executions to authenticated;
grant select on prismatix_internal.model_calls to authenticated;

grant select, insert, update, delete on prismatix_internal.executions to service_role;
grant select, insert, update, delete on prismatix_internal.model_calls to service_role;
grant select, insert, update, delete on prismatix_internal.reconciliation_jobs to service_role;

-- ---------------------------------------------------------------------------
-- 3) Service-role-only definer RPCs (public schema) — the only write path.
-- ---------------------------------------------------------------------------

-- 3a) create or idempotently reuse an execution, bound to a payload hash.
create or replace function public.px03_create_execution(
  p_subject_id uuid,
  p_conversation_id uuid,
  p_client_request_key text,
  p_payload_hash text,
  p_requested_mode text default null,
  p_requested_model text default null,
  p_route_version text default null,
  p_pricing_version text default null,
  p_catalog_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  v_existing prismatix_internal.executions;
  v_row prismatix_internal.executions;
begin
  if p_subject_id is null or p_client_request_key is null or p_payload_hash is null then
    raise exception 'invalid_execution_identity' using errcode = '22023';
  end if;

  select * into v_existing
  from prismatix_internal.executions
  where subject_id = p_subject_id
    and client_request_key = p_client_request_key;

  if found then
    if v_existing.payload_hash is distinct from p_payload_hash then
      raise exception 'request_key_conflict' using errcode = 'PT409',
        detail = 'client_request_key reused with a different payload_hash';
    end if;
    return jsonb_build_object('execution', to_jsonb(v_existing), 'reused', true);
  end if;

  insert into prismatix_internal.executions (
    subject_id, conversation_id, client_request_key, payload_hash,
    requested_mode, requested_model, route_version, pricing_version, catalog_version
  ) values (
    p_subject_id, p_conversation_id, p_client_request_key, p_payload_hash,
    p_requested_mode, p_requested_model, p_route_version, p_pricing_version, p_catalog_version
  )
  returning * into v_row;

  return jsonb_build_object('execution', to_jsonb(v_row), 'reused', false);
exception
  when unique_violation then
    -- Concurrent create for the same key: re-read and reconcile the hash.
    select * into v_existing
    from prismatix_internal.executions
    where subject_id = p_subject_id
      and client_request_key = p_client_request_key;
    if found then
      if v_existing.payload_hash is distinct from p_payload_hash then
        raise exception 'request_key_conflict' using errcode = 'PT409',
          detail = 'client_request_key reused with a different payload_hash';
      end if;
      return jsonb_build_object('execution', to_jsonb(v_existing), 'reused', true);
    end if;
    raise;
end;
$$;

-- 3b) insert/upsert a model call. Distinct provider dispatches produce distinct
--     rows; a retry of the same accounting event dedupes to one row.
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
  p_total_cost numeric default 0,
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
begin
  if p_cost_status not in ('settled','pending','estimated_legacy') then
    raise exception 'invalid_cost_status' using errcode = '22023';
  end if;
  if p_attempt_number is null or p_attempt_number < 1 then
    raise exception 'invalid_attempt_number' using errcode = '22023';
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

-- 3c) set the single terminal outcome exactly once.
create or replace function public.px03_finalize_execution(
  p_execution_id uuid,
  p_status text,
  p_terminal_outcome text default null,
  p_served_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  v_row prismatix_internal.executions;
  v_finalized boolean := false;
begin
  if p_status not in ('started','completed','cancelled','failed','indeterminate') then
    raise exception 'invalid_execution_status' using errcode = '22023';
  end if;

  update prismatix_internal.executions
     set status = p_status,
         terminal_outcome = p_terminal_outcome,
         served_model = coalesce(p_served_model, served_model),
         updated_at = now()
   where id = p_execution_id
     and terminal_outcome is null
  returning * into v_row;

  if found then
    v_finalized := true;
  else
    select * into v_row
    from prismatix_internal.executions
    where id = p_execution_id;
    if not found then
      raise exception 'execution_not_found' using errcode = 'P0002';
    end if;
  end if;

  return jsonb_build_object('execution', to_jsonb(v_row), 'finalized', v_finalized);
end;
$$;

-- 3d) durable deferred accounting work.
create or replace function public.px03_enqueue_reconciliation(
  p_execution_id uuid,
  p_kind text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
declare
  v_row prismatix_internal.reconciliation_jobs;
begin
  if p_kind is null or btrim(p_kind) = '' then
    raise exception 'invalid_reconciliation_kind' using errcode = '22023';
  end if;

  insert into prismatix_internal.reconciliation_jobs (execution_id, kind, payload)
  values (p_execution_id, p_kind, coalesce(p_payload, '{}'::jsonb))
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- RPC grants: service_role only. No client (anon/authenticated) may execute.
revoke all on function public.px03_create_execution(uuid, uuid, text, text, text, text, text, text, text) from public;
revoke all on function public.px03_create_execution(uuid, uuid, text, text, text, text, text, text, text) from anon;
revoke all on function public.px03_create_execution(uuid, uuid, text, text, text, text, text, text, text) from authenticated;
grant execute on function public.px03_create_execution(uuid, uuid, text, text, text, text, text, text, text) to service_role;

revoke all on function public.px03_record_model_call(uuid, text, text, integer, text, text, text, text, text, integer, integer, integer, numeric, numeric, numeric, numeric, jsonb, text) from public;
revoke all on function public.px03_record_model_call(uuid, text, text, integer, text, text, text, text, text, integer, integer, integer, numeric, numeric, numeric, numeric, jsonb, text) from anon;
revoke all on function public.px03_record_model_call(uuid, text, text, integer, text, text, text, text, text, integer, integer, integer, numeric, numeric, numeric, numeric, jsonb, text) from authenticated;
grant execute on function public.px03_record_model_call(uuid, text, text, integer, text, text, text, text, text, integer, integer, integer, numeric, numeric, numeric, numeric, jsonb, text) to service_role;

revoke all on function public.px03_finalize_execution(uuid, text, text, text) from public;
revoke all on function public.px03_finalize_execution(uuid, text, text, text) from anon;
revoke all on function public.px03_finalize_execution(uuid, text, text, text) from authenticated;
grant execute on function public.px03_finalize_execution(uuid, text, text, text) to service_role;

revoke all on function public.px03_enqueue_reconciliation(uuid, text, jsonb) from public;
revoke all on function public.px03_enqueue_reconciliation(uuid, text, jsonb) from anon;
revoke all on function public.px03_enqueue_reconciliation(uuid, text, jsonb) from authenticated;
grant execute on function public.px03_enqueue_reconciliation(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4) cost_logs compatibility projection provenance. cost_logs stays a
--    server-written read projection for spend analytics; the authoritative
--    identity/counters now live in the execution ledger. Existing rows keep
--    their `legacy:` keys and are labelled estimated_legacy.
-- ---------------------------------------------------------------------------

alter table public.cost_logs
  add column if not exists cost_status text not null default 'estimated_legacy';

alter table public.cost_logs drop constraint if exists cost_logs_cost_status_check;
alter table public.cost_logs add constraint cost_logs_cost_status_check
  check (cost_status in ('settled','pending','estimated_legacy'));
