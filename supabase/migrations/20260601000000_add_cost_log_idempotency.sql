-- Idempotency key for cost_logs: prevents duplicate cost rows when the
-- router retries a stream completion (e.g. client reconnect, double-fire).

alter table public.cost_logs
  add column if not exists idempotency_key text;

-- Backfill existing rows with a guaranteed-unique legacy key so the unique
-- index can be created safely. New rows use a deterministic content-based
-- key computed by buildCostLogIdempotencyKey() in db_helpers.ts.
update public.cost_logs
set idempotency_key = 'legacy:' || id::text
where idempotency_key is null;

-- Partial index: only enforce uniqueness for non-null keys. Legacy rows
-- already have unique keys, but this keeps the constraint flexible.
create unique index if not exists cost_logs_idempotency_key_idx
  on public.cost_logs (idempotency_key);
