#!/usr/bin/env bash
# Genuine existing-installation upgrade: build a database from the ACTUAL
# current main-branch migration set on a Supabase Postgres image (so pg_cron,
# pg_net and vault exist as they do on a real installation), seed
# representative historical data - including financial rows the candidate's
# NOT VALID guards must tolerate - then apply the candidate's new migrations
# one file per transaction, exactly as `db push` does, recording the same
# history versions.
#
# Why not `supabase migration up --db-url`: CLI 2.98.2 forces TLS for a
# `--db-url` connection and refuses a TLS-less container ("server refused TLS
# connection"). The fresh-install gate uses the real runner (`db reset`); this
# gate reproduces the runner's per-file transaction semantics against a real
# main baseline. The limitation is recorded in the qualification record.
#
# SAFETY: the container runs with `--network none`. The historical main
# migration `20261006120000_video_worker_cron_vault_secret.sql` schedules a
# pg_cron job that posts to the production video-worker endpoint, and pg_net
# may execute it while the baseline is replayed. Replaying that file on a
# networked container is a production side effect, regardless of whether the
# vault secret resolves. `--network none` plus a live egress negative control
# below makes external contact impossible rather than merely unlikely.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

BASE_REF="${BASE_REF:-origin/main}"
BASE_SHA="$(git rev-parse "$BASE_REF")"
IMAGE="${UPGRADE_DB_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.158}"
DB="prismatix-main-upgrade-$$"
TMP="$(mktemp -d)"

cleanup() {
  docker rm -f "$DB" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

printf 'main-upgrade: baseline %s (%s)\n' "$BASE_REF" "$BASE_SHA"

# No published port and no network namespace: psql is reached via `docker exec`.
docker run --detach --network none --name "$DB" \
  -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$DB" pg_isready -U supabase_admin -h localhost >/dev/null 2>&1; then break; fi
  sleep 1
done

sql() { docker exec -i "$DB" psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 "$@"; }

fail() { printf 'main-upgrade: %s\n' "$*" >&2; exit 1; }

# --- Enforced network isolation ---------------------------------------------
# Assert the container contract instead of trusting the command line above.
netmode="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$DB")"
[[ "$netmode" == 'none' ]] || fail "container network mode is '$netmode', expected 'none'"

# Live negative control: an outbound TCP connect must fail. `/dev/tcp` is a
# bash built-in, so this needs no tool installed in the image. If this ever
# succeeds, the replay could reach production and the run must stop before any
# migration is applied.
if docker exec "$DB" timeout 5 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' >/dev/null 2>&1; then
  fail 'egress negative control connected to 1.1.1.1:443; refusing to replay production-targeted migrations'
fi
# Resolve the production hostname the historical migration embeds. It must not
# resolve; a cached resolver or a configured proxy would be a safety defect.
if docker exec "$DB" getent hosts sqjfbqjogylkfwzsyprd.supabase.co >/dev/null 2>&1; then
  fail 'egress negative control resolved the production hostname; refusing to replay'
fi
printf 'main-upgrade: network isolation verified (network=none, TCP egress denied, production DNS unresolved)\n'

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

# Apply one migration inside a single transaction and record its history in
# that same transaction. psql's ON_ERROR_STOP aborts the session on the first
# error; the open transaction is then rolled back by the server, and the
# history insert disappears with it. This is the property the previous
# implementation claimed but did not enforce: `psql < file` runs in autocommit
# mode, so a migration that failed halfway left earlier statements applied and
# its history row could still be recorded by a separate command.
apply_migration_file() {
  local version="$1" name="$2" file="$3"
  {
    printf 'begin;\n'
    cat "$file"
    printf '\n;\n'
    printf "insert into supabase_migrations.schema_migrations(version, name) values ('%s', '%s') on conflict (version) do nothing;\n" \
      "$version" "$name"
    printf 'commit;\n'
  } | sql -q
}

baseline=0
for name in "${main_files[@]}"; do
  [[ -z "$name" ]] && continue
  git show "${BASE_SHA}:supabase/migrations/${name}" > "$TMP/current.sql"
  version="${name%%_*}"
  if ! apply_migration_file "$version" "$name" "$TMP/current.sql"; then
    printf 'main-upgrade: FAILED applying baseline %s\n' "$name" >&2
    exit 1
  fi
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
  version="${name%%_*}"
  if ! apply_migration_file "$version" "$name" "$file"; then
    printf 'main-upgrade: FAILED applying candidate %s\n' "$name" >&2
    exit 1
  fi
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

# --- Atomicity and recovery fixtures ----------------------------------------
# Prove the apply function's transaction contract on the same container, with
# deliberately failing migrations. These are qualification fixtures, not
# product migrations.

printf '%s\n' \
  'create table public.upgrade_atomicity_probe (id integer primary key);' \
  'insert into public.upgrade_atomicity_probe values (1);' \
  'select 1 / 0;' > "$TMP/failing.sql"

if apply_migration_file '20990101000000' '20990101000000_failing_fixture.sql' "$TMP/failing.sql"; then
  fail 'a deliberately failing migration was reported as applied'
fi
probe_table="$(sql -tA -c "select coalesce(to_regclass('public.upgrade_atomicity_probe')::text, '')")"
[[ -z "$probe_table" ]] || fail "failed migration left its table behind: $probe_table"
probe_history="$(sql -tA -c "select count(*) from supabase_migrations.schema_migrations where version = '20990101000000'")"
[[ "$probe_history" == '0' ]] || fail 'failed migration was falsely recorded in migration history'

# Interrupted connection: terminating the backend mid-transaction must roll
# back the DDL and leave no history row, then the database must accept the
# repaired migration on the next connection.
printf '%s\n' \
  'create table public.upgrade_interrupt_probe (id integer primary key);' \
  'select pg_terminate_backend(pg_backend_pid());' > "$TMP/interrupted.sql"

if apply_migration_file '20990102000000' '20990102000000_interrupted_fixture.sql' "$TMP/interrupted.sql"; then
  fail 'a migration that lost its connection was reported as applied'
fi
interrupt_table="$(sql -tA -c "select coalesce(to_regclass('public.upgrade_interrupt_probe')::text, '')")"
[[ -z "$interrupt_table" ]] || fail "interrupted migration left its table behind: $interrupt_table"
interrupt_history="$(sql -tA -c "select count(*) from supabase_migrations.schema_migrations where version = '20990102000000'")"
[[ "$interrupt_history" == '0' ]] || fail 'interrupted migration was falsely recorded in migration history'

printf '%s\n' \
  'create table public.upgrade_atomicity_probe (id integer primary key);' \
  'insert into public.upgrade_atomicity_probe values (1);' > "$TMP/repaired.sql"
apply_migration_file '20990101000000' '20990101000000_failing_fixture.sql' "$TMP/repaired.sql" \
  || fail 'forward repair after a failed migration did not apply'
repaired_rows="$(sql -tA -c "select count(*) from public.upgrade_atomicity_probe")"
[[ "$repaired_rows" == '1' ]] || fail 'forward repair did not preserve its committed data'

# The replayed historical scheduler must not have completed a production call.
# pg_net preserves failed/queued requests; a row pointing at production is only
# acceptable here because network=none made delivery impossible, but the
# strongest safety statement is that no HTTP response was ever recorded.
if [[ "$(sql -tA -c "select count(*) from pg_namespace where nspname = 'net'")" == '1' ]]; then
  responses="$(sql -tA -c "select count(*) from net._http_response" 2>/dev/null || echo 0)"
  [[ "${responses:-0}" == '0' ]] || fail "network isolation violated: net recorded ${responses} HTTP response(s)"
fi

printf 'main-upgrade: atomicity fixtures PASS (failed and interrupted migrations left no DDL and no history; forward repair applied)\n'
printf 'main-upgrade: PASS (%d baseline migrations from main, %d candidate migrations, history and guards verified)\n' \
  "$baseline" "$candidate"
