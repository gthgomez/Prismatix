#!/usr/bin/env bash
# Genuine existing-installation upgrade: build a database from the ACTUAL
# current main-branch migration set, seed representative historical data
# (including financial rows that the candidate's guards must tolerate), then
# upgrade with the candidate's REAL migration runner (`supabase migration up
# --db-url`), which records history exactly as `db push` does.
#
# This complements run-fresh-replay.sh and run-existing-install-replay.sh:
# those apply the candidate's whole set; this one starts from main.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

BASE_REF="${BASE_REF:-origin/main}"
BASE_SHA="$(git rev-parse "$BASE_REF")"
CLI_VERSION="${SUPABASE_CLI_VERSION:-2.98.2}"
PORT="${UPGRADE_DB_PORT:-55432}"
DB="prismatix-main-upgrade-$$"
TMP="$(mktemp -d)"

cleanup() {
  docker rm -f "$DB" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

printf 'main-upgrade: baseline %s (%s)\n' "$BASE_REF" "$BASE_SHA"

docker run --detach --name "$DB" -p "127.0.0.1:${PORT}:5432" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$DB" pg_isready -U postgres -h localhost >/dev/null 2>&1; then break; fi
  sleep 1
done

sql() { docker exec -i "$DB" psql -U postgres -X -v ON_ERROR_STOP=1 "$@"; }

# Supabase-managed surfaces the migrations expect on a real installation.
sql -q <<'SQL'
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
grant usage on schema storage to authenticated, anon, service_role;
SQL

# The scheduler surface an existing installation already has. The historical
# cron migration must apply over it without operator intent or network egress.
sql -q <<'SQL'
create schema cron;
create sequence cron.jobid_seq;
create table cron.job (
  jobid bigint primary key default nextval('cron.jobid_seq'),
  jobname text not null, schedule text not null, command text not null,
  nodename text not null default 'localhost', nodeport int not null default 5432,
  database text not null default current_database(), username text not null default current_user,
  active boolean not null default true
);
grant select on cron.job to public;
alter table cron.job enable row level security;
create policy cron_job_policy on cron.job using (username = current_user);
create table cron.job_run_details (
  jobid bigint, runid bigint, status text, return_message text,
  start_time timestamptz, end_time timestamptz
);
create function cron.unschedule(p_job_id bigint) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobid = p_job_id;
  return found;
end $$;
create function cron.schedule(p_jobname text, p_schedule text, p_command text) returns bigint
language plpgsql as $$
declare id bigint;
begin
  insert into cron.job(jobname, schedule, command) values (p_jobname, p_schedule, p_command)
  returning jobid into id;
  return id;
end $$;
insert into cron.job(jobname, schedule, command, username)
values ('video_worker_every_minute', '* * * * *', 'select 1', 'postgres');
SQL

# --- Baseline: the actual main-branch migration set -------------------------
sql -q -c "create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text);"

git ls-tree --name-only "$BASE_SHA" supabase/migrations/ \
  | sed 's#^.*/##' | sort > "$TMP/main-files.txt"

baseline=0
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  git show "${BASE_SHA}:supabase/migrations/${name}" > "$TMP/current.sql"
  if ! sql -q < "$TMP/current.sql"; then
    printf 'main-upgrade: FAILED applying baseline %s\n' "$name" >&2
    exit 1
  fi
  version="${name%%_*}"
  sql -q -c "insert into supabase_migrations.schema_migrations(version, name)
    values ('$version', '$name') on conflict (version) do nothing"
  baseline=$((baseline + 1))
done < "$TMP/main-files.txt"

# --- Representative historical data -----------------------------------------
sql -q <<'SQL'
insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
        'upgrade@example.test', 'x', now() - interval '30 days', now() - interval '30 days');

insert into public.conversations (id, user_id, total_tokens)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1234);

insert into public.messages (conversation_id, role, content, token_count, model_used)
values ('22222222-2222-4222-8222-222222222222', 'user', 'historical question', 12, null),
       ('22222222-2222-4222-8222-222222222222', 'assistant', 'historical answer', 34, 'legacy-model');

-- Consistent historical spend.
insert into public.cost_logs (
  user_id, conversation_id, model, provider, input_tokens, output_tokens, thinking_tokens,
  input_cost, output_cost, thinking_cost, total_cost, idempotency_key, cost_status)
values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        'legacy-model', 'openrouter', 100, 10, 0, 0.000100, 0.000050, 0, 0.000150,
        'legacy:consistent', 'settled');

-- Deliberately inconsistent historical row: total no longer matches components.
-- The upgrade must preserve it and label its provenance honestly.
insert into public.cost_logs (
  user_id, conversation_id, model, provider, input_tokens, output_tokens, thinking_tokens,
  input_cost, output_cost, thinking_cost, total_cost, idempotency_key, cost_status)
values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        'legacy-model', 'openrouter', 127, 10, 0, 0.000095, 0.000038, 0, 0.000075,
        'legacy:inconsistent', 'settled');

-- Historically invalid reservation; PX13 guards are NOT VALID for exactly this
-- reason, so the row must survive the upgrade.
insert into prismatix_internal.budget_reservations (execution_id, subject_id, amount_usd, committed_usd, state)
values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 0.5, 0.2, 'held');
SQL

# --- Upgrade with the candidate's real runner -------------------------------
DB_URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
if ! npx --yes "supabase@${CLI_VERSION}" migration up --db-url "$DB_URL"; then
  echo "main-upgrade: FAILED — candidate migrations cannot upgrade a main installation" >&2
  exit 1
fi

# --- Postconditions ---------------------------------------------------------
candidate_versions="$(git ls-tree --name-only HEAD supabase/migrations/ | sed 's#^.*/##' | sed 's/_.*//' | sort)"
missing="$(comm -23 <(printf '%s\n' "$candidate_versions") \
  <(sql -tA -c "select version from supabase_migrations.schema_migrations order by version"))"
if [[ -n "$missing" ]]; then
  echo "main-upgrade: migration history is missing candidate versions: $missing" >&2
  exit 1
fi

sql -tA -c "select breakdown_source from public.cost_logs where idempotency_key = 'legacy:inconsistent'" \
  | grep -qx 'estimated' \
  || { echo "main-upgrade: historical cost log was not labelled estimated" >&2; exit 1; }

sql -tA -c "select total_cost from public.cost_logs where idempotency_key = 'legacy:inconsistent'" \
  | grep -qx '0.000075' \
  || { echo "main-upgrade: historical total was rewritten" >&2; exit 1; }

guards="$(sql -tA -c "select count(*) from pg_constraint where convalidated = false
  and connamespace = 'prismatix_internal'::regnamespace")"
if [[ "${guards:-0}" -lt 6 ]]; then
  echo "main-upgrade: expected the NOT VALID PX13 guards, found ${guards:-0}" >&2
  exit 1
fi

historic_reservation="$(sql -tA -c "select state || ':' || committed_usd from prismatix_internal.budget_reservations
  where execution_id = '33333333-3333-4333-8333-333333333333'")"
if [[ "$historic_reservation" != 'held:0.200000' ]]; then
  echo "main-upgrade: historical reservation changed: $historic_reservation" >&2
  exit 1
fi

spend="$(sql -tA -c "select coalesce(sum(total_cost), 0) from public.cost_logs
  where user_id = '11111111-1111-4111-8111-111111111111'")"
if [[ "$spend" != '0.000225' ]]; then
  echo "main-upgrade: historical spend aggregate changed: $spend" >&2
  exit 1
fi

printf 'main-upgrade: PASS (%d baseline migrations from main, candidate upgrade applied, history and guards verified)\n' "$baseline"
