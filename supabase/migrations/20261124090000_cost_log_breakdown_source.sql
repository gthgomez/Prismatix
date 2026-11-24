-- R1: a settled execution total must never be presented together with an
-- unconfirmed component breakdown. `total_cost` stays authoritative for the
-- ledger; this column records how the token/component columns were derived.
--
--   confirmed   – components and usage were projected from settled model_calls
--                 and reconcile exactly (micro-USD) with total_cost.
--   estimated    – total AND components are estimates (execution not settled).
--   unavailable  – total is settled, but no confirmed breakdown exists; the
--                 component columns are zeroed and MUST NOT be read as costed
--                 usage.
--
-- Existing rows default to 'estimated': their original provenance cannot be
-- reconstructed, and labelling them as confirmed would be a false claim.
alter table public.cost_logs
  add column if not exists breakdown_source text not null default 'estimated';

alter table public.cost_logs
  drop constraint if exists cost_logs_breakdown_source_check;

alter table public.cost_logs
  add constraint cost_logs_breakdown_source_check
  check (breakdown_source in ('confirmed', 'estimated', 'unavailable'));

comment on column public.cost_logs.breakdown_source is
  'Provenance of input/output/thinking tokens and component costs: confirmed (reconciled to settled ledger), estimated (total is an estimate), unavailable (total settled, breakdown unknown).';
