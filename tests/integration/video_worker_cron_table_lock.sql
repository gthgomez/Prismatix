-- Both actual scripts hold a conflicting table lock until their transaction
-- ends. An unrelated external writer waits only for that transaction.
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
select dblink_connect('repair_holder', format('host=%L port=%L dbname=%L user=%L',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select dblink_connect('repair_writer', format('host=%L port=%L dbname=%L user=%L application_name=prismatix_cron_repair_writer_test',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select dblink_exec('repair_writer', 'set lock_timeout = ''5s''');
select dblink_exec('repair_holder', 'begin');
select dblink_exec('repair_holder', :'migration_sql');
select dblink_send_query('repair_writer', $query$
  insert into cron.job(jobname, schedule, command) values ('repair_writer_probe','* * * * *','select 1')
$query$);
do $$ declare attempt integer; begin
  for attempt in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity where datname=current_database()
      and application_name='prismatix_cron_repair_writer_test'
      and wait_event_type='Lock' and wait_event='relation') then return; end if;
    perform pg_sleep(0.02);
  end loop;
  raise exception 'repair did not retain the table lock against an external writer';
end $$;
select dblink_exec('repair_holder', 'commit');
select * from dblink_get_result('repair_writer') as result(status text);
select dblink_disconnect('repair_holder');
select dblink_disconnect('repair_writer');

select dblink_connect('rollback_holder', format('host=%L port=%L dbname=%L user=%L',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select dblink_connect('rollback_writer', format('host=%L port=%L dbname=%L user=%L application_name=prismatix_cron_rollback_writer_test',
  split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database(), current_user));
select dblink_exec('rollback_writer', 'set lock_timeout = ''5s''');
select dblink_exec('rollback_holder', 'begin');
select dblink_exec('rollback_holder', :'rollback_sql');
select dblink_send_query('rollback_writer', $query$
  insert into cron.job(jobname, schedule, command) values ('rollback_writer_probe','* * * * *','select 1')
$query$);
do $$ declare attempt integer; begin
  for attempt in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity where datname=current_database()
      and application_name='prismatix_cron_rollback_writer_test'
      and wait_event_type='Lock' and wait_event='relation') then return; end if;
    perform pg_sleep(0.02);
  end loop;
  raise exception 'rollback did not retain the table lock against an external writer';
end $$;
select dblink_exec('rollback_holder', 'commit');
select * from dblink_get_result('rollback_writer') as result(status text);
select dblink_disconnect('rollback_holder');
select dblink_disconnect('rollback_writer');
do $$ begin
  if (select count(*) from cron.job where jobname in ('repair_writer_probe','rollback_writer_probe')) <> 2 then
    raise exception 'external writes did not complete after the lock was released';
  end if;
end $$;
delete from cron.job where jobname in ('repair_writer_probe','rollback_writer_probe');
\echo 'video_worker_cron_table_lock.sql: PASS'
