-- Quarantine (disable) the unsafe video-worker cron job.
--
-- OPERATOR PROCEDURE -- NOT A MIGRATION. Never place this in supabase/migrations/.
--
-- Why this is not a migration: migrations must replay cleanly on an empty
-- database and run unattended through `supabase db push`. This operation
-- mutates a live scheduler and must be a deliberate, authorized act with an
-- operator present. An earlier revision shipped it as a migration gated on a
-- session GUC (`prismatix.video_worker_quarantined`), which `db push` can never
-- set -- so it failed on every existing installation and wedged all later
-- migrations behind it. Reproduced 2026-11-22.
--
-- PRECONDITIONS (verify all before running):
--   1. You have independently confirmed which Supabase project you are
--      connected to. This script cannot prove project identity.
--   2. You have announced/approved the resulting video-processing interruption.
--   3. You have recorded pg_net queue depth and the current invocation count so
--      you can recognize work still in flight. Deleting a cron row stops FUTURE
--      ticks; it cannot recall a request already handed to pg_net.
--
-- PRIVILEGES: this script needs DELETE on cron.job (or table ownership). It also
-- takes SHARE ROW EXCLUSIVE, which needs MAINTAIN/UPDATE/DELETE/TRUNCATE or
-- ownership. A role holding SELECT only fails with 42501 -- measured on
-- PostgreSQL 17. If you lack these privileges, use Dashboard -> Integrations ->
-- Cron to delete the job instead. Do NOT grant yourself extra privileges.
--
-- SAFETY: this script deliberately does NOT use a session-GUC intent flag. Intent
-- is expressed by choosing to run it. It refuses to report success unless the
-- postcondition actually holds.

do $quarantine$
declare
  remaining bigint;
  removed   bigint := 0;
  victim    record;
begin
  -- Fail fast if pg_cron is not installed. Nothing to do, nothing to claim.
  if to_regclass('cron.job') is null then
    raise notice 'quarantine: pg_cron is not installed; no video-worker job can exist.';
    return;
  end if;

  -- RLS hides rows the caller may not see. Under a restricted role this would
  -- make the removal loop a no-op and let us falsely report success. Refuse.
  if row_security_active('cron.job'::regclass) then
    raise exception
      'quarantine: cron.job RLS is active for this role, so jobs owned by others are hidden. '
      'Run as a role with full visibility (owner or BYPASSRLS), or use Dashboard -> Cron.'
      using errcode = '42501';
  end if;

  -- Exclude concurrent scheduler writes for the life of this transaction.
  -- If the privilege is missing this raises 42501 rather than guessing.
  begin
    lock table cron.job in share row exclusive mode nowait;
  exception
    when lock_not_available then
      raise exception 'quarantine: cron.job is busy; retry once the competing write finishes.';
  end;

  -- Remove every matching job in THIS database by id. A migration cannot see
  -- other databases; neither can this. Handle those separately.
  for victim in
    select jobid, username
      from cron.job
     where jobname = 'video_worker_every_minute'
       and database = current_database()
  loop
    if cron.unschedule(victim.jobid) is distinct from true then
      raise exception 'quarantine: could not unschedule job % (owner %)',
        victim.jobid, victim.username;
    end if;
    removed := removed + 1;
    raise notice 'quarantine: unscheduled job % owned by %', victim.jobid, victim.username;
  end loop;

  -- Postcondition. Do not trust the loop's own accounting.
  select count(*) into remaining
    from cron.job
   where jobname = 'video_worker_every_minute'
     and database = current_database();

  if remaining <> 0 then
    raise exception 'quarantine: % matching job(s) still present; cleanup incomplete', remaining;
  end if;

  raise notice 'quarantine: complete; removed % job(s); 0 remain in database %',
    removed, current_database();
end
$quarantine$;

-- VERIFY AFTER RUNNING, in a fresh session (do not rely on the notice above):
--
--   select count(*) from cron.job where jobname = 'video_worker_every_minute';
--     -- expect 0
--
--   select count(*) from cron.job_run_details
--    where jobid not in (select jobid from cron.job)
--      and status in ('starting','connecting','sending','running')
--      and start_time > now() - interval '5 minutes';
--     -- confirm no runs begin after the recorded cut-off timestamp
--
-- Then watch one full minute boundary and confirm no further invocations.
