-- Phase 1: versioned official knowledge, standardized abilities, and persistent AI chat.
create extension if not exists vector with schema extensions;

create table public.official_documents (
  id uuid primary key default gen_random_uuid(),
  document_key text not null unique check (document_key ~ '^[a-z0-9][a-z0-9_-]{2,119}$'),
  game_id uuid references public.games(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  document_type text not null check (document_type in ('GAME_MASTER_RULESET','CHARACTER_ROLE_GUIDE','ABILITY_ENCYCLOPEDIA','ACTION_RESOLUTION_RULES','PLAYER_FAQ','CUSTOM')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((game_id is null and created_by is null) or (game_id is not null and created_by is not null))
);

create table public.official_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.official_documents(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null check (status in ('DRAFT','PROCESSING','APPROVED','ACTIVE','INACTIVE','SUPERSEDED','FAILED')),
  requested_status text not null default 'ACTIVE' check (requested_status in ('DRAFT','APPROVED','ACTIVE')),
  source_file_name text check (source_file_name is null or char_length(source_file_name) between 1 and 255),
  storage_path text unique check (storage_path is null or char_length(storage_path) between 1 and 700),
  content_type text check (content_type is null or content_type in ('application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf','text/plain')),
  file_size bigint check (file_size is null or file_size between 1 and 10485760),
  source_sha256 text not null default '' check (source_sha256 = '' or source_sha256 ~ '^[0-9a-f]{64}$'),
  extracted_text text not null default '' check (char_length(extracted_text) <= 2000000),
  summary text not null default '' check (char_length(summary) <= 4000),
  ingestion_error text not null default '' check (char_length(ingestion_error) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (document_id, version_number)
);

create table public.official_document_chunks (
  id bigint generated always as identity primary key,
  document_version_id uuid not null references public.official_document_versions(id) on delete cascade,
  game_id uuid references public.games(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  heading text not null default '' check (char_length(heading) <= 300),
  source_locator text not null default '' check (char_length(source_locator) <= 300),
  content text not null check (char_length(btrim(content)) between 1 and 12000),
  token_estimate integer not null default 0 check (token_estimate between 0 and 10000),
  embedding extensions.vector(1536),
  search_vector tsvector generated always as (to_tsvector('english', coalesce(heading,'') || ' ' || coalesce(content,''))) stored,
  created_at timestamptz not null default now(),
  unique (document_version_id, chunk_index)
);

create table public.standard_ability_datasets (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{2,119}$'),
  name text not null unique check (char_length(btrim(name)) between 1 and 200),
  game_key text not null check (game_key ~ '^[a-z0-9][a-z0-9_-]{2,79}$'),
  description text not null default '' check (char_length(description) <= 4000),
  source_document_version_id uuid references public.official_document_versions(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.standard_abilities (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_]{2,79}$'),
  dataset_id text not null references public.standard_ability_datasets(id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  category text not null check (category in ('Investigation','Harmful','Protection','Support')),
  sort_order integer not null check (sort_order between 1 and 10000),
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (dataset_id, sort_order),
  unique (dataset_id, display_name)
);

create table public.standard_ability_versions (
  id uuid primary key default gen_random_uuid(),
  ability_id text not null references public.standard_abilities(id) on delete restrict,
  game_id uuid references public.games(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null check (status in ('ACTIVE','INACTIVE','SUPERSEDED')),
  definition_status text not null check (definition_status in ('DEFINED','NEEDS_SOURCE_TEXT')),
  official_description text check (official_description is null or char_length(official_description) between 1 and 20000),
  structured_data jsonb not null default '{}'::jsonb check (jsonb_typeof(structured_data) = 'object'),
  source_document_version_id uuid references public.official_document_versions(id) on delete restrict,
  change_note text not null default '' check (char_length(change_note) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((definition_status = 'DEFINED' and official_description is not null) or definition_status = 'NEEDS_SOURCE_TEXT')
);

create unique index standard_ability_versions_scope_version_idx
  on public.standard_ability_versions (ability_id, coalesce(game_id, '00000000-0000-0000-0000-000000000000'::uuid), version_number);
create unique index standard_ability_versions_active_scope_idx
  on public.standard_ability_versions (ability_id, coalesce(game_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'ACTIVE';

create table public.game_ability_datasets (
  game_id uuid not null references public.games(id) on delete cascade,
  dataset_id text not null references public.standard_ability_datasets(id) on delete restrict,
  activated_by uuid not null references auth.users(id),
  activated_at timestamptz not null default now(),
  primary key (game_id, dataset_id)
);

create table public.role_ability_modifiers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  role_id text not null check (char_length(role_id) between 1 and 120),
  ability_id text not null references public.standard_abilities(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  status text not null check (status in ('ACTIVE','SUPERSEDED')),
  modifier_text text not null check (char_length(btrim(modifier_text)) between 1 and 4000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (game_id, role_id, ability_id, version_number)
);
create unique index role_ability_modifiers_active_idx on public.role_ability_modifiers(game_id, role_id, ability_id) where status = 'ACTIVE';

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  title text not null default 'GM Assistant' check (char_length(title) between 1 and 120),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index ai_conversations_one_active_idx on public.ai_conversations(game_id) where active;

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(btrim(content)) between 1 and 12000),
  structured_result jsonb check (structured_result is null or jsonb_typeof(structured_result) = 'object'),
  model text not null default '' check (char_length(model) <= 120),
  game_version integer check (game_version is null or game_version > 0),
  request_id uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index official_documents_game_idx on public.official_documents(game_id);
create index official_document_versions_document_created_idx on public.official_document_versions(document_id, created_at desc);
create index official_document_versions_active_idx on public.official_document_versions(document_id, version_number desc) where status = 'ACTIVE';
create index official_document_chunks_version_idx on public.official_document_chunks(document_version_id);
create index official_document_chunks_game_idx on public.official_document_chunks(game_id);
create index official_document_chunks_search_idx on public.official_document_chunks using gin(search_vector);
create index official_document_chunks_embedding_idx on public.official_document_chunks using hnsw (embedding extensions.vector_cosine_ops) where embedding is not null;
create index standard_abilities_dataset_idx on public.standard_abilities(dataset_id, sort_order);
create index standard_ability_versions_game_idx on public.standard_ability_versions(game_id, ability_id);
create index game_ability_datasets_dataset_idx on public.game_ability_datasets(dataset_id);
create index role_ability_modifiers_ability_idx on public.role_ability_modifiers(ability_id);
create index ai_conversations_game_created_idx on public.ai_conversations(game_id, created_at desc);
create index ai_messages_conversation_created_idx on public.ai_messages(conversation_id, created_at);
create index ai_messages_game_created_idx on public.ai_messages(game_id, created_at);

alter table public.official_documents enable row level security;
alter table public.official_document_versions enable row level security;
alter table public.official_document_chunks enable row level security;
alter table public.standard_ability_datasets enable row level security;
alter table public.standard_abilities enable row level security;
alter table public.standard_ability_versions enable row level security;
alter table public.game_ability_datasets enable row level security;
alter table public.role_ability_modifiers enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create policy official_documents_read on public.official_documents for select to authenticated
  using (game_id is null or (select public.is_game_member(game_id)));
create policy official_document_versions_read on public.official_document_versions for select to authenticated
  using (exists(select 1 from public.official_documents d where d.id = document_id and (d.game_id is null or (select public.is_game_member(d.game_id)))));
create policy official_document_chunks_read on public.official_document_chunks for select to authenticated
  using (game_id is null or (select public.is_game_member(game_id)));
create policy standard_ability_datasets_read on public.standard_ability_datasets for select to authenticated using (true);
create policy standard_abilities_read on public.standard_abilities for select to authenticated using (true);
create policy standard_ability_versions_read on public.standard_ability_versions for select to authenticated
  using (game_id is null or (select public.is_game_member(game_id)));
create policy game_ability_datasets_read on public.game_ability_datasets for select to authenticated
  using ((select public.is_game_member(game_id)));
create policy role_ability_modifiers_read on public.role_ability_modifiers for select to authenticated
  using ((select public.is_game_member(game_id)));
create policy ai_conversations_read on public.ai_conversations for select to authenticated
  using ((select public.is_game_member(game_id)));
create policy ai_messages_read on public.ai_messages for select to authenticated
  using ((select public.is_game_member(game_id)));

grant select on public.official_documents, public.official_document_versions, public.official_document_chunks,
  public.standard_ability_datasets, public.standard_abilities, public.standard_ability_versions,
  public.game_ability_datasets, public.role_ability_modifiers, public.ai_conversations, public.ai_messages to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('game-knowledge-documents','game-knowledge-documents',false,10485760,array[
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf','text/plain'
])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy knowledge_upload_own_game on storage.objects for insert to authenticated with check(
  bucket_id = 'game-knowledge-documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and (select public.can_edit_game(((storage.foldername(name))[2])::uuid))
  and lower(storage.extension(name)) in ('docx','pdf','txt')
);
create policy knowledge_read_game_member on storage.objects for select to authenticated using(
  bucket_id = 'game-knowledge-documents' and exists(
    select 1 from public.official_document_versions v
    join public.official_documents d on d.id = v.document_id
    where v.storage_path = name and d.game_id is not null and (select public.is_game_member(d.game_id))
  )
);
create policy knowledge_cleanup_unregistered on storage.objects for delete to authenticated using(
  bucket_id = 'game-knowledge-documents'
  and owner_id = (select auth.uid()::text)
  and not exists(select 1 from public.official_document_versions v where v.storage_path = name)
);

create or replace function public.create_knowledge_document(
  target_game_id uuid, target_document_id uuid, target_version_id uuid, target_document_key text,
  target_title text, target_document_type text, target_source_file_name text, target_storage_path text,
  target_file_size bigint, target_content_type text, target_source_sha256 text default '', target_status text default 'ACTIVE'
) returns table(document_id uuid, version_id uuid, version_number integer)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if target_document_id is null or target_version_id is null
    or target_document_key !~ '^[a-z0-9][a-z0-9_-]{2,119}$'
    or nullif(btrim(target_title),'') is null or char_length(target_title) > 200
    or target_document_type not in ('GAME_MASTER_RULESET','CHARACTER_ROLE_GUIDE','ABILITY_ENCYCLOPEDIA','ACTION_RESOLUTION_RULES','PLAYER_FAQ','CUSTOM')
    or target_status not in ('DRAFT','APPROVED','ACTIVE')
    or target_file_size not between 1 and 10485760
    or target_content_type not in ('application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf','text/plain')
    or split_part(target_storage_path,'/',1) <> auth.uid()::text
    or split_part(target_storage_path,'/',2) <> target_game_id::text
    or (coalesce(target_source_sha256,'') <> '' and target_source_sha256 !~ '^[0-9a-f]{64}$')
  then raise exception using errcode='22023',message='INVALID_DOCUMENT_METADATA'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='game-knowledge-documents' and o.name=target_storage_path and o.owner_id=auth.uid()::text)
  then raise exception using errcode='P0002',message='UPLOADED_DOCUMENT_NOT_FOUND'; end if;
  insert into public.official_documents(id,document_key,game_id,title,document_type,created_by)
  values(target_document_id,target_document_key,target_game_id,btrim(target_title),target_document_type,auth.uid());
  insert into public.official_document_versions(id,document_id,version_number,status,requested_status,source_file_name,storage_path,content_type,file_size,source_sha256,created_by)
  values(target_version_id,target_document_id,1,'PROCESSING',target_status,target_source_file_name,target_storage_path,target_content_type,target_file_size,coalesce(target_source_sha256,''),auth.uid());
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(target_game_id,auth.uid(),'knowledge',target_document_id::text,'Official document uploaded',jsonb_build_object('title',target_title,'type',target_document_type,'version',1));
  return query select target_document_id,target_version_id,1;
end $$;

create or replace function public.complete_knowledge_ingestion(target_version_id uuid, target_extracted_text text, target_summary text, target_chunks jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare target_document public.official_documents%rowtype; target_version public.official_document_versions%rowtype; chunk jsonb; chunk_number integer := 0;
begin
  select v.* into target_version from public.official_document_versions v where v.id=target_version_id for update;
  if not found then raise exception using errcode='P0002',message='DOCUMENT_VERSION_NOT_FOUND'; end if;
  select d.* into target_document from public.official_documents d where d.id=target_version.document_id;
  if target_document.game_id is null or not public.can_edit_game(target_document.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if target_version.status <> 'PROCESSING' then raise exception using errcode='22023',message='DOCUMENT_VERSION_NOT_PROCESSING'; end if;
  if jsonb_typeof(target_chunks) <> 'array' or jsonb_array_length(target_chunks) not between 1 and 200
    or char_length(coalesce(target_extracted_text,'')) > 2000000 or char_length(coalesce(target_summary,'')) > 4000
  then raise exception using errcode='22023',message='INVALID_INGESTION_RESULT'; end if;
  for chunk in select value from jsonb_array_elements(target_chunks) loop
    if nullif(btrim(chunk->>'content'),'') is null or char_length(chunk->>'content') > 12000
      or jsonb_typeof(chunk->'embedding') <> 'array' or jsonb_array_length(chunk->'embedding') <> 1536
    then raise exception using errcode='22023',message='INVALID_KNOWLEDGE_CHUNK'; end if;
    insert into public.official_document_chunks(document_version_id,game_id,chunk_index,heading,source_locator,content,token_estimate,embedding)
    values(target_version_id,target_document.game_id,chunk_number,left(coalesce(chunk->>'heading',''),300),left(coalesce(chunk->>'source_locator',''),300),chunk->>'content',least(10000,greatest(0,coalesce((chunk->>'token_estimate')::integer,0))),(chunk->'embedding')::text::extensions.vector);
    chunk_number := chunk_number + 1;
  end loop;
  if target_version.requested_status = 'ACTIVE' then
    update public.official_document_versions set status='SUPERSEDED'
    where document_id=target_document.id and id<>target_version_id and status='ACTIVE';
  end if;
  update public.official_document_versions set status=requested_status,extracted_text=coalesce(target_extracted_text,''),summary=coalesce(target_summary,''),
    approved_by=case when requested_status in ('APPROVED','ACTIVE') then auth.uid() else null end,completed_at=now()
  where id=target_version_id;
  update public.official_documents set updated_at=now() where id=target_document.id;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(target_document.game_id,auth.uid(),'knowledge',target_document.id::text,'Official document indexed',jsonb_build_object('versionId',target_version_id,'chunks',chunk_number,'status',target_version.requested_status));
end $$;

create or replace function public.fail_knowledge_ingestion(target_version_id uuid, target_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_game_id uuid;
begin
  select d.game_id into target_game_id from public.official_document_versions v join public.official_documents d on d.id=v.document_id where v.id=target_version_id;
  if target_game_id is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  update public.official_document_versions set status='FAILED',ingestion_error=left(coalesce(target_error,'Ingestion failed.'),2000),completed_at=now()
  where id=target_version_id and status='PROCESSING';
end $$;

create or replace function public.activate_standard_ability_dataset(target_game_id uuid, target_dataset_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if not exists(select 1 from public.standard_ability_datasets d where d.id=target_dataset_id) then raise exception using errcode='P0002',message='DATASET_NOT_FOUND'; end if;
  insert into public.game_ability_datasets(game_id,dataset_id,activated_by) values(target_game_id,target_dataset_id,auth.uid()) on conflict do nothing;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(target_game_id,auth.uid(),'ability_dataset',target_dataset_id,'Official ability dataset activated',jsonb_build_object('datasetId',target_dataset_id));
end $$;

create or replace function public.list_standard_abilities(target_game_id uuid)
returns table(dataset_id text,dataset_name text,dataset_active boolean,ability_id text,display_name text,category text,sort_order integer,
  version_id uuid,version_number integer,version_scope text,definition_status text,official_description text,structured_data jsonb,source_title text,source_version integer,created_at timestamptz)
language plpgsql security invoker set search_path = '' stable as $$
begin
  if not public.is_game_member(target_game_id) then raise exception using errcode='42501',message='GAME_ACCESS_REQUIRED'; end if;
  return query
  select d.id,d.name,exists(select 1 from public.game_ability_datasets gad where gad.game_id=target_game_id and gad.dataset_id=d.id),
    a.id,a.display_name,a.category,a.sort_order,v.id,v.version_number,case when v.game_id is null then 'GLOBAL' else 'GAME' end,
    v.definition_status,v.official_description,v.structured_data,od.title,odv.version_number,v.created_at
  from public.standard_ability_datasets d join public.standard_abilities a on a.dataset_id=d.id
  join lateral (
    select candidate.* from public.standard_ability_versions candidate
    where candidate.ability_id=a.id and candidate.status='ACTIVE' and (candidate.game_id=target_game_id or candidate.game_id is null)
    order by (candidate.game_id is not null) desc, candidate.version_number desc limit 1
  ) v on true
  left join public.official_document_versions odv on odv.id=v.source_document_version_id
  left join public.official_documents od on od.id=odv.document_id
  order by d.name,a.sort_order;
end $$;

create or replace function public.create_standard_ability_version(target_game_id uuid,target_ability_id text,target_description text,target_structured_data jsonb,target_change_note text default '')
returns table(version_id uuid,version_number integer) language plpgsql security definer set search_path = '' as $$
declare next_version integer; inserted_id uuid; target_dataset_id text;
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select a.dataset_id into target_dataset_id from public.standard_abilities a where a.id=target_ability_id;
  if target_dataset_id is null or not exists(select 1 from public.game_ability_datasets g where g.game_id=target_game_id and g.dataset_id=target_dataset_id)
  then raise exception using errcode='42501',message='DATASET_NOT_ACTIVE'; end if;
  if nullif(btrim(target_description),'') is null or char_length(target_description)>20000 or jsonb_typeof(target_structured_data)<>'object' or char_length(coalesce(target_change_note,''))>1000
  then raise exception using errcode='22023',message='INVALID_ABILITY_VERSION'; end if;
  perform 1 from public.standard_abilities where id=target_ability_id for update;
  select coalesce(max(v.version_number),0)+1 into next_version from public.standard_ability_versions v where v.ability_id=target_ability_id and v.game_id=target_game_id;
  update public.standard_ability_versions set status='SUPERSEDED' where ability_id=target_ability_id and game_id=target_game_id and status='ACTIVE';
  insert into public.standard_ability_versions(ability_id,game_id,version_number,status,definition_status,official_description,structured_data,change_note,created_by)
  values(target_ability_id,target_game_id,next_version,'ACTIVE','DEFINED',btrim(target_description),target_structured_data,coalesce(target_change_note,''),auth.uid()) returning id into inserted_id;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(target_game_id,auth.uid(),'standard_ability',target_ability_id,'Official ability version created',jsonb_build_object('versionId',inserted_id,'version',next_version,'changeNote',target_change_note));
  return query select inserted_id,next_version;
end $$;

create or replace function public.save_role_ability_modifier(target_game_id uuid,target_role_id text,target_ability_id text,target_modifier_text text)
returns table(modifier_id uuid,version_number integer) language plpgsql security definer set search_path = '' as $$
declare next_version integer; inserted_id uuid; target_dataset_id text;
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if nullif(btrim(target_modifier_text),'') is null or char_length(target_modifier_text)>4000
    or not exists(select 1 from public.game_documents gd, jsonb_array_elements(gd.document#>'{data,roles}') r where gd.game_id=target_game_id and r->>'id'=target_role_id)
  then raise exception using errcode='22023',message='INVALID_ROLE_MODIFIER'; end if;
  select dataset_id into target_dataset_id from public.standard_abilities where id=target_ability_id;
  if target_dataset_id is null or not exists(select 1 from public.game_ability_datasets g where g.game_id=target_game_id and g.dataset_id=target_dataset_id)
  then raise exception using errcode='42501',message='DATASET_NOT_ACTIVE'; end if;
  select coalesce(max(version_number),0)+1 into next_version from public.role_ability_modifiers where game_id=target_game_id and role_id=target_role_id and ability_id=target_ability_id;
  update public.role_ability_modifiers set status='SUPERSEDED' where game_id=target_game_id and role_id=target_role_id and ability_id=target_ability_id and status='ACTIVE';
  insert into public.role_ability_modifiers(game_id,role_id,ability_id,version_number,status,modifier_text,created_by)
  values(target_game_id,target_role_id,target_ability_id,next_version,'ACTIVE',btrim(target_modifier_text),auth.uid()) returning id into inserted_id;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(target_game_id,auth.uid(),'role_modifier',target_role_id,'Role ability modifier version created',jsonb_build_object('abilityId',target_ability_id,'version',next_version));
  return query select inserted_id,next_version;
end $$;

create or replace function public.match_game_knowledge(target_game_id uuid,query_embedding extensions.vector(1536),query_text text,match_count integer default 8)
returns table(chunk_id bigint,document_version_id uuid,document_title text,document_version integer,document_type text,heading text,source_locator text,content text,similarity double precision)
language plpgsql security invoker set search_path = '' stable as $$
begin
  if not public.is_game_member(target_game_id) then raise exception using errcode='42501',message='GAME_ACCESS_REQUIRED'; end if;
  return query
  with eligible as (
    select c.*,d.title,d.document_type,v.version_number,
      (1-(c.embedding operator(extensions.<=>) query_embedding))::double precision as vector_score,
      case when nullif(btrim(query_text),'') is null then 0::real else ts_rank(c.search_vector,websearch_to_tsquery('english',query_text)) end as text_score
    from public.official_document_chunks c
    join public.official_document_versions v on v.id=c.document_version_id and v.status='ACTIVE'
    join public.official_documents d on d.id=v.document_id
    where c.embedding is not null and (
      d.game_id=target_game_id or (d.game_id is null and exists(
        select 1 from public.standard_ability_datasets sad
        join public.game_ability_datasets gad on gad.dataset_id=sad.id and gad.game_id=target_game_id
        where sad.source_document_version_id=v.id
      ))
    )
  )
  select e.id,e.document_version_id,e.title,e.version_number,e.document_type,e.heading,e.source_locator,e.content,
    (e.vector_score*0.75 + least(e.text_score::double precision,1)*0.25) as score
  from eligible e order by score desc limit least(20,greatest(1,match_count));
end $$;

create or replace function public.ensure_ai_conversation(target_game_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare conversation_id uuid;
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select id into conversation_id from public.ai_conversations where game_id=target_game_id and active order by created_at desc limit 1;
  if conversation_id is null then insert into public.ai_conversations(game_id,created_by) values(target_game_id,auth.uid()) returning id into conversation_id; end if;
  return conversation_id;
end $$;

create or replace function public.start_new_ai_conversation(target_game_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare conversation_id uuid;
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  update public.ai_conversations set active=false,archived_at=now() where game_id=target_game_id and active;
  insert into public.ai_conversations(game_id,created_by) values(target_game_id,auth.uid()) returning id into conversation_id;
  return conversation_id;
end $$;

create or replace function public.record_ai_exchange(target_game_id uuid,target_conversation_id uuid,target_user_content text,target_assistant_content text,target_result jsonb,target_model text,target_game_version integer,target_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if not exists(select 1 from public.ai_conversations c where c.id=target_conversation_id and c.game_id=target_game_id and c.active)
    or nullif(btrim(target_user_content),'') is null or char_length(target_user_content)>6000
    or nullif(btrim(target_assistant_content),'') is null or char_length(target_assistant_content)>12000
    or jsonb_typeof(target_result)<>'object' or char_length(target_model)>120 or target_game_version<1 or target_request_id is null
  then raise exception using errcode='22023',message='INVALID_AI_EXCHANGE'; end if;
  insert into public.ai_messages(conversation_id,game_id,role,content,model,game_version,request_id,created_by)
  values(target_conversation_id,target_game_id,'user',btrim(target_user_content),'',target_game_version,target_request_id,auth.uid());
  insert into public.ai_messages(conversation_id,game_id,role,content,structured_result,model,game_version,request_id,created_by)
  values(target_conversation_id,target_game_id,'assistant',btrim(target_assistant_content),target_result,target_model,target_game_version,target_request_id,auth.uid());
end $$;

revoke all on function public.create_knowledge_document(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text,text) from public,anon;
revoke all on function public.complete_knowledge_ingestion(uuid,text,text,jsonb) from public,anon;
revoke all on function public.fail_knowledge_ingestion(uuid,text) from public,anon;
revoke all on function public.activate_standard_ability_dataset(uuid,text) from public,anon;
revoke all on function public.list_standard_abilities(uuid) from public,anon;
revoke all on function public.create_standard_ability_version(uuid,text,text,jsonb,text) from public,anon;
revoke all on function public.save_role_ability_modifier(uuid,text,text,text) from public,anon;
revoke all on function public.match_game_knowledge(uuid,extensions.vector,text,integer) from public,anon;
revoke all on function public.ensure_ai_conversation(uuid) from public,anon;
revoke all on function public.start_new_ai_conversation(uuid) from public,anon;
revoke all on function public.record_ai_exchange(uuid,uuid,text,text,jsonb,text,integer,uuid) from public,anon;
grant execute on function public.create_knowledge_document(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text,text) to authenticated;
grant execute on function public.complete_knowledge_ingestion(uuid,text,text,jsonb) to authenticated;
grant execute on function public.fail_knowledge_ingestion(uuid,text) to authenticated;
grant execute on function public.activate_standard_ability_dataset(uuid,text) to authenticated;
grant execute on function public.list_standard_abilities(uuid) to authenticated;
grant execute on function public.create_standard_ability_version(uuid,text,text,jsonb,text) to authenticated;
grant execute on function public.save_role_ability_modifier(uuid,text,text,text) to authenticated;
grant execute on function public.match_game_knowledge(uuid,extensions.vector,text,integer) to authenticated;
grant execute on function public.ensure_ai_conversation(uuid) to authenticated;
grant execute on function public.start_new_ai_conversation(uuid) to authenticated;
grant execute on function public.record_ai_exchange(uuid,uuid,text,text,jsonb,text,integer,uuid) to authenticated;

-- Seed the supplied Courtroom source document and exactly 32 stable abilities once.
insert into public.official_documents(document_key,title,document_type)
values('courtroom_master_ability_encyclopedia','Courtroom — Master Ability Encyclopedia','ABILITY_ENCYCLOPEDIA')
on conflict(document_key) do nothing;

insert into public.official_document_versions(document_id,version_number,status,requested_status,extracted_text,summary,completed_at)
select d.id,1,'ACTIVE','ACTIVE',
$$The Courtroom Master Ability Encyclopedia defines 32 standardized abilities. Standard abilities provide default behavior; explicit role-specific modifiers override that behavior only for the relevant role. Undefined technical values and universal resolution ordering must not be invented.

Personal Instant Kill: A normal targeted kill. It may be stopped or manipulated by applicable normal mechanics including Protect, Guard, Save, Redirect, Reflection, and relevant immunities.
Super Kill: Kills one target while ignoring normal Protect, Guard, and Save. Super Protect and Death Immunity may prevent the death.
Omega Kill: Uses Super Kill strength. It affects the target and every player visiting that target during the cycle, but not players whom the target visits.
Poison: Applies Poison status. The player dies after 2 days unless successfully Healed. Poison is contagious; visitors to a poisoned player become poisoned and start their own 2-day timer.
Roleblock: Prevents the target from performing active abilities during that cycle. Passive abilities remain active unless explicitly stated otherwise.
Protect: Protects against most normal harmful abilities, but not abilities that explicitly bypass normal protection, including Super Kill and Omega Kill.
Guard: Transfers an applicable incoming harmful action from the protected player to the Guard rather than cancelling it.
Save: A reactive emergency rescue that prevents an applicable pending death. It does not override higher kill tiers that explicitly bypass normal Save.
Heal: Removes an active status such as Poison and cancels its death timer. It does not prevent new effects or revive a dead player.
Super Protect: Protects against Super Kill and Omega Kill and is stronger than normal Protect.
Death Immunity: While active, the player cannot die, but may still receive non-death effects. Only an explicit bypass can bypass it.
Reflection: Sends an applicable incoming targeted ability back to its original user.
Counterattack: Usually passive and tied to an immunity. When targeted by an ability the player is immune to, it activates against the attacker; default retaliation is Personal Instant Kill unless the role specifies another effect.
Bulletproof / Passive Immunity: Passive immunity against Personal Instant Kill, Super Kill, Omega Kill, and other targeted harmful effects. It includes Super Protect-level protection unless explicitly bypassed.
Ability Amplify: Increases strength to the next level, such as Personal Instant Kill to Super Kill or Protect to Super Protect. It does not add uses.
Additional Uses: Adds a use to an ability already possessed. It increases quantity, not strength.
Action Success Guarantee: Guarantees the selected action can be performed that cycle and bypasses Roleblock or other prevention from acting. It does not increase strength or bypass target defenses.$$,
'Initial official standardized Courtroom dataset supplied by the GM.',now()
from public.official_documents d
where d.document_key='courtroom_master_ability_encyclopedia'
  and not exists(select 1 from public.official_document_versions v where v.document_id=d.id and v.version_number=1);

insert into public.standard_ability_datasets(id,name,game_key,description,source_document_version_id)
select 'courtroom-master-ability-encyclopedia','Courtroom — Master Ability Encyclopedia','courtroom',
  'Official 32-ability standardized Courtroom dataset. It is not attached to a saved game until a GM explicitly activates it.',v.id
from public.official_document_versions v join public.official_documents d on d.id=v.document_id
where d.document_key='courtroom_master_ability_encyclopedia' and v.version_number=1
on conflict(id) do nothing;

insert into public.standard_abilities(id,dataset_id,display_name,category,sort_order,aliases) values
('basic_ask','courtroom-master-ability-encyclopedia','Basic Ask','Investigation',1,'{}'),
('advanced_ask','courtroom-master-ability-encyclopedia','Advanced Ask','Investigation',2,'{}'),
('alignment_ask','courtroom-master-ability-encyclopedia','Alignment Ask','Investigation',3,'{}'),
('watch','courtroom-master-ability-encyclopedia','Watch','Investigation',4,'{}'),
('track','courtroom-master-ability-encyclopedia','Track','Investigation',5,'{}'),
('action_check','courtroom-master-ability-encyclopedia','Action Check','Investigation',6,'{}'),
('gravedigger','courtroom-master-ability-encyclopedia','Gravedigger','Investigation',7,'{}'),
('map','courtroom-master-ability-encyclopedia','Map','Investigation',8,'{}'),
('den_regular_kill','courtroom-master-ability-encyclopedia','Den Regular Kill','Harmful',9,'{}'),
('personal_instant_kill','courtroom-master-ability-encyclopedia','Personal Instant Kill','Harmful',10,'{"Instant Kill"}'),
('super_kill','courtroom-master-ability-encyclopedia','Super Kill','Harmful',11,'{}'),
('omega_kill','courtroom-master-ability-encyclopedia','Omega Kill','Harmful',12,'{}'),
('poison','courtroom-master-ability-encyclopedia','Poison','Harmful',13,'{}'),
('mark','courtroom-master-ability-encyclopedia','Mark','Harmful',14,'{}'),
('roleblock','courtroom-master-ability-encyclopedia','Roleblock','Harmful',15,'{}'),
('drunk','courtroom-master-ability-encyclopedia','Drunk','Harmful',16,'{}'),
('sober','courtroom-master-ability-encyclopedia','Sober','Harmful',17,'{}'),
('duel_fight','courtroom-master-ability-encyclopedia','Duel / Fight','Harmful',18,'{}'),
('convert','courtroom-master-ability-encyclopedia','Convert','Harmful',19,'{"Conversion"}'),
('steal','courtroom-master-ability-encyclopedia','Steal','Harmful',20,'{}'),
('protect','courtroom-master-ability-encyclopedia','Protect','Protection',21,'{}'),
('guard','courtroom-master-ability-encyclopedia','Guard','Protection',22,'{}'),
('save','courtroom-master-ability-encyclopedia','Save','Protection',23,'{}'),
('heal','courtroom-master-ability-encyclopedia','Heal','Protection',24,'{}'),
('super_protect','courtroom-master-ability-encyclopedia','Super Protect','Protection',25,'{}'),
('death_immunity','courtroom-master-ability-encyclopedia','Death Immunity','Protection',26,'{}'),
('reflection','courtroom-master-ability-encyclopedia','Reflection','Protection',27,'{}'),
('counterattack','courtroom-master-ability-encyclopedia','Counterattack','Protection',28,'{}'),
('bulletproof','courtroom-master-ability-encyclopedia','Bulletproof / Passive Immunity','Protection',29,'{"Bulletproof","Passive Immunity"}'),
('ability_amplify','courtroom-master-ability-encyclopedia','Ability Amplify','Support',30,'{}'),
('additional_uses','courtroom-master-ability-encyclopedia','Additional Uses','Support',31,'{}'),
('action_success_guarantee','courtroom-master-ability-encyclopedia','Action Success Guarantee','Support',32,'{}')
on conflict(id) do nothing;

insert into public.standard_ability_versions(ability_id,version_number,status,definition_status,official_description,structured_data,source_document_version_id)
select seed.ability_id,1,'ACTIVE',seed.definition_status,seed.description,seed.structured_data,v.id
from (values
('basic_ask','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('advanced_ask','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('alignment_ask','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('watch','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('track','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('action_check','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('gravedigger','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('map','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('den_regular_kill','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('personal_instant_kill','DEFINED','A normal targeted kill. It may be stopped or manipulated by applicable normal mechanics including Protect, Guard, Save, Redirect, Reflection, and relevant immunities.',jsonb_build_object('killTier','normal','mayBeStoppedOrManipulatedBy',jsonb_build_array('protect','guard','save','redirect','reflection','relevant_immunities'))),
('super_kill','DEFINED','Kills one target while ignoring normal protection. Protect, Guard, and Save do not stop it. Super Protect and Death Immunity may prevent the death.',jsonb_build_object('killTier','super','ignores',jsonb_build_array('protect','guard','save'),'mayBePreventedBy',jsonb_build_array('super_protect','death_immunity'))),
('omega_kill','DEFINED','Uses Super Kill strength. It affects the targeted player and every player visiting that target during the cycle. It does not automatically affect players whom the target visits.',jsonb_build_object('killTier','super','targets',jsonb_build_array('target','visitors_to_target'),'doesNotTarget',jsonb_build_array('players_visited_by_target'))),
('poison','DEFINED','Applies Poison status. The poisoned player dies after 2 days unless successfully Healed before expiration. Poison is contagious: any player visiting a poisoned player becomes Poisoned and starts their own 2-day timer.',jsonb_build_object('statusApplied','poison','durationDays',2,'removedBy','heal','contagiousTo','visitors')),
('mark','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('roleblock','DEFINED','Prevents the target from performing active abilities during that cycle. Passive abilities remain active unless explicitly stated otherwise.',jsonb_build_object('blocks','active_abilities','duration','cycle','doesNotBlock','passive_abilities_unless_explicit')),
('drunk','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('sober','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('duel_fight','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('convert','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('steal','NEEDS_SOURCE_TEXT',null::text,'{}'::jsonb),
('protect','DEFINED','Protects against most normal harmful abilities. It does not stop abilities that explicitly bypass normal protection, including Super Kill and Omega Kill.',jsonb_build_object('protectionTier','normal','doesNotStop',jsonb_build_array('super_kill','omega_kill'))),
('guard','DEFINED','Transfers an applicable incoming harmful action from the protected player to the Guard. The harmful action is redirected to the Guard rather than cancelled.',jsonb_build_object('effect','transfer_to_guard','cancelsAction',false)),
('save','DEFINED','A reactive emergency rescue when a player is about to die. It prevents that death when applicable. It does not override higher kill tiers that explicitly bypass normal Save.',jsonb_build_object('effect','prevent_pending_death','doesNotOverride','explicit_higher_kill_tier_bypass')),
('heal','DEFINED','Removes an active status effect such as Poison and cancels the Poison death timer. It does not prevent new harmful effects and does not revive a dead player.',jsonb_build_object('removesStatus',jsonb_build_array('poison'),'cancelsTimer','poison_death','preventsNewEffects',false,'revives',false)),
('super_protect','DEFINED','Protects against Super Kill and Omega Kill and is stronger than normal Protect.',jsonb_build_object('protectionTier','super','protectsAgainst',jsonb_build_array('super_kill','omega_kill'))),
('death_immunity','DEFINED','While active, the player cannot die. The player may still be affected by non-death abilities. Only mechanics explicitly stating that they bypass Death Immunity may bypass it.',jsonb_build_object('prevents','death','allows','non_death_effects','bypassRequires','explicit_statement')),
('reflection','DEFINED','Acts like a mirror. An applicable incoming ability targeting the player is sent back to the original user.',jsonb_build_object('effect','return_to_original_user','appliesTo','applicable_incoming_targeted_ability')),
('counterattack','DEFINED','Usually passive and tied to a specific immunity. When the player is targeted by an ability they are immune to, Counterattack automatically activates against the attacker. The default retaliation is normally a Personal Instant Kill unless the role explicitly specifies another effect.',jsonb_build_object('activeOrPassive','passive','trigger','targeted_by_immune_ability','defaultRetaliation','personal_instant_kill')),
('bulletproof','DEFINED','Provides passive immunity against Personal Instant Kill, Super Kill, Omega Kill, and other targeted harmful effects. Bulletproof inherently includes Super Protect-level protection unless an ability explicitly bypasses Bulletproof.',jsonb_build_object('activeOrPassive','passive','immuneTo',jsonb_build_array('personal_instant_kill','super_kill','omega_kill','other_targeted_harmful'),'protectionTier','super','bypassRequires','explicit_statement')),
('ability_amplify','DEFINED','Upgrades an ability to the next power level or stronger version. Examples include Personal Instant Kill to Super Kill and Protect to Super Protect. Amplify increases strength; it does not increase number of uses.',jsonb_build_object('increases','strength','doesNotIncrease','uses','examples',jsonb_build_object('personal_instant_kill','super_kill','protect','super_protect'))),
('additional_uses','DEFINED','Adds another use of an ability already possessed by the player. It increases quantity; it does not increase strength.',jsonb_build_object('increases','uses','doesNotIncrease','strength')),
('action_success_guarantee','DEFINED','Guarantees that the selected action can be performed during that cycle. It bypasses Roleblock and other effects that normally prevent the player from acting. It does not increase ability strength or bypass target defenses.',jsonb_build_object('bypasses',jsonb_build_array('roleblock','other_action_prevention'),'doesNot',jsonb_build_array('increase_strength','bypass_target_defenses')))
) as seed(ability_id,definition_status,description,structured_data)
join public.official_documents d on d.document_key='courtroom_master_ability_encyclopedia'
join public.official_document_versions v on v.document_id=d.id and v.version_number=1
where not exists(select 1 from public.standard_ability_versions existing where existing.ability_id=seed.ability_id and existing.game_id is null and existing.version_number=1);

insert into public.official_document_chunks(document_version_id,game_id,chunk_index,heading,source_locator,content,token_estimate)
select v.id,null,0,'Courtroom standardized abilities','Ability Encyclopedia — version 1',v.extracted_text,greatest(1,char_length(v.extracted_text)/4)
from public.official_document_versions v join public.official_documents d on d.id=v.document_id
where d.document_key='courtroom_master_ability_encyclopedia' and v.version_number=1
  and not exists(select 1 from public.official_document_chunks c where c.document_version_id=v.id);

do $$ begin alter publication supabase_realtime add table public.ai_messages; exception when duplicate_object then null; end $$;
