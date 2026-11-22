-- A real staging command must not rely on the registration session's opt-in.
\set ON_ERROR_STOP on
do $$ declare cmd text; begin
  if current_database() !~ '^prismatix_video_worker_cron_[a-z0-9]+_test$' or
     current_setting('prismatix.video_worker_enable_staging', true) = 'on' then
    raise exception 'fresh disposable session without enable marker required';
  end if;
  select command into strict cmd from cron.job where jobname='video_worker_every_minute' and database=current_database();
  execute cmd;
  if (select count(*) from net.requests) <> 6 or exists (
    select 1 from net.requests where url <> 'http://127.0.0.1:54321/functions/v1/video-worker') then
    raise exception 'fresh synthetic staging call did not reach only the inert local recorder';
  end if;
end $$;
set prismatix.video_worker_quarantined = 'on';
\ir ../../supabase/operations/disable_video_worker_cron.sql
reset prismatix.video_worker_quarantined;
do $$ begin
  if exists (select 1 from cron.job where jobname='video_worker_every_minute' and database=current_database()) or
     not exists (select 1 from cron.job where jobname='video_worker_every_minute' and database='another_database') then
    raise exception 'synthetic cleanup removed the wrong job or left this worker running';
  end if;
end $$;
\echo 'video_worker_cron_synthetic_fresh_session.sql: PASS'
