-- PX01 follow-up: the video-worker cron must authenticate with x-worker-secret.
--
-- The deployed video-worker denies any request without the VIDEO_WORKER_SECRET
-- header (fail closed), so the headerless cron definition from
-- 20260216103000_schedule_video_worker_cron.sql can never process a job. The
-- secret VALUE never lives in migrations or in cron.job command text: operators
-- store it once in Supabase Vault under the name below (and in platform secrets
-- as VIDEO_WORKER_SECRET for the function runtime), and this migration wires
-- the cron to read it at fire time.
--
-- Operator setup (out of band, once per environment):
--   supabase secrets set VIDEO_WORKER_SECRET=<long random hex>
--   supabase db query --linked \
--     "select vault.create_secret('<same value>', 'video_worker_secret', 'video-worker auth')"
--
-- Idempotent: safe to re-run; matches the definition already deployed to
-- production on 2026-10-06.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'video_worker_every_minute') then
    perform cron.unschedule('video_worker_every_minute');
  end if;
end $$;

select cron.schedule(
  'video_worker_every_minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://sqjfbqjogylkfwzsyprd.supabase.co/functions/v1/video-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'video_worker_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
