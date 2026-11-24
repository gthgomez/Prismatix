-- Two sessions run the actual repair and rollback while the advisory lock is
-- held. They must fail promptly without changes, then succeed on an explicit
-- retry after the holder releases the lock.
\set ON_ERROR_STOP on
set statement_timeout = '15s';
do $$ begin
  if current_database() !~ '^prismatix_video_worker_cron_[a-z0-9]+_test$' then
    raise exception 'disposable video worker cron test database required';
  end if;
end $$;
create extension if not exists dblink;
select dblink_connect('migration_worker', format('host=%L port=%L dbname=%L user=%L application_name=prismatix_cron_migration_test',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select dblink_connect('rollback_worker', format('host=%L port=%L dbname=%L user=%L application_name=prismatix_cron_rollback_test',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select pg_read_file(:'cron_migration_file') as migration_sql \gset
select pg_read_file(:'cron_rollback_file') as rollback_sql \gset
begin;
select pg_advisory_xact_lock(804129183, 20261121);
select dblink_send_query('migration_worker', :'migration_sql');
select dblink_send_query('rollback_worker', :'rollback_sql');
do $$ declare attempt integer; begin
  for attempt in 1..100 loop
    if dblink_is_busy('migration_worker') = 0 and dblink_is_busy('rollback_worker') = 0 then
      return;
    end if;
    perform pg_sleep(0.02);
  end loop;
  raise exception 'forward repair or rollback waited on the advisory lock';
end $$;
select * from dblink_get_result('migration_worker', false) as result(status text);
select * from dblink_get_result('rollback_worker', false) as result(status text);
do $$ begin
  if dblink_error_message('migration_worker') not like '%advisory lock is busy%' or
     dblink_error_message('rollback_worker') not like '%advisory lock is busy%' then
    raise exception 'busy advisory lock did not fail for the expected reason';
  end if;
end $$;
commit;
select dblink_disconnect('migration_worker');
select dblink_disconnect('rollback_worker');
-- Explicit retry, using fresh sessions, succeeds without enabling a job.
select dblink_connect('migration_retry', format('host=%L port=%L dbname=%L user=%L',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select dblink_connect('rollback_retry', format('host=%L port=%L dbname=%L user=%L',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select dblink_exec('migration_retry', :'migration_sql');
select dblink_exec('rollback_retry', :'rollback_sql');
select dblink_disconnect('migration_retry');
select dblink_disconnect('rollback_retry');
do $$ begin
  if exists (select 1 from cron.job where jobname='video_worker_every_minute' and database=current_database()) then
    raise exception 'concurrent no-config retry left a worker registered';
  end if;
end $$;
\echo 'video_worker_cron_concurrency.sql: PASS'
