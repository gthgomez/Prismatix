-- Repair live FK drift to the repository's declared chat deletion contract.
alter table public.messages drop constraint messages_conversation_id_fkey;
alter table public.messages add constraint messages_conversation_id_fkey foreign key(conversation_id) references public.conversations(id) on delete cascade;
-- Reliable memory: additive evidence/index/job storage; old summaries preserved.
create table public.memory_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default true,
 forget_on_chat_delete boolean not null default true,
 updated_at timestamptz not null default now()
);
create table public.memory_items (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('preference','fact','project','constraint','legacy')),
 text text not null check(length(text) between 3 and 1200),
 basis text not null check(basis in ('user_statement','manual','legacy')),
 state text not null default 'active' check(state in ('active','superseded','forgotten')),
 supersedes_id uuid references public.memory_items(id) on delete set null,
 expires_at timestamptz,
 fingerprint text generated always as (md5(lower(regexp_replace(text, '\s+', ' ', 'g')))) stored,
 search_vector tsvector generated always as (to_tsvector('simple'::regconfig,text)) stored,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,user_id), unique(user_id,fingerprint)
);
create index memory_owner_active_idx on public.memory_items(user_id,updated_at desc,id desc) where state='active';
create index memory_search_idx on public.memory_items using gin(search_vector) where state='active';
create unique index if not exists conversations_id_owner_uniq on public.conversations(id,user_id);
create unique index if not exists messages_id_conversation_uniq on public.messages(id,conversation_id);
create table public.memory_sources (
 item_id uuid not null,
 user_id uuid not null,
 conversation_id uuid not null,
 message_id uuid,
 legacy_memory_id uuid references public.user_memories(id) on delete cascade,
 foreign key(item_id,user_id) references public.memory_items(id,user_id) on delete cascade,
 foreign key(conversation_id,user_id) references public.conversations(id,user_id) on delete cascade,
 foreign key(message_id,conversation_id) references public.messages(id,conversation_id) on delete cascade,
 check(message_id is not null or legacy_memory_id is not null)
);
create unique index memory_source_message_uniq on public.memory_sources(item_id,message_id) where message_id is not null;
create unique index memory_source_legacy_uniq on public.memory_sources(item_id,legacy_memory_id) where legacy_memory_id is not null;
create index memory_source_owner_idx on public.memory_sources(user_id,conversation_id);
create table prismatix_internal.memory_suppressed_sources (
 user_id uuid not null references auth.users(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 primary key(user_id,message_id)
);
create table prismatix_internal.memory_jobs (
 id uuid primary key default gen_random_uuid(),
 subject_id uuid not null,
 conversation_id uuid not null unique,
 state text not null default 'queued' check(state in ('queued','running','idle','deferred','failed')),
 attempts integer not null default 0,
 cursor_at timestamptz,
 cursor_id uuid,
 through_at timestamptz not null,
 through_id uuid not null,
 lease_token uuid,
 lease_until timestamptz,
 error_code text,
 updated_at timestamptz not null default now(),
 foreign key(conversation_id,subject_id) references public.conversations(id,user_id) on delete cascade
);
create index memory_jobs_claim_idx on prismatix_internal.memory_jobs(subject_id,updated_at) where state in ('queued','deferred','running');

alter table public.memory_settings enable row level security;
alter table public.memory_items enable row level security;
alter table public.memory_sources enable row level security;
alter table prismatix_internal.memory_jobs enable row level security;
alter table prismatix_internal.memory_suppressed_sources enable row level security;
create policy memory_settings_read_own on public.memory_settings for select to authenticated using((select auth.uid())=user_id);
create policy memory_items_read_own on public.memory_items for select to authenticated using((select auth.uid())=user_id);
create policy memory_sources_read_own on public.memory_sources for select to authenticated using((select auth.uid())=user_id);
revoke all on public.memory_items, public.memory_sources, public.memory_settings from anon,authenticated;
grant select on public.memory_items,public.memory_sources,public.memory_settings to authenticated;
grant all on public.memory_items,public.memory_sources,public.memory_settings,prismatix_internal.memory_jobs,prismatix_internal.memory_suppressed_sources to service_role;
drop policy if exists conversation_memory_state_insert_own on public.conversation_memory_state;
drop policy if exists conversation_memory_state_update_own on public.conversation_memory_state;
drop policy if exists conversation_memory_state_delete_own on public.conversation_memory_state;

-- Legacy summaries become labelled searchable records; originals remain untouched.
insert into public.memory_items(user_id,kind,text,basis,created_at,updated_at)
select user_id,'legacy',left(summary_text,1200),'legacy',created_at,created_at
from public.user_memories where length(summary_text)>=3 on conflict(user_id,fingerprint) do nothing;
insert into public.memory_sources(item_id,user_id,conversation_id,legacy_memory_id)
select i.id,m.user_id,m.conversation_id,m.id from public.user_memories m
join public.memory_items i on i.user_id=m.user_id and i.fingerprint=md5(lower(regexp_replace(left(m.summary_text,1200),'\s+',' ','g')))
join public.conversations c on c.id=m.conversation_id and c.user_id=m.user_id
on conflict do nothing;

create function public.memory_allowed(p_subject_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from prismatix_internal.access_grants g where g.subject_id=p_subject_id and g.enabled and 'memory'=any(g.allowed_features))
 and coalesce((select enabled from public.memory_settings where user_id=p_subject_id),true)
$$;

create function public.memory_payload(p_item public.memory_items) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_item.id,'text',p_item.text,'kind',p_item.kind,'basis',p_item.basis,'state',p_item.state,
 'created_at',p_item.created_at,'updated_at',p_item.updated_at,'expires_at',p_item.expires_at,
 'sources',coalesce((select jsonb_agg(jsonb_build_object('conversation_id',s.conversation_id,'message_id',s.message_id)) from public.memory_sources s where s.item_id=p_item.id and s.user_id=p_item.user_id),'[]'::jsonb))
$$;

create function public.memory_search(p_subject_id uuid,p_query text,p_limit integer default 8) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(public.memory_payload(x)),'[]'::jsonb) from (
 select i.* from public.memory_items i where public.memory_allowed(p_subject_id) and i.user_id=p_subject_id and i.state='active'
 and (i.expires_at is null or i.expires_at>now()) and i.search_vector @@ websearch_to_tsquery('simple'::regconfig,left(p_query,512))
 order by ts_rank(i.search_vector,websearch_to_tsquery('simple'::regconfig,left(p_query,512))) desc,
 (i.basis<>'legacy') desc,i.updated_at desc,i.id desc limit greatest(1,least(p_limit,8))
 ) x
$$;

create function public.memory_read(p_subject_id uuid,p_ids uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(public.memory_payload(i)),'[]'::jsonb) from public.memory_items i
 where public.memory_allowed(p_subject_id) and i.user_id=p_subject_id and i.id=any(p_ids[1:8])
 and i.state='active' and (i.expires_at is null or i.expires_at>now())
$$;

create function public.memory_status(p_subject_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('entitled',exists(select 1 from prismatix_internal.access_grants g where g.subject_id=p_subject_id and g.enabled and 'memory'=any(g.allowed_features)),
 'enabled',public.memory_allowed(p_subject_id),'setting_enabled',coalesce(s.enabled,true),
 'forget_on_chat_delete',coalesce(s.forget_on_chat_delete,true),
 'count',(select count(*) from public.memory_items i where i.user_id=p_subject_id and i.state='active' and(i.expires_at is null or i.expires_at>now())),
 'last_saved_at',(select max(updated_at) from public.memory_items where user_id=p_subject_id),
 'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'state',j.state,'attempts',j.attempts,'error_code',j.error_code)) from prismatix_internal.memory_jobs j where j.subject_id=p_subject_id and j.state<>'idle'),'[]'::jsonb))
 from (select 1) anchor left join public.memory_settings s on s.user_id=p_subject_id
$$;

create function public.memory_list(p_subject_id uuid,p_before timestamptz default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(public.memory_payload(x)),'[]'::jsonb) from (
 select i.* from public.memory_items i where i.user_id=p_subject_id and i.state='active'
 and(i.expires_at is null or i.expires_at>now()) and(p_before is null or i.updated_at<p_before)
 order by i.updated_at desc,i.id desc limit 50) x
$$;

create function public.memory_control(p_subject_id uuid,p_action text,p_item_id uuid default null,p_text text default null,p_enabled boolean default null,p_forget_on_chat_delete boolean default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old_item public.memory_items; new_id uuid;
begin
 if p_action='settings' then
 insert into public.memory_settings(user_id,enabled,forget_on_chat_delete) values(p_subject_id,coalesce(p_enabled,true),coalesce(p_forget_on_chat_delete,true))
 on conflict(user_id) do update set enabled=coalesce(p_enabled,memory_settings.enabled),forget_on_chat_delete=coalesce(p_forget_on_chat_delete,memory_settings.forget_on_chat_delete),updated_at=now();
 return public.memory_status(p_subject_id);
 end if;
 if p_action='retry' then
 update prismatix_internal.memory_jobs set state='queued',attempts=0,error_code=null,updated_at=now() where subject_id=p_subject_id and state in ('failed','deferred');
 return public.memory_status(p_subject_id);
 end if;
 if p_action in ('forget','correct') then
 select * into old_item from public.memory_items where id=p_item_id and user_id=p_subject_id for update;
 if not found then raise exception 'memory_not_found' using errcode='P0002'; end if;
 insert into prismatix_internal.memory_suppressed_sources(user_id,message_id)
 select user_id,message_id from public.memory_sources where item_id=p_item_id and message_id is not null on conflict do nothing;
 update public.memory_items set state=case when p_action='correct' then 'superseded' else 'forgotten' end,updated_at=now() where id=p_item_id;
 if p_action='forget' then return jsonb_build_object('ok',true); end if;
 end if;
 if p_action not in ('remember','correct') or length(trim(p_text)) not between 3 and 500 then raise exception 'invalid_memory_action'; end if;
 if not public.memory_allowed(p_subject_id) then raise exception 'memory_not_enabled' using errcode='42501'; end if;
 insert into public.memory_items(user_id,kind,text,basis,supersedes_id)
 values(p_subject_id,'fact',trim(p_text),'manual',case when p_action='correct' then p_item_id end)
 on conflict(user_id,fingerprint) do update set state='active',basis='manual',updated_at=now() returning id into new_id;
 return (select public.memory_payload(i) from public.memory_items i where i.id=new_id);
end $$;

-- Last-source deletion defaults to forgetting, but the owner may retain memory.
create function public.memory_source_deleted() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if coalesce((select forget_on_chat_delete from public.memory_settings where user_id=old.user_id),true)
 and not exists(select 1 from public.memory_sources where item_id=old.item_id) then
 update public.memory_items set state='forgotten',updated_at=now() where id=old.item_id and state='active' and basis<>'manual';
 end if;
 return old;
end $$;
create trigger memory_source_delete after delete on public.memory_sources for each row execute function public.memory_source_deleted();

create function public.memory_enqueue(p_subject_id uuid,p_conversation_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare last_row public.messages; job_id uuid;
begin
 if not public.memory_allowed(p_subject_id) then return null; end if;
 perform 1 from public.conversations where id=p_conversation_id and user_id=p_subject_id for share;
 if not found then raise exception 'memory_owner_mismatch' using errcode='42501'; end if;
 select * into last_row from public.messages where conversation_id=p_conversation_id order by created_at desc,id desc limit 1;
 if not found then return null; end if;
 insert into prismatix_internal.memory_jobs(subject_id,conversation_id,through_at,through_id)
 values(p_subject_id,p_conversation_id,last_row.created_at,last_row.id)
 on conflict(conversation_id) do update set through_at=excluded.through_at,through_id=excluded.through_id,
 state=case when memory_jobs.state='idle' then 'queued' else memory_jobs.state end,updated_at=now() returning id into job_id;
 return job_id;
end $$;

create function public.memory_claim(p_subject_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job prismatix_internal.memory_jobs; rows jsonb; end_at timestamptz; end_id uuid;
begin
 if not public.memory_allowed(p_subject_id) then return null; end if;
 select * into job from prismatix_internal.memory_jobs where subject_id=p_subject_id and attempts<3
 and (state in ('queued','deferred') or (state='running' and lease_until<now()))
 order by updated_at,id for update skip locked limit 1;
 if not found then return null; end if;
 select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) into rows from (
 select id,role,left(content,2000) as content,created_at from public.messages
 where conversation_id=job.conversation_id and (job.cursor_at is null or (created_at,id)>(job.cursor_at,job.cursor_id))
 and (created_at,id)<=(job.through_at,job.through_id)
 order by created_at,id limit 12) x;
 if rows is null then
 update prismatix_internal.memory_jobs set state='idle',error_code=null,attempts=0 where id=job.id;
 return null;
 end if;
 end_at=(rows->-1->>'created_at')::timestamptz; end_id=(rows->-1->>'id')::uuid;
 update prismatix_internal.memory_jobs set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',attempts=attempts+1,updated_at=now()
 where id=job.id returning * into job;
 return to_jsonb(job)||jsonb_build_object('messages',rows,'window_end_at',end_at,'window_end_id',end_id);
end $$;

create function public.memory_complete(p_subject_id uuid,p_job_id uuid,p_lease_token uuid,p_end_id uuid,p_facts jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job prismatix_internal.memory_jobs; source public.messages; finish public.messages; fact jsonb; item_id uuid; saved integer=0;
begin
 select * into job from prismatix_internal.memory_jobs where id=p_job_id and subject_id=p_subject_id and state='running' and lease_token=p_lease_token and lease_until>now() for update;
 if not found then raise exception 'memory_lease_lost'; end if;
 if not public.memory_allowed(p_subject_id) then raise exception 'memory_not_enabled' using errcode='42501'; end if;
 perform 1 from public.conversations where id=job.conversation_id and user_id=p_subject_id for share;
 if not found then raise exception 'memory_source_deleted'; end if;
 select * into finish from public.messages where id=p_end_id and conversation_id=job.conversation_id;
 if not found or (finish.created_at,finish.id)>(job.through_at,job.through_id) or (job.cursor_at is not null and (finish.created_at,finish.id)<=(job.cursor_at,job.cursor_id)) then raise exception 'memory_invalid_cursor'; end if;
 if jsonb_typeof(p_facts)<>'array' or jsonb_array_length(p_facts)>8 then raise exception 'invalid_memory_facts'; end if;
 for fact in select value from jsonb_array_elements(p_facts) loop
 select * into source from public.messages where id=(fact->>'source_message_id')::uuid and conversation_id=job.conversation_id and role='user';
 if not found or length(fact->>'text') not between 3 and 500 or strpos(source.content,fact->>'text')=0
 or (source.created_at,source.id)>(finish.created_at,finish.id)
 or (job.cursor_at is not null and (source.created_at,source.id)<=(job.cursor_at,job.cursor_id))
 or fact->>'kind' not in ('preference','fact','project','constraint') then raise exception 'ungrounded_memory_fact'; end if;
 if exists(select 1 from prismatix_internal.memory_suppressed_sources where user_id=p_subject_id and message_id=source.id) then continue; end if;
 insert into public.memory_items(user_id,kind,text,basis) values(p_subject_id,fact->>'kind',fact->>'text','user_statement')
 on conflict(user_id,fingerprint) do nothing;
 select id into item_id from public.memory_items where user_id=p_subject_id and fingerprint=md5(lower(regexp_replace(fact->>'text','\s+',' ','g'))) and state='active';
 if item_id is not null then
 insert into public.memory_sources(item_id,user_id,conversation_id,message_id) values(item_id,p_subject_id,job.conversation_id,source.id) on conflict do nothing;
 saved=saved+1;
 end if;
 end loop;
 update prismatix_internal.memory_jobs set cursor_at=finish.created_at,cursor_id=finish.id,
 state=case when (finish.created_at,finish.id)<(through_at,through_id) then 'queued' else 'idle' end,
 attempts=0,error_code=null,lease_token=null,lease_until=null,updated_at=now() where id=job.id;
 return jsonb_build_object('saved',saved);
end $$;

create function public.memory_fail(p_subject_id uuid,p_job_id uuid,p_lease_token uuid,p_error text,p_deferred boolean default false) returns void
language sql security definer set search_path='' as $$
 update prismatix_internal.memory_jobs set state=case when p_deferred then 'deferred' when attempts>=3 then 'failed' else 'queued' end,
 error_code=left(p_error,80),lease_token=null,lease_until=null,attempts=case when p_deferred then greatest(0,attempts-1) else attempts end,updated_at=now()
 where subject_id=p_subject_id and id=p_job_id and lease_token=p_lease_token and state='running'
$$;

-- Every subject-param RPC is service-role-only; the Edge Function supplies validated identity.
do $$
declare f record;
begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'memory_%' loop
 execute format('revoke all on function %s from public, anon, authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
