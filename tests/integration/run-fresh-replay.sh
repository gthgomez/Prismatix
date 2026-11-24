#!/usr/bin/env bash
# Fresh-install replay gate.
#
# Applies EVERY migration in supabase/migrations/ in filename order to an empty
# PostgreSQL 17 database, exactly as `supabase db push` would: one file per
# transaction, no session GUCs, no operator intent.
#
# This is the check that would have caught the wedged cron migration: that file
# raised unless a session-level GUC was set, which `db push` can never do, so it
# aborted on every existing installation and blocked every later migration.
#
# Scope: schema applyability only. It does not run RLS/RPC acceptance fixtures
# (see run-compare-postgres.sh) and does not touch hosted Supabase.
set -euo pipefail

migration_dir="${1:-supabase/migrations}"
db="prismatix-fresh-replay-$$"

docker run --rm --detach --network none --name "$db" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
trap 'docker stop "$db" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 30); do
  if docker exec "$db" pg_isready -U postgres -h localhost >/dev/null 2>&1; then break; fi
  sleep 1
done

sql() { docker exec -i "$db" psql -U postgres -X -v ON_ERROR_STOP=1 "$@"; }

# `db push` runs each migration file inside one transaction. Reproduce that
# here; plain `psql < file` is autocommit and would let a half-applied
# migration look successful.
apply_file() {
  {
    printf 'begin;\n'
    cat "$1"
    printf '\n;\ncommit;\n'
  } | sql -q
}

# Supabase-managed roles and schemas that migrations assume already exist.
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

applied=0
for file in $(find "$migration_dir" -maxdepth 1 -name '*.sql' | sort); do
  name="$(basename "$file")"
  if ! apply_file "$file"; then
    printf '\nfresh-replay: FAILED applying %s\n' "$name" >&2
    exit 1
  fi
  applied=$((applied + 1))
  printf '  ok  %s\n' "$name"
done

# Postconditions: a fresh replay must not install a scheduler or network worker.
sql -q <<'SQL'
do $$
begin
  if to_regnamespace('cron') is not null then
    raise exception 'fresh replay installed pg_cron; a new environment must not schedule a worker';
  end if;
  if to_regnamespace('net') is not null then
    raise exception 'fresh replay installed pg_net';
  end if;
end $$;
SQL

printf 'fresh-replay: PASS (%d migrations applied, no scheduler installed)\n' "$applied"
