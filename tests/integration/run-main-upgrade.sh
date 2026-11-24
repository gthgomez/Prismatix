#!/usr/bin/env bash
# Genuine existing-installation upgrade: build a database from the ACTUAL
# current main-branch migration set on a Supabase Postgres image (so pg_cron,
# pg_net and vault exist as they do on a real installation), seed
# representative historical data — including financial rows the candidate's
# NOT VALID guards must tolerate — then apply the candidate's new migrations
# one file per transaction, exactly as `db push` does, recording the same
# history versions.
#
# Why not `supabase migration up --db-url`: CLI 2.98.2 forces TLS for a
# `--db-url` connection and refuses a TLS-less container ("server refused TLS
# connection"). The fresh-install gate uses the real runner (`db reset`); this
# gate reproduces the runner's per-file transaction semantics against a real
# main baseline. The limitation is recorded in the qualification record.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

BASE_REF="${BASE_REF:-origin/main}"
BASE_SHA="$(git rev-parse "$BASE_REF")"
PORT="${UPGRADE_DB_PORT:-55432}"
IMAGE="${UPGRADE_DB_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.158}"
DB="prismatix-main-upgrade-$$"
TMP="$(mktemp -d)"

cleanup() {
  docker rm -f "$DB" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

printf 'main-upgrade: baseline %s (%s)\n' "$BASE_REF" "$BASE_SHA"

docker run --detach --name "$DB" -p "127.0.0.1:${PORT}:5432" \
  -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$DB" pg_isready -U supabase_admin -h localhost >/dev/null 2>&1; then break; fi
  sleep 1
done

sql() { docker exec -i "$DB" psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 "$@"; }

# Supabase-managed surfaces. The image already provides auth.users and the
# roles; the storage tables are normally created by the Storage service, so the
# migration fixture creates the minimal shape they reference.
sql -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists storage;
create table if not exists auth.users (
  id uuid primary key, aud text, role text, email text unique, encrypted_password text,
  created_at timestamptz, updated_at timestamptz);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create or replace function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema storage to authenticated, anon, service_role;
SQL

# --- Baseline: the actual main-branch migration set -------------------------
sql -q -c "create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text);"

git ls-tree --name-only "$BASE_SHA" supabase/migrations/ \
  | sed 's#^.*/##' | sort > "$TMP/main-files.txt"

# Read the list up front: `docker exec -i psql` consumes stdin, so iterating
# with `while read ... done < file` would let the first psql invocation eat the
# remaining filenames.
mapfile -t main_files < "$TMP/main-files.txt"

baseline=0
for name in "${main_files[@]}"; do
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
done

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

-- Deliberately inconsistent historical row: the upgrade must preserve it,
-- preserve its total, and label its provenance honestly.
insert into public.cost_logs (
  user_id, conversation_id, model, provider, input_tokens, output_tokens, thinking_tokens,
  input_cost, output_cost, thinking_cost, total_cost, idempotency_key, cost_status)
values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        'legacy-model', 'openrouter', 127, 10, 0, 0.000095, 0.000038, 0, 0.000075,
        'legacy:inconsistent', 'settled');

-- Historically invalid reservation; PX13 guards are NOT VALID for exactly this
-- reason, so the row must survive the upgrade unchanged.
insert into prismatix_internal.budget_reservations (execution_id, subject_id, amount_usd, committed_usd, state)
values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 0.5, 0.2, 'held');
SQL

# --- Candidate upgrade: one file per transaction, like db push --------------
candidate=0
for file in $(find supabase/migrations -maxdepth 1 -name '*.sql' | sort); do
  name="$(basename "$file")"
  if grep -qx "$name" "$TMP/main-files.txt"; then continue; fi
  if ! sql -q < "$file"; then
    printf 'main-upgrade: FAILED applying candidate %s\n' "$name" >&2
    exit 1
  fi
  version="${name%%_*}"
  sql -q -c "insert into supabase_migrations.schema_migrations(version, name)
    values ('$version', '$name') on conflict (version) do nothing"
  candidate=$((candidate + 1))
done

if [[ "$candidate" -eq 0 ]]; then
  echo "main-upgrade: candidate adds no migrations over main" >&2
  exit 1
fi

# --- Postconditions ---------------------------------------------------------
missing="$(comm -23 \
  <(git ls-tree --name-only HEAD supabase/migrations/ | sed 's#^.*/##' | sed 's/_.*//' | sort) \
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

printf 'main-upgrade: PASS (%d baseline migrations from main, %d candidate migrations, history and guards verified)\n' \
  "$baseline" "$candidate"
