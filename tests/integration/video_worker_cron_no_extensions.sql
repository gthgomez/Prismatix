-- Run before the main fixture in its empty, disposable _test database.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() !~ '^prismatix_video_worker_cron_[a-z0-9]+_test$' then
    raise exception 'This fixture requires a disposable video worker cron test database';
  end if;
  if to_regnamespace('cron') is not null or to_regnamespace('net') is not null or
     to_regnamespace('vault') is not null then
    raise exception 'Expected a fresh database with no managed extensions';
  end if;
end $$;
\ir ../../supabase/migrations/20260216103000_schedule_video_worker_cron.sql
\ir ../../supabase/migrations/20261006120000_video_worker_cron_vault_secret.sql
\ir ../../supabase/operations/quarantine_video_worker_cron.sql
\ir ../../supabase/operations/disable_video_worker_cron.sql
do $$ begin
  if to_regnamespace('cron') is not null or to_regnamespace('net') is not null or
     to_regnamespace('vault') is not null then
    raise exception 'fresh disabled replay unexpectedly installed an extension';
  end if;
end $$;
\echo 'video_worker_cron_no_extensions.sql: PASS'
