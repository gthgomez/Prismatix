#!/usr/bin/env bash
set -euo pipefail
migration_dir="${1:-supabase/migrations}"
fixture="${2:-tests/integration/px08_compare_durability.sql}"
qualified_fixture="tests/integration/qualified_spend_stats.sql"
db="prismatix-compare-$$"
docker run --rm --detach --network none --name "$db" \
  -v "$PWD:/repo:ro" -w /repo \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
trap 'docker stop "$db" >/dev/null' EXIT
for retry in {1..30}; do
  if docker exec "$db" pg_isready -U postgres -h localhost >/dev/null 2>&1; then break; fi
  sleep 1
done
sql() {
  docker exec -i "$db" psql -U postgres -X -v ON_ERROR_STOP=1 "$@"
}
# Supabase-managed auth and storage objects required by these repo migrations.
sql <<'SQL'
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema extensions;
create schema auth;
create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
create table auth.users (
  id uuid primary key, aud text, role text, email text unique, encrypted_password text,
  created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
SQL
for file in \
  20260210000000_init_conversations_messages.sql \
  20260212090000_add_cost_logs.sql \
  20260410000000_add_routing_eval_columns.sql \
  20260519000000_harden_router_security.sql \
  20260601000000_add_cost_log_idempotency.sql; do
  sql < "$migration_dir/$file"
done
# The PX01 migration also updates video entitlements. Create its shared schema
# here and limit this harness to the Compare and message provenance contracts.
sql -c 'create schema prismatix_internal'
sql -c 'grant usage on schema prismatix_internal to service_role'
for file in \
  20261006010000_px03_execution_ledger.sql \
  20261006020000_px05_budgets_leases.sql \
  20261006030000_px06_execution_receipt.sql \
  20261006040000_px07_conversation_continuity.sql \
  20261018000000_debate_settlement_and_continuity.sql \
  20261107010000_f09_project_workspaces.sql \
  20261107020000_f15_routing_eval.sql \
  20261107030000_f15_feedback_lifecycle.sql \
  20261107040000_wave2_productivity.sql \
  20261107070000_px08_compare_durability.sql \
  20261121000000_px08_compare_preferences.sql \
  20261121140122_qualified_spend_stats.sql; do
  sql < "$migration_dir/$file"
done
sql < "$fixture"
if [[ "$fixture" != "$qualified_fixture" ]]; then
  sql < "$qualified_fixture"
fi
# The PX13 fixture seeds malformed legacy rows, applies the forward guard in a
# transaction, asserts fail-closed settlement and new-write behavior, then rolls
# back. It is intentionally run against the PX03/PX05/PX06/PX07/PX18 test schema
# before PX13 is applied by any later migration step.
sql < tests/integration/invalid_ledger_settlement.sql
# Apply PX13 outside the fixture's rollback and verify the regular Compare and
# qualified-spend acceptance against the integrated post-migration schema too.
sql < "$migration_dir/20261121220000_px13_budget_settlement_cost_guards.sql"
sql < "$fixture"
sql < "$qualified_fixture"

# Exercise the actual cron migration SQL in a separate fresh disposable DB.
# cron and pg_net are test stand-ins, and the enclosing container has --network none.
sql -c 'create database prismatix_video_worker_cron_ci_test'
# Prove the shared failure branch exits nonzero before trusting the fixture.
if sql -d prismatix_video_worker_cron_ci_test -f tests/integration/video_worker_assertion_failure.sql >/dev/null 2>&1; then
  printf 'Cron assertion self-check unexpectedly succeeded\n' >&2
  exit 1
fi
sql -d prismatix_video_worker_cron_ci_test -f tests/integration/video_worker_cron_no_extensions.sql
sql -d prismatix_video_worker_cron_ci_test -f tests/integration/video_worker_cron_safety.sql
# A new psql process models pg_cron's independent session.
sql -d prismatix_video_worker_cron_ci_test -f tests/integration/video_worker_cron_fresh_session.sql
sql -d prismatix_video_worker_cron_ci_test -f tests/integration/video_worker_cron_synthetic_staging.sql
sql -d prismatix_video_worker_cron_ci_test -f tests/integration/video_worker_cron_synthetic_fresh_session.sql
# Two independent sessions execute the actual migration and rollback files.
sql -d prismatix_video_worker_cron_ci_test \
  -v cron_migration_file=/repo/supabase/operations/quarantine_video_worker_cron.sql \
  -v cron_rollback_file=/repo/supabase/operations/disable_video_worker_cron.sql \
  -f tests/integration/video_worker_cron_concurrency.sql
sql -d prismatix_video_worker_cron_ci_test \
  -v cron_migration_file=/repo/supabase/operations/quarantine_video_worker_cron.sql \
  -v cron_rollback_file=/repo/supabase/operations/disable_video_worker_cron.sql \
  -f tests/integration/video_worker_cron_isolation.sql
sql -d prismatix_video_worker_cron_ci_test \
  -v cron_migration_file=/repo/supabase/operations/quarantine_video_worker_cron.sql \
  -v cron_rollback_file=/repo/supabase/operations/disable_video_worker_cron.sql \
  -f tests/integration/video_worker_cron_table_lock.sql
