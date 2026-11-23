-- Run only in an empty disposable database whose name ends in _test.
-- `cron` and `net` are inert PostgreSQL stand-ins: there is no network worker.
\set ON_ERROR_STOP on

do $$
begin
  if current_database() !~ '^prismatix_video_worker_cron_[a-z0-9]+_test$' then
    raise exception 'This fixture requires a disposable prismatix_video_worker_cron_<id>_test database';
  end if;
end $$;
create schema extensions;
\if :{?existing_stub_extensions}
create extension pg_cron with schema extensions;
create extension pg_net with schema extensions;
alter table cron.job drop constraint job_jobname_key;
alter table cron.job add column username text not null default current_user;
alter table cron.job add column database text not null default current_database();
alter table cron.job add constraint cron_test_name_owner_key unique(jobname, username);
\else
create schema cron;
create schema net;
create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text not null, schedule text not null, command text not null,
  username text not null default current_user,
  database text not null default current_database(),
  unique(jobname, username)
);
create table cron.job_history (jobname text not null, schedule text not null, command text not null);
\endif
create table net.requests (url text not null, requested_url text not null, headers jsonb not null, body jsonb not null);
-- This function cannot contact a network, and rejects all destinations except
-- the deterministic local test stub even if a defective cron command executes.
create or replace function cron.schedule(p_jobname text, p_schedule text, p_command text)
returns bigint language plpgsql as $$
declare id bigint;
begin
  insert into cron.job_history values (p_jobname, p_schedule, p_command);
  insert into cron.job(jobname, schedule, command)
    values (p_jobname, p_schedule, p_command)
    on conflict(jobname, username) do update set
      schedule=excluded.schedule, command=excluded.command, database=excluded.database
    returning jobid into id;
  return id;
end $$;
create or replace function cron.unschedule(p_jobname text)
returns boolean language plpgsql as $$
begin
  delete from cron.job where jobname = p_jobname and username = current_user;
  return found;
end $$;
create function cron.unschedule(p_jobid bigint)
returns boolean language plpgsql as $$
begin
  if current_setting('cron_test.deny_other_owner', true) = 'on' and
     exists (select 1 from cron.job where jobid = p_jobid and username = 'owner_b') then
    return false;
  end if;
  if exists (select 1 from cron.job where jobid = p_jobid and username <> current_user)
     and not (select rolsuper from pg_roles where rolname = current_user) then
    raise exception 'permission denied to unschedule another owner';
  end if;
  delete from cron.job where jobid = p_jobid;
  return found;
end $$;
alter table cron.job enable row level security;
create policy cron_test_owner on cron.job using (username = current_user);
grant usage on schema cron to authenticated;
grant select on cron.job to authenticated;

-- An installation with a prior job but missing Vault and pg_net's function is
-- still cleaned up and never registers a replacement.
insert into cron.job(jobname, schedule, command, username) values
 ('video_worker_every_minute','* * * * *','legacy production endpoint','owner_a');
\set ON_ERROR_STOP off
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
\set intent_missing_failed :ERROR
\set ON_ERROR_STOP on
\if :intent_missing_failed
\else
  \echo 'missing quarantine intent unexpectedly succeeded'
  \ir video_worker_assertion_failure.sql
\endif
set prismatix.video_worker_quarantined = 'invalid';
\set ON_ERROR_STOP off
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
\set intent_invalid_failed :ERROR
\set ON_ERROR_STOP on
\if :intent_invalid_failed
\else
  \echo 'invalid quarantine intent unexpectedly succeeded'
  \ir video_worker_assertion_failure.sql
\endif
do $$ begin
  if (select count(*) from cron.job where jobname='video_worker_every_minute' and database=current_database()) <> 1 then
    raise exception 'failed intent checks altered the legacy job';
  end if;
end $$;
set prismatix.video_worker_quarantined = 'on';
set prismatix.video_worker_enable_staging = 'on';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
reset prismatix.video_worker_quarantined;
reset prismatix.video_worker_enable_staging;
do $$ begin
  if exists (select 1 from cron.job where jobname='video_worker_every_minute' and database=current_database()) or
     exists (select 1 from cron.job_history) then
    raise exception 'missing Vault / pg_net did not leave worker disabled';
  end if;
end $$;
create schema vault;
create table vault.decrypted_secrets (name text not null, decrypted_secret text);
\ir video_worker_inert_net_stub.sql
-- Competing overload must never be selected by the scheduled command.
create function net.http_post(url text, body jsonb, headers jsonb)
returns bigint language plpgsql as $$ begin
  raise exception 'unsafe competing http_post overload was selected';
end $$;

-- Replay both genuine historical migration files in order. Nothing may ever
-- register a production or placeholder job, even between the migrations.
\ir ../../supabase/migrations/20260216103000_schedule_video_worker_cron.sql
do $$ begin
  if exists (select 1 from cron.job_history) then
    raise exception 'fresh replay registered a worker in the first historical migration';
  end if;
end $$;
\ir ../../supabase/migrations/20261006120000_video_worker_cron_vault_secret.sql
do $$ begin
  if exists (select 1 from cron.job_history) then
    raise exception 'fresh replay registered a worker in the second historical migration';
  end if;
end $$;

-- On an existing installation, two prior owners may each own the same jobname.
-- Insert directly so job_history contains only registrations by the repair.
insert into cron.job(jobname, schedule, command, username) values
 ('video_worker_every_minute','* * * * *','legacy production endpoint','owner_a'),
 ('video_worker_every_minute','* * * * *','legacy production endpoint','owner_b'),
 ('unrelated_job','* * * * *','select 1','owner_b');
insert into cron.job(jobname, schedule, command, username, database)
  values ('video_worker_every_minute','* * * * *','other database job','other_owner','another_database');
-- A role subject to cron.job RLS must fail instead of claiming cleanup succeeded
-- after seeing only its own rows.
set role authenticated;
\set ON_ERROR_STOP off
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
\set limited_failed :ERROR
\set limited_state :SQLSTATE
\set ON_ERROR_STOP on
reset role;
\if :limited_failed
  select :'limited_state' = 'P0001' as limited_expected \gset
  \if :limited_expected
  \else
    \echo 'limited role failed for an unexpected reason'
    \ir video_worker_assertion_failure.sql
  \endif
\else
  \echo 'limited role unexpectedly reported successful cleanup'
  \ir video_worker_assertion_failure.sql
\endif
-- A BYPASSRLS role with cross-owner SELECT but no table-write privilege still
-- cannot claim cleanup: acquiring the required table lock must fail closed.
grant usage on schema cron to service_role;
grant select on cron.job to service_role;
set role service_role;
\set ON_ERROR_STOP off
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
\set lock_permission_failed :ERROR
\set lock_permission_state :SQLSTATE
\set ON_ERROR_STOP on
reset role;
\if :lock_permission_failed
  select :'lock_permission_state' = '42501' as lock_permission_expected \gset
  \if :lock_permission_expected
  \else
    \echo 'table-lock privilege check failed for an unexpected reason'
    \ir video_worker_assertion_failure.sql
  \endif
\else
  \echo 'insufficient table-lock privilege unexpectedly succeeded'
  \ir video_worker_assertion_failure.sql
\endif
-- Even with full visibility, a failed removal must abort the entire DO and
-- roll back earlier unschedules in the same statement.
set prismatix.video_worker_quarantined = 'on';
set cron_test.deny_other_owner = 'on';
\set ON_ERROR_STOP off
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
\set removal_failed :ERROR
\set ON_ERROR_STOP on
reset cron_test.deny_other_owner;
\if :removal_failed
\else
  \echo 'failed unschedule unexpectedly reported success'
  \ir video_worker_assertion_failure.sql
\endif
do $$ begin
  if (select count(*) from cron.job where jobname='video_worker_every_minute' and database=current_database()) <> 2 then
    raise exception 'failed cleanup did not roll back earlier removals';
  end if;
end $$;
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
do $$ begin
  if exists (select 1 from cron.job where jobname='video_worker_every_minute' and database=current_database()) or
     not exists (select 1 from cron.job where jobname='unrelated_job') or
     not exists (select 1 from cron.job where jobname='video_worker_every_minute' and database='another_database') or
     exists (select 1 from cron.job_history) then
    raise exception 'existing cleanup, reapply, or unrelated-job preservation failed';
  end if;
end $$;
reset prismatix.video_worker_quarantined;

-- Missing, blank, malformed, duplicate, and production configurations must
-- remain disabled. The secret value is synthetic and is never put in cron SQL.
set prismatix.video_worker_enable_staging = 'on';
insert into vault.decrypted_secrets values ('video_worker_secret','local-test-secret');
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
insert into vault.decrypted_secrets values ('video_worker_staging_project_ref','');
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
update vault.decrypted_secrets set decrypted_secret=E' \t\n' where name='video_worker_staging_project_ref';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
update vault.decrypted_secrets set decrypted_secret='https://sqjfbqjogylkfwzsyprd.supabase.co/functions/v1/video-worker' where name='video_worker_staging_project_ref';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
update vault.decrypted_secrets set decrypted_secret='not/a/project' where name='video_worker_staging_project_ref';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
update vault.decrypted_secrets set decrypted_secret='sqjfbqjogylkfwzsyprd' where name='video_worker_staging_project_ref';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
update vault.decrypted_secrets set decrypted_secret='local-test-stub' where name='video_worker_staging_project_ref';
set prismatix.video_worker_test_stub = 'on';
insert into vault.decrypted_secrets values ('video_worker_staging_project_ref','local-test-stub');
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
delete from vault.decrypted_secrets where name='video_worker_staging_project_ref';
insert into vault.decrypted_secrets values ('video_worker_staging_project_ref','local-test-stub');
insert into vault.decrypted_secrets values ('video_worker_secret','another-test-secret');
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
delete from vault.decrypted_secrets where name='video_worker_secret';
insert into vault.decrypted_secrets values ('video_worker_secret',E' \t\n');
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
update vault.decrypted_secrets set decrypted_secret=E'bad\rsecret' where name='video_worker_secret';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
update vault.decrypted_secrets set decrypted_secret=E'bad\nsecret' where name='video_worker_secret';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
update vault.decrypted_secrets set decrypted_secret=' leading' where name='video_worker_secret';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
update vault.decrypted_secrets set decrypted_secret='trailing ' where name='video_worker_secret';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
update vault.decrypted_secrets set decrypted_secret=E'bad\tsecret' where name='video_worker_secret';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
do $$ begin
  if exists (select 1 from cron.job where jobname='video_worker_every_minute' and database=current_database()) or
     exists (select 1 from cron.job_history) then
    raise exception 'invalid configuration registered a worker';
  end if;
end $$;

update vault.decrypted_secrets set decrypted_secret='local-test-secret' where name='video_worker_secret';
-- Valid configuration must stay disabled unless enabling is explicitly opted in.
reset prismatix.video_worker_enable_staging;
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
set prismatix.video_worker_enable_staging = 'invalid';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
do $$ begin
  if exists (select 1 from cron.job_history) then
    raise exception 'valid configuration scheduled a worker without enable intent';
  end if;
end $$;
set prismatix.video_worker_enable_staging = 'on';
reset prismatix.video_worker_test_stub;
-- A test database name alone is not an opt-in, nor does the marker make a real
-- pg_net function inert. Both the session marker and inert fixture are required.
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
do $$ begin
  if exists (select 1 from cron.job_history) then
    raise exception 'test stub scheduled without explicit session marker';
  end if;
end $$;
set prismatix.video_worker_test_stub = 'on';
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 1000)
returns bigint language plpgsql as $$
begin
  insert into net.requests values ('http://127.0.0.1:54321/functions/v1/video-worker', url, headers, body);
  return 1;
end $$;
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
do $$ begin
  if exists (select 1 from cron.job_history) then
    raise exception 'test stub scheduled without inert function marker';
  end if;
end $$;
\ir video_worker_inert_net_stub.sql
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
set prismatix.video_worker_quarantined = 'on';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
reset prismatix.video_worker_quarantined;
do $$
declare cmd text;
begin
  if (select count(*) from cron.job where jobname='video_worker_every_minute' and database=current_database()) <> 1 then
    raise exception 'configured reapply did not leave exactly one worker';
  end if;
  if exists (select 1 from cron.job_history where
    command not like '%http://127.0.0.1:54321/functions/v1/video-worker%' or
    command like '%local-test-secret%' or command like '%sqjfbqjogylkfwzsyprd%') then
    raise exception 'registered target or secret unsafe';
  end if;
  select command into cmd from cron.job where jobname='video_worker_every_minute' and database=current_database();
  execute cmd;
  if (select count(*) from net.requests) <> 1 or not exists (
    select 1 from net.requests where url='http://127.0.0.1:54321/functions/v1/video-worker'
      and headers->>'x-worker-secret'='local-test-secret') then
    raise exception 'scheduled command did not call the local stub with its live secret';
  end if;
  -- Removing the opt-in after registration suppresses the next tick.
  perform set_config('prismatix.video_worker_test_stub', 'off', false);
  execute cmd;
  perform set_config('prismatix.video_worker_test_stub', 'on', false);
  if (select count(*) from net.requests) <> 1 then
    raise exception 'local stub fired after the session marker was removed';
  end if;
  -- Changing the target, deleting it, or making it ambiguous must not result
  -- in a call, even before the schedule is explicitly reconfigured.
  update vault.decrypted_secrets set decrypted_secret='sqjfbqjogylkfwzsyprd'
    where name='video_worker_staging_project_ref';
  execute cmd;
  delete from vault.decrypted_secrets where name='video_worker_staging_project_ref';
  execute cmd;
  insert into vault.decrypted_secrets values
    ('video_worker_staging_project_ref','local-test-stub'),
    ('video_worker_staging_project_ref','local-test-stub');
  execute cmd;
  delete from vault.decrypted_secrets where name='video_worker_staging_project_ref';
  insert into vault.decrypted_secrets values ('video_worker_staging_project_ref','local-test-stub');
  -- A changed valid secret rotates at the pinned local target; ambiguous,
  -- whitespace-only, NULL, or missing secrets suppress the request.
  update vault.decrypted_secrets set decrypted_secret='rotated-local-secret'
    where name='video_worker_secret';
  execute cmd;
  if (select count(*) from net.requests) <> 2 or not exists (
    select 1 from net.requests where headers->>'x-worker-secret'='rotated-local-secret') then
    raise exception 'valid secret rotation failed';
  end if;
  insert into vault.decrypted_secrets values ('video_worker_secret','duplicate');
  execute cmd;
  delete from vault.decrypted_secrets where name='video_worker_secret';
  insert into vault.decrypted_secrets values ('video_worker_secret',E' \t\n');
  execute cmd;
  update vault.decrypted_secrets set decrypted_secret=E'bad\rsecret' where name='video_worker_secret';
  execute cmd;
  update vault.decrypted_secrets set decrypted_secret=E'bad\nsecret' where name='video_worker_secret';
  execute cmd;
  update vault.decrypted_secrets set decrypted_secret=' leading' where name='video_worker_secret';
  execute cmd;
  update vault.decrypted_secrets set decrypted_secret='trailing ' where name='video_worker_secret';
  execute cmd;
  update vault.decrypted_secrets set decrypted_secret=E'bad\tsecret' where name='video_worker_secret';
  execute cmd;
  update vault.decrypted_secrets set decrypted_secret=null where name='video_worker_secret';
  execute cmd;
  delete from vault.decrypted_secrets where name='video_worker_secret';
  execute cmd;
  if (select count(*) from net.requests) <> 2 then
    raise exception 'scheduled command fired with an invalid or changed configuration';
  end if;
end $$;
-- Rollback is an explicit disabling operation, never the old production job.
-- Its repeated application preserves the Vault config and unrelated jobs.
insert into vault.decrypted_secrets values ('video_worker_secret','local-test-secret');
-- Replacing the inert function after registration also suppresses the tick.
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 1000)
returns bigint language plpgsql as $$
begin
  insert into net.requests values ('http://127.0.0.1:54321/functions/v1/video-worker', url, headers, body);
  return 1;
end $$;
do $$ declare cmd text; begin
  select command into cmd from cron.job where jobname='video_worker_every_minute' and database=current_database();
  execute cmd;
  if (select count(*) from net.requests) <> 2 then
    raise exception 'local stub fired after the inert function marker was removed';
  end if;
end $$;
\ir video_worker_inert_net_stub.sql
\set ON_ERROR_STOP off
\ir ../../supabase/operations/disable_video_worker_cron.sql
\set rollback_missing_failed :ERROR
\set ON_ERROR_STOP on
\if :rollback_missing_failed
\else
  \echo 'rollback without quarantine intent unexpectedly succeeded'
  \ir video_worker_assertion_failure.sql
\endif
set prismatix.video_worker_quarantined = 'invalid';
\set ON_ERROR_STOP off
\ir ../../supabase/operations/disable_video_worker_cron.sql
\set rollback_invalid_failed :ERROR
\set ON_ERROR_STOP on
\if :rollback_invalid_failed
\else
  \echo 'rollback with invalid quarantine intent unexpectedly succeeded'
  \ir video_worker_assertion_failure.sql
\endif
do $$ begin
  if (select count(*) from cron.job where jobname='video_worker_every_minute' and database=current_database()) <> 1 then
    raise exception 'failed rollback intent altered the worker';
  end if;
end $$;
set prismatix.video_worker_quarantined = 'on';
\ir ../../supabase/operations/disable_video_worker_cron.sql
\ir ../../supabase/operations/disable_video_worker_cron.sql
reset prismatix.video_worker_quarantined;
-- The same-named other-database job alone must not require an opt-in or be removed.
\ir ../../supabase/operations/disable_video_worker_cron.sql
do $$ begin
  if exists (select 1 from cron.job where jobname='video_worker_every_minute' and database=current_database()) or
     not exists (select 1 from cron.job where jobname='unrelated_job') or
     not exists (select 1 from cron.job where jobname='video_worker_every_minute' and database='another_database') or
     (select count(*) from vault.decrypted_secrets) <> 2 then
    raise exception 'rollback failed to disable or changed unrelated state';
  end if;
end $$;
-- An operator may deliberately reconfigure by rerunning the forward repair;
-- invalidating the configured ref on a later reapply must disable it again.
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
update vault.decrypted_secrets set decrypted_secret='sqjfbqjogylkfwzsyprd'
  where name='video_worker_staging_project_ref';
set prismatix.video_worker_quarantined = 'on';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
reset prismatix.video_worker_quarantined;
do $$ begin
  if exists (select 1 from cron.job where jobname='video_worker_every_minute' and database=current_database()) or
     exists (select 1 from cron.job_history where
       command not like '%http://127.0.0.1:54321/functions/v1/video-worker%' or
       command like '%local-test-secret%' or command like '%sqjfbqjogylkfwzsyprd%') or
     exists (select 1 from net.requests where url <> 'http://127.0.0.1:54321/functions/v1/video-worker') then
    raise exception 'rollback or production-ref reapply was unsafe';
  end if;
end $$;
-- Leave one inert local-stub command for a separate psql session. The next
-- fixture checks it cannot fire without its own explicit session marker.
update vault.decrypted_secrets set decrypted_secret='local-test-stub'
  where name='video_worker_staging_project_ref';
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
do $$ begin
  if (select count(*) from cron.job where jobname='video_worker_every_minute' and database=current_database()) <> 1 then
    raise exception 'fresh-session fixture could not obtain its local command';
  end if;
end $$;
\echo 'video_worker_cron_safety.sql: PASS'
