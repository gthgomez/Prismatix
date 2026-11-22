-- Invoke through a NEW psql process after video_worker_cron_safety.sql.
\set ON_ERROR_STOP on
do $$ declare cmd text; begin
  if current_database() !~ '^prismatix_video_worker_cron_[a-z0-9]+_test$' or
     current_setting('prismatix.video_worker_test_stub', true) = 'on' then
    raise exception 'fresh disposable session without marker required';
  end if;
  select command into strict cmd from cron.job where jobname='video_worker_every_minute' and database=current_database();
  execute cmd;
  if (select count(*) from net.requests) <> 2 then
    raise exception 'fresh cron session fired the test hook without opt-in';
  end if;
end $$;
set prismatix.video_worker_test_stub = 'on';
do $$ declare cmd text; begin
  select command into strict cmd from cron.job where jobname='video_worker_every_minute' and database=current_database();
  execute cmd;
  if (select count(*) from net.requests) <> 3 or exists (
    select 1 from net.requests where url <> 'http://127.0.0.1:54321/functions/v1/video-worker'
  ) then
    raise exception 'explicit fresh-session opt-in did not use the inert local stub';
  end if;
end $$;
reset prismatix.video_worker_test_stub;
do $$ declare cmd text; begin
  select command into strict cmd from cron.job where jobname='video_worker_every_minute' and database=current_database();
  execute cmd;
  if (select count(*) from net.requests) <> 3 then
    raise exception 'removed opt-in did not suppress the next tick';
  end if;
end $$;
set prismatix.video_worker_quarantined = 'on';
\ir ../../supabase/operations/disable_video_worker_cron.sql
reset prismatix.video_worker_quarantined;
do $$ begin
  if exists (select 1 from cron.job where jobname='video_worker_every_minute' and database=current_database()) then
    raise exception 'fresh-session cleanup failed';
  end if;
end $$;
\echo 'video_worker_cron_fresh_session.sql: PASS'
