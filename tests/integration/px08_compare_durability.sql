-- PX08: owner-scoped, idempotent durable Compare aggregation.
-- Run against a local Supabase DB after `supabase db reset`; transaction rolls back.
\set ON_ERROR_STOP on
begin;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); other_exec uuid := gen_random_uuid();
  compare_identity constant uuid := '33333333-3333-4333-8333-333333333333';
  result1 jsonb; result2 jsonb; preference jsonb;
  reloaded jsonb;
begin
  insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
  values (u1, 'authenticated', 'authenticated', u1 || '@example.invalid', 'unused', now(), now()),
         (u2, 'authenticated', 'authenticated', u2 || '@example.invalid', 'unused', now(), now());
  insert into public.conversations(id, user_id) values (c1, u1), (c2, u2);

  insert into prismatix_internal.executions(id, subject_id, conversation_id, client_request_key, payload_hash, status, requested_mode, requested_model, served_model)
  values (a, u1, c1, 'px08-a', 'a', 'completed', 'compare:' || compare_identity, 'model-a', 'model-a'),
         (b, u1, c1, 'px08-b', 'b', 'failed', 'compare:' || compare_identity, 'model-b', 'model-b'),
         (c, u1, c1, 'px08-c', 'c', 'failed', 'compare:' || compare_identity, 'model-c', 'model-c'),
         (other_exec, u2, c2, 'px08-other', 'd', 'completed', 'chat', 'model-x', 'model-x');
  insert into public.messages(conversation_id, role, content, execution_id, model_used)
  values (c1, 'assistant', 'authentic A answer', a, 'model-a');
  insert into prismatix_internal.model_calls(execution_id, stage, participant, total_cost, cost_status)
  values (a, 'primary', 'model-a', 0.0123, 'settled');

  perform set_config('request.jwt.claim.sub', u1::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  result1 := public.px08_persist_compare(c1, a, b);
  result2 := public.px08_persist_compare(c1, b, a);
  if result1->>'id' is distinct from result2->>'id' then raise exception 'PX08 replay was not idempotent'; end if;
  if result2#>>'{modelA,executionId}' <> a::text or result2#>>'{modelB,executionId}' <> b::text then
    raise exception 'PX08 replay changed the durable side ordering: %', result2;
  end if;
  if result1#>>'{modelA,content}' <> 'authentic A answer' or result1#>>'{modelA,cost}' <> '0.012300' then
    raise exception 'PX08 did not derive transcript and cost from server records: %', result1;
  end if;
  if result1#>>'{modelB,status}' <> 'failed' or result1#>>'{modelB,transcriptSaved}' <> 'false' then
    raise exception 'PX08 failure status was not preserved: %', result1;
  end if;
  preference := public.px08_set_compare_preference((result1->>'id')::uuid, 'A');
  if preference->>'preferredSide' <> 'A' then raise exception 'PX08 preference write did not select A'; end if;
  begin
    perform public.px08_persist_compare(c1, a, c);
    raise exception 'PX08 accepted a third execution for one logical Compare request';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.px08_persist_compare(c1, a, other_exec);
    raise exception 'PX08 accepted a foreign execution';
  exception when insufficient_privilege then null;
  end;
  reloaded := public.px08_get_compare_groups(c1, array[b]);
  if jsonb_array_length(reloaded) <> 1
     or reloaded->0->>'id' is distinct from result1->>'id'
     or reloaded->0->>'preferredSide' <> 'A' then
    raise exception 'PX08 did not return the complete group on a page with one child';
  end if;
  perform public.px08_set_compare_preference((result1->>'id')::uuid, 'B');
  preference := public.px08_set_compare_preference((result1->>'id')::uuid, null);
  if preference->>'preferredSide' is not null then raise exception 'PX08 preference clear did not clear the vote'; end if;
  if public.px08_get_compare_groups(c1, array[c]) <> '[]'::jsonb then
    raise exception 'PX08 returned a group outside the requested page';
  end if;
  begin
    update public.messages set content = 'unauthorized fixture mutation' where execution_id = a;
    raise exception 'The client could rewrite assistant content';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.compare_groups(user_id, conversation_id, execution_a, execution_b, compare_identity)
    values (u1, c1, b, c, gen_random_uuid());
    raise exception 'The client could insert a Compare group directly';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  update prismatix_internal.executions set status = 'cancelled' where id = b;
  insert into prismatix_internal.model_calls(execution_id, stage, participant, total_cost, cost_status)
  values (b, 'primary', 'model-b', 0.0234, 'pending');
  execute 'set local role authenticated';
  reloaded := public.px08_get_compare_groups(c1, array[a])->0;
  if reloaded#>>'{modelB,status}' <> 'stopped' or reloaded#>>'{modelB,costStatus}' <> 'pending' then
    raise exception 'PX08 did not reflect the updated server receipt';
  end if;
  execute 'reset role';
  update prismatix_internal.model_calls set cost_status = 'estimated_legacy' where execution_id = b;
  execute 'set local role authenticated';
  reloaded := public.px08_get_compare_groups(c1, array[a])->0;
  if reloaded#>>'{modelB,costStatus}' <> 'estimated' then
    raise exception 'PX08 did not preserve legacy estimate provenance';
  end if;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  if exists (select 1 from public.compare_groups where conversation_id = c1) then
    raise exception 'Direct read bypassed owner RLS';
  end if;
  begin
    perform public.px08_get_compare_groups(c1, array[a, b]);
    raise exception 'PX08 exposed another owner conversation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.px08_set_compare_preference((result1->>'id')::uuid, 'A');
    raise exception 'PX08 allowed another owner to change a preference';
  exception when insufficient_privilege then null;
  end;
  execute 'set local role anon';
  begin
    perform public.px08_get_compare_groups(c1, array[a]);
    raise exception 'Anonymous role executed the Compare RPC';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
