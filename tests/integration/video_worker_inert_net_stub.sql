create or replace function net.http_post(url text, body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 1000)
returns bigint language plpgsql as $$
begin
  -- prismatix_inert_net_http_post_test_only
  if url not in ('http://127.0.0.1:54321/functions/v1/video-worker',
                 'https://00000000000000000000.supabase.co/functions/v1/video-worker') then
    raise exception 'test stub rejected unapproved synthetic destination';
  end if;
  if timeout_milliseconds <> 2000 or params <> '{}'::jsonb or body <> '{}'::jsonb then
    raise exception 'scheduled call used unexpected pg_net arguments';
  end if;
  -- Record the requested value, but route every test call solely to this inert
  -- local SQL recorder. This function has no network-capable operation.
  insert into net.requests values ('http://127.0.0.1:54321/functions/v1/video-worker', url, headers, body);
  return 1;
end $$;
