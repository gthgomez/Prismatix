-- Controlled rollback / emergency disable for a quarantined installation.
-- Does not restore an old endpoint, remove Vault entries, or touch user data.
-- Apply only after stopping or draining any in-flight / queued requests.
do $rollback$
declare
  old_job record;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Video worker operations require READ COMMITTED isolation';
  end if;
  -- Shared with the forward repair. The table lock below also excludes
  -- external cron.job writes until this transaction ends.
  if not pg_try_advisory_xact_lock(804129183, 20261121) then
    raise exception 'Video worker advisory lock is busy; investigate and retry';
  end if;
  if to_regclass('cron.job') is null then
    return;
  end if;
  if row_security_active('cron.job'::regclass) then
    raise exception 'Video worker cleanup requires full cron.job visibility';
  end if;

  -- Prevent concurrent cron.job writes through the end of this transaction.
  -- Insufficient table-lock privilege fails the operation instead of guessing.
  begin
    lock table cron.job in share row exclusive mode nowait;
  exception when lock_not_available then
    raise exception 'Video worker cron.job write lock is busy; investigate and retry';
  end;
  if exists (select 1 from cron.job where jobname = 'video_worker_every_minute'
             and database = current_database())
     and current_setting('prismatix.video_worker_quarantined', true) is distinct from 'on' then
    raise exception 'Video worker cleanup requires explicit quarantined-job intent';
  end if;
  for old_job in select jobid from cron.job where jobname = 'video_worker_every_minute'
                 and database = current_database() loop
    if cron.unschedule(old_job.jobid) is distinct from true then
      raise exception 'Could not disable video worker cron job %', old_job.jobid;
    end if;
  end loop;
  if exists (select 1 from cron.job where jobname = 'video_worker_every_minute'
             and database = current_database()) then
    raise exception 'Could not disable all video worker cron jobs';
  end if;
end
$rollback$;
