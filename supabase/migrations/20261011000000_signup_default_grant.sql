-- Signup default grant (owner decision 2026-10-11): signups are open, so a new
-- user must be able to use the product they signed up for. PX01's fail-closed
-- access_grants previously required a manual service_role insert per user,
-- which made every self-serve signup hit "not_entitled" on first chat.
-- Default grant stays conservative: user role, bounded spend, no admin/video.
create or replace function prismatix_internal.grant_default_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public, prismatix_internal
as $$
begin
  insert into prismatix_internal.access_grants (
    subject_id, role, enabled, allowed_features,
    max_daily_usd, max_per_execution_usd, updated_by
  )
  values (
    new.id, 'user', true, array['chat', 'review', 'memory']::text[],
    0.50, 0.10, null
  )
  on conflict (subject_id) do nothing;
  return new;
end;
$$;

revoke all on function prismatix_internal.grant_default_on_signup() from public;
revoke all on function prismatix_internal.grant_default_on_signup() from anon;
revoke all on function prismatix_internal.grant_default_on_signup() from authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function prismatix_internal.grant_default_on_signup();
