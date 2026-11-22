-- Exercise the real 20-character ref branch without any network-capable stub.
-- The all-zero reference is synthetic; it must never be contacted.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() !~ '^prismatix_video_worker_cron_[a-z0-9]+_test$' then
    raise exception 'disposable video worker cron test database required';
  end if;
end $$;
update vault.decrypted_secrets set decrypted_secret='00000000000000000000'
  where name='video_worker_staging_project_ref';
update vault.decrypted_secrets set decrypted_secret='synthetic-local-secret'
  where name='video_worker_secret';
-- Valid configuration alone cannot silently enable an existing feature.
\ir ../../supabase/migrations/20261121234725_disable_unsafe_video_worker_cron.sql
do $$ begin
  if exists (select 1 from cron.job where jobname='video_worker_every_minute' and database=current_database()) then
    raise exception 'synthetic staging was enabled without intent';
  end if;
end $$;
set prismatix.video_worker_enable_staging = 'on';
-- Real pg_cron upserts by name and owner across databases. A same-owner job
-- elsewhere must cause a safe failure, not be overwritten or migrated here.
insert into cron.job(jobname, schedule, command, username, database) values
  ('video_worker_every_minute','* * * * *','same owner elsewhere',current_user,'another_database'),
  ('video_worker_every_minute','* * * * *','current database legacy','owner_a',current_database());
set prismatix.video_worker_quarantined = 'on';
\set ON_ERROR_STOP off
\ir ../../supabase/migrations/20261121234725_disable_unsafe_video_worker_cron.sql
\set collision_failed :ERROR
\set ON_ERROR_STOP on
\if :collision_failed
\else
  \echo 'same-owner other-database collision unexpectedly succeeded'
  \ir video_worker_assertion_failure.sql
\endif
do $$ begin
  if not exists (select 1 from cron.job where jobname='video_worker_every_minute'
    and username=current_user and database='another_database' and command='same owner elsewhere') or
     not exists (select 1 from cron.job where jobname='video_worker_every_minute'
       and database=current_database() and command='current database legacy') then
    raise exception 'same-owner collision changed a job';
  end if;
end $$;
delete from cron.job where jobname='video_worker_every_minute'
  and username=current_user and database='another_database';
\ir ../../supabase/migrations/20261121234725_disable_unsafe_video_worker_cron.sql
reset prismatix.video_worker_quarantined;
do $$ declare cmd text; begin
  select command into strict cmd from cron.job where jobname='video_worker_every_minute' and database=current_database();
  if cmd not like '%https://00000000000000000000.supabase.co/functions/v1/video-worker%' or
     cmd like '%synthetic-local-secret%' or cmd like '%sqjfbqjogylkfwzsyprd%' then
    raise exception 'synthetic canonical URL or credential isolation failed';
  end if;
  execute cmd;
  if (select count(*) from net.requests) <> 4 or not exists (
    select 1 from net.requests
      where url='http://127.0.0.1:54321/functions/v1/video-worker'
        and requested_url='https://00000000000000000000.supabase.co/functions/v1/video-worker'
        and headers->>'x-worker-secret'='synthetic-local-secret') then
    raise exception 'synthetic configured command did not reach the inert localhost recorder';
  end if;
  update vault.decrypted_secrets set decrypted_secret='sqjfbqjogylkfwzsyprd'
    where name='video_worker_staging_project_ref';
  execute cmd;
  update vault.decrypted_secrets set decrypted_secret='00000000000000000000'
    where name='video_worker_staging_project_ref';
  update vault.decrypted_secrets set decrypted_secret=E'bad\rsecret' where name='video_worker_secret';
  execute cmd;
  update vault.decrypted_secrets set decrypted_secret=' leading' where name='video_worker_secret';
  execute cmd;
  delete from vault.decrypted_secrets where name='video_worker_secret';
  execute cmd;
  insert into vault.decrypted_secrets values ('video_worker_secret','synthetic-local-secret'),
                                              ('video_worker_secret','duplicate');
  execute cmd;
  delete from vault.decrypted_secrets where name='video_worker_secret';
  insert into vault.decrypted_secrets values ('video_worker_secret','synthetic-local-secret');
  if (select count(*) from net.requests) <> 4 then
    raise exception 'invalid synthetic staging configuration sent a request';
  end if;
end $$;
-- Cleanup intent does not authorize re-enabling: without the separate enable
-- marker, reapplying removes the job and leaves it off.
reset prismatix.video_worker_enable_staging;
set prismatix.video_worker_quarantined = 'on';
\ir ../../supabase/migrations/20261121234725_disable_unsafe_video_worker_cron.sql
reset prismatix.video_worker_quarantined;
do $$ begin
  if exists (select 1 from cron.job where jobname='video_worker_every_minute' and database=current_database()) then
    raise exception 'cleanup without enable intent did not leave the worker disabled';
  end if;
end $$;
set prismatix.video_worker_enable_staging = 'on';
\ir ../../supabase/migrations/20261121234725_disable_unsafe_video_worker_cron.sql
reset prismatix.video_worker_enable_staging;
do $$ declare cmd text; begin
  select command into strict cmd from cron.job where jobname='video_worker_every_minute' and database=current_database();
  execute cmd;
  if (select count(*) from net.requests) <> 5 then
    raise exception 'staging enable flag incorrectly gated later execution';
  end if;
end $$;
\echo 'video_worker_cron_synthetic_staging.sql: PASS'
