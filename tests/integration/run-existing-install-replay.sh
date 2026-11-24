#!/usr/bin/env bash
# Existing-installation replay gate.
#
# `run-fresh-replay.sh` applies migrations to an EMPTY database. That does not
# catch the defect class that blocked PR #73: a cron migration that only fails
# when a pre-existing `video_worker_every_minute` job is present, because it
# required a session GUC that `supabase db push` can never set.
#
# This script reproduces the upgrade path instead: seed the scheduler rows a
# real installation already has, then apply every migration the way `db push`
# does (one file per transaction, no session GUCs, no operator intent).
#
# A migration set that manages a live scheduler will FAIL here. That is the
# signal to move the operation into supabase/operations/ and out of the
# migration path.
set -euo pipefail

migration_dir="${1:-supabase/migrations}"
db="prismatix-existing-replay-$$"

docker run --rm --detach --network none --name "$db" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
trap 'docker stop "$db" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 30); do
  if docker exec "$db" pg_isready -U postgres -h localhost >/dev/null 2>&1; then break; fi
  sleep 1
done

sql() { docker exec -i "$db" psql -U postgres -X -v ON_ERROR_STOP=1 "$@"; }

# `db push` runs each migration file inside one transaction. Reproduce that
# here; plain `psql < file` is autocommit and would leave partial DDL behind
# when a migration aborts on an existing installation.
apply_file() {
  {
    printf 'begin;\n'
    cat "$1"
    printf '\n;\ncommit;\n'
  } | sql -q
}

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

# Apply the historical migrations that built today's production scheduler first,
# so the run is a genuine upgrade rather than a fresh install.
apply_file "$migration_dir/20260210000000_init_conversations_messages.sql"

# Reconstruct the managed pg_cron surface an existing installation has, and seed
# the unsafe job owned by the database owner.
sql -q <<'SQL'
create schema cron;
create sequence cron.jobid_seq;
create table cron.job (
  jobid bigint primary key default nextval('cron.jobid_seq'),
  jobname text not null,
  schedule text not null,
  command text not null,
  nodename text not null default 'localhost',
  nodeport int not null default 5432,
  database text not null default current_database(),
  username text not null default current_user,
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

applied=0
for file in $(find "$migration_dir" -maxdepth 1 -name '*.sql' | sort); do
  name="$(basename "$file")"
  if ! apply_file "$file"; then
    printf '\nexisting-replay: FAILED applying %s\n' "$name" >&2
    printf 'existing-replay: this migration cannot run unattended through db push on an\n' >&2
    printf 'existing installation. Move live-scheduler operations to supabase/operations/.\n' >&2
    exit 1
  fi
  applied=$((applied + 1))
done

printf 'existing-replay: PASS (%d migrations applied over an existing install)\n' "$applied"
