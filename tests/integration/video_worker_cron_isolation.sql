-- Stronger isolation must fail before locks; busy table locks fail promptly,
-- and an explicit READ COMMITTED retry observes subsequently committed rows.
\set ON_ERROR_STOP on
set statement_timeout = '15s';
do $$ begin
  if current_database() !~ '^prismatix_video_worker_cron_[a-z0-9]+_test$' then
    raise exception 'disposable video worker cron test database required';
  end if;
end $$;
create extension if not exists dblink;
select pg_read_file(:'cron_migration_file') as migration_sql \gset
select pg_read_file(:'cron_rollback_file') as rollback_sql \gset
insert into cron.job(jobname, schedule, command, username)
  values ('video_worker_every_minute','* * * * *','isolation sentinel','isolation_owner');
select dblink_connect('repeatable_worker', format('host=%L port=%L dbname=%L user=%L',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select dblink_connect('serial_worker', format('host=%L port=%L dbname=%L user=%L',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select dblink_exec('repeatable_worker', 'set default_transaction_isolation = ''repeatable read''');
select dblink_exec('serial_worker', 'set default_transaction_isolation = ''serializable''');
select dblink_exec('repeatable_worker', 'set prismatix.video_worker_quarantined = ''on''');
select dblink_exec('serial_worker', 'set prismatix.video_worker_quarantined = ''on''');
begin;
select pg_advisory_xact_lock(804129183, 20261121);
select dblink_send_query('repeatable_worker', :'migration_sql');
select dblink_send_query('serial_worker', :'rollback_sql');
do $$ declare attempt integer; begin
  for attempt in 1..100 loop
    if dblink_is_busy('repeatable_worker') = 0 and dblink_is_busy('serial_worker') = 0 then return; end if;
    perform pg_sleep(0.02);
  end loop;
  raise exception 'strong isolation did not fail before the advisory lock';
end $$;
select * from dblink_get_result('repeatable_worker', false) as result(status text);
select * from dblink_get_result('serial_worker', false) as result(status text);
do $$ begin
  if dblink_error_message('repeatable_worker') not like '%READ COMMITTED%' or
     dblink_error_message('serial_worker') not like '%READ COMMITTED%' then
    raise exception 'strong isolation did not fail for the expected reason';
  end if;
  if not exists (select 1 from cron.job where jobname='video_worker_every_minute'
                 and database=current_database() and command='isolation sentinel') then
    raise exception 'strong isolation changed a worker job';
  end if;
end $$;
commit;
select dblink_disconnect('repeatable_worker');
select dblink_disconnect('serial_worker');
set prismatix.video_worker_quarantined = 'on';
\ir ../../supabase/operations/disable_video_worker_cron.sql
reset prismatix.video_worker_quarantined;

-- An uncooperative writer can hold a conflicting table lock. Both scripts
-- must fail promptly; after the writer commits a job, a fresh repair must see
-- that job and reject absent quarantine intent.
select dblink_connect('table_migration_worker', format('host=%L port=%L dbname=%L user=%L',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select dblink_connect('table_rollback_worker', format('host=%L port=%L dbname=%L user=%L',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
begin;
lock table cron.job in row exclusive mode;
select dblink_send_query('table_migration_worker', :'migration_sql');
do $$ declare attempt integer; begin
  for attempt in 1..100 loop
    if dblink_is_busy('table_migration_worker') = 0 then return; end if;
    perform pg_sleep(0.02);
  end loop;
  raise exception 'repair waited for the external writer table lock';
end $$;
select * from dblink_get_result('table_migration_worker', false) as result(status text);
select dblink_send_query('table_rollback_worker', :'rollback_sql');
do $$ declare attempt integer; begin
  for attempt in 1..100 loop
    if dblink_is_busy('table_rollback_worker') = 0 then return; end if;
    perform pg_sleep(0.02);
  end loop;
  raise exception 'rollback waited for the external writer table lock';
end $$;
select * from dblink_get_result('table_rollback_worker', false) as result(status text);
do $$ begin
  if dblink_error_message('table_migration_worker') not like '%cron.job write lock is busy%' or
     dblink_error_message('table_rollback_worker') not like '%cron.job write lock is busy%' then
    raise exception 'busy table lock did not fail for the expected reason';
  end if;
end $$;
insert into cron.job(jobname, schedule, command, username)
  values ('video_worker_every_minute','* * * * *','committed before retry','isolation_owner');
commit;
select dblink_disconnect('table_migration_worker');
select dblink_disconnect('table_rollback_worker');
select dblink_connect('read_committed_retry', format('host=%L port=%L dbname=%L user=%L',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select dblink_send_query('read_committed_retry', :'migration_sql');
select * from dblink_get_result('read_committed_retry', false) as result(status text);
do $$ begin
  if dblink_error_message('read_committed_retry') not like '%quarantined-job intent%' or
     not exists (select 1 from cron.job where jobname='video_worker_every_minute'
       and database=current_database() and command='committed before retry') then
    raise exception 'READ COMMITTED retry missed or changed the newly committed job';
  end if;
end $$;
select dblink_disconnect('read_committed_retry');
set prismatix.video_worker_quarantined = 'on';
\ir ../../supabase/operations/disable_video_worker_cron.sql
reset prismatix.video_worker_quarantined;
\echo 'video_worker_cron_isolation.sql: PASS'
