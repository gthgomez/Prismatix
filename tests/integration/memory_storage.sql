-- Run after migration inside a transaction; fixtures and DDL roll back.
do $$
declare a uuid=gen_random_uuid(); b uuid=gen_random_uuid(); conv uuid=gen_random_uuid(); msg uuid=gen_random_uuid(); msg2 uuid=gen_random_uuid(); item uuid; job uuid; claimed jsonb; payload jsonb; cursor_before uuid;
begin
 insert into auth.users(id) values(a),(b);
 insert into prismatix_internal.access_grants(subject_id,enabled,allowed_features,max_daily_usd,max_per_execution_usd) values(a,true,array['chat','memory'],1,.1),(b,true,array['chat','memory'],1,.1);
 insert into public.conversations(id,user_id) values(conv,a);
 insert into public.messages(id,conversation_id,role,content,created_at) values(msg,conv,'user','I prefer café and concise answers.','2026-10-10T00:00:00Z'),(msg2,conv,'assistant','Acknowledged.','2026-10-10T00:00:00Z');
 insert into public.memory_items(user_id,kind,text,basis,created_at,updated_at) values(a,'preference','Ancient durable café preference','manual','2020-01-01','2020-01-01') returning id into item;
 insert into public.memory_items(user_id,kind,text,basis) select a,'fact','Recent unrelated item '||i,'manual' from generate_series(1,33) i;
 if jsonb_array_length(public.memory_search(a,'café',8))<>1 then raise exception 'old Unicode retrieval failed'; end if;
 if public.memory_search(a,'no-matching-zebra',8)<>'[]'::jsonb then raise exception 'irrelevant fallback'; end if;
 if public.memory_read(b,array[item])<>'[]'::jsonb then raise exception 'cross-owner recall'; end if;
 insert into public.memory_items(user_id,kind,text,basis) values(b,'fact','Other account private fact','manual');
 perform set_config('request.jwt.claim.sub',a::text,true);
 execute 'set local role authenticated';
 if exists(select 1 from public.memory_items where user_id=b) then raise exception 'RLS leaked another owner'; end if;
 execute 'reset role';
 if has_function_privilege('authenticated','public.memory_search(uuid,text,integer)','execute') then raise exception 'client subject RPC bypass'; end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename='conversation_memory_state' and cmd in ('INSERT','UPDATE','DELETE')) then raise exception 'cursor writable'; end if;
 job=public.memory_enqueue(a,conv);
 claimed=public.memory_claim(a);
 if claimed is null or jsonb_array_length(claimed->'messages')<>2 then raise exception 'claim tie window failed'; end if;
 if public.memory_claim(a) is not null then raise exception 'concurrent lease'; end if;
 -- Invalid write must roll back without advancing cursor.
 begin
 perform public.memory_complete(a,job,(claimed->>'lease_token')::uuid,(claimed->>'window_end_id')::uuid,jsonb_build_array(jsonb_build_object('source_message_id',msg2,'kind','fact','text','Acknowledged.')));
 raise exception 'assistant claim accepted';
 exception when raise_exception then
 if sqlerrm='assistant claim accepted' then raise; end if;
 end;
 if exists(select 1 from prismatix_internal.memory_jobs where id=job and cursor_id is not null) then raise exception 'failed save advanced cursor'; end if;
 perform public.memory_complete(a,job,(claimed->>'lease_token')::uuid,(claimed->>'window_end_id')::uuid,jsonb_build_array(jsonb_build_object('source_message_id',msg,'kind','preference','text','I prefer café and concise answers.')));
 payload=public.memory_search(a,'concise',8);
 if jsonb_array_length(payload)<>1 or jsonb_array_length(payload->0->'sources')<>1 then raise exception 'fact/source commit failed'; end if;
 item=(payload->0->>'id')::uuid;
 perform public.memory_control(a,'forget',item);
 if public.memory_search(a,'concise',8)<>'[]'::jsonb then raise exception 'forget failed'; end if;
 if not exists(select 1 from prismatix_internal.memory_suppressed_sources where user_id=a and message_id=msg) then raise exception 'forget suppression missing'; end if;
 begin
 perform public.memory_control(b,'correct',item,'replacement');
 raise exception 'cross-owner correction accepted';
 exception when no_data_found then null;
 end;
 -- Deleting last source forgets a derived item; manual facts stay independent.
 insert into public.memory_items(user_id,kind,text,basis) values(a,'fact','A sourced project fact','user_statement') returning id into item;
 insert into public.memory_sources(item_id,user_id,conversation_id,message_id) values(item,a,conv,msg);
 delete from public.conversations where id=conv;
 if (select state from public.memory_items where id=item)<>'forgotten' then raise exception 'source deletion retention'; end if;
 perform public.memory_control(a,'settings',null,null,false);
 if public.memory_search(a,'café',8)<>'[]'::jsonb then raise exception 'pause recall failed'; end if;
end $$;
select 'memory_storage_assertions_passed' as result;
