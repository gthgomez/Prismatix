-- Repair existing installations after the two historical migration versions.
-- No application data or Vault records are modified. Unless the two explicit
-- staging Vault entries are valid and enabling is explicit, no replacement is
-- registered. Existing matching jobs require explicit quarantine intent before
-- any change, including on production. Production rollout needs a separately
-- approved replacement schedule.
--
-- An existing installation must first quarantine the old job, including any
-- already-running invocation and queued pg_net request; removing a cron row
-- cannot recall work already in flight. This migration may be rerun by a
-- privileged operator after configuration changes. Do not rerun the old files.

do $migration$
declare
  old_job record;
  staging_ref text;
  ref_count bigint;
  secret_count bigint;
  valid_secret_count bigint;
  worker_url text;
  worker_command text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Video worker operations require READ COMMITTED isolation';
  end if;
  -- Fail promptly if another cooperating repair is running. The table lock
  -- below also excludes external cron.job writes until this transaction ends.
  if not pg_try_advisory_xact_lock(804129183, 20261121) then
    raise exception 'Video worker advisory lock is busy; investigate and retry';
  end if;

  -- A fresh replay needs no cron extension or network worker at all. Do not
  -- create either merely because a migration was run.
  if to_regclass('cron.job') is null then
    raise notice 'Video worker disabled: pg_cron is not installed.';
    return;
  end if;

  -- A role restricted by cron.job RLS could see zero rows even while another
  -- owner still has an unsafe job. Abort instead of falsely claiming cleanup.
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

  -- Job names need not be globally unique across owners in pg_cron. Remove
  -- every matching job in the current database by ID; failed removals fail
  -- the migration rather than leaving a false success.
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

  -- Registering a schedule is a separate operator decision. This is intent,
  -- not proof that the database/target is nonproduction.
  if current_setting('prismatix.video_worker_enable_staging', true) is distinct from 'on' then
    raise notice 'Video worker disabled: staging schedule not explicitly enabled.';
    return;
  end if;

  if to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise notice 'Video worker disabled: Vault or pg_net is unavailable.';
    return;
  end if;

  select count(*), min(decrypted_secret)
    into ref_count, staging_ref
    from vault.decrypted_secrets where name = 'video_worker_staging_project_ref';
  select count(*), count(*) filter (where decrypted_secret is not null and decrypted_secret collate "C" ~ '^[!-~]+$')
    into secret_count, valid_secret_count
    from vault.decrypted_secrets where name = 'video_worker_secret';

  if ref_count <> 1 or secret_count <> 1 or valid_secret_count <> 1 then
    raise notice 'Video worker disabled: incomplete or ambiguous staging configuration.';
    return;
  end if;

  if staging_ref = 'local-test-stub'
     and current_database() ~ '^prismatix_video_worker_cron_[a-z0-9]+_test$'
     and current_setting('prismatix.video_worker_test_stub', true) = 'on'
     and exists (
       select 1 from pg_catalog.pg_proc
       where oid = to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)')
         and strpos(prosrc, 'prismatix_inert_net_http_post_test_only') > 0
     ) then
    -- This sentinel is only for a disposable local test database. Its network
    -- function must itself be the deterministic no-network test stub.
    worker_url := 'http://127.0.0.1:54321/functions/v1/video-worker';
  elsif staging_ref ~ '^[a-z0-9]{20}$' and staging_ref <> 'sqjfbqjogylkfwzsyprd' then
    worker_url := 'https://' || staging_ref || '.supabase.co/functions/v1/video-worker';
  else
    raise notice 'Video worker disabled: invalid or production project reference.';
    return;
  end if;

  -- Only the target and its expected reference are embedded. The credential
  -- is read from Vault at fire time. A removed, duplicated, or invalid secret
  -- suppresses requests; valid rotations work. A changed/ambiguous reference
  -- also suppresses requests until the job is explicitly reconfigured.
  worker_command := format($command$
    select net.http_post(
      url := %L,
      body := '{}'::jsonb,
      params := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', secret.value),
      timeout_milliseconds := 2000
    )
    from (
      select min(decrypted_secret) as value from vault.decrypted_secrets
      where name = 'video_worker_secret'
      having count(*) = 1 and min(decrypted_secret) is not null and min(decrypted_secret) collate "C" ~ '^[!-~]+$'
    ) secret,
    (
      select min(decrypted_secret) as value from vault.decrypted_secrets
      where name = 'video_worker_staging_project_ref'
      having count(*) = 1 and min(decrypted_secret) = %L
    ) target
    where %L <> 'local-test-stub' or (
      current_database() ~ '^prismatix_video_worker_cron_[a-z0-9]+_test$'
      and current_setting('prismatix.video_worker_test_stub', true) = 'on'
      and exists (
        select 1 from pg_catalog.pg_proc
        where oid = to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)')
          and strpos(prosrc, 'prismatix_inert_net_http_post_test_only') > 0
      )
    );
  $command$, worker_url, staging_ref, staging_ref);
  -- pg_cron upserts named jobs per owner across databases. Refuse to overwrite
  -- this owner's matching job elsewhere; an exception rolls back cleanup too.
  if exists (select 1 from cron.job where jobname = 'video_worker_every_minute'
             and username = current_user and database is distinct from current_database()) then
    raise exception 'Video worker job name collides with this owner in another database';
  end if;
  perform cron.schedule('video_worker_every_minute', '* * * * *', worker_command);
end
$migration$;
