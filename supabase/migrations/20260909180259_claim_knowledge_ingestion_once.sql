-- One durable worker claim per immutable document version. Never expires:
-- an uncertain/crashed attempt must not automatically repeat paid provider work.
create table private.knowledge_ingestion_claims (
  version_id uuid primary key references public.official_document_versions(id) on delete cascade,
  claim_id uuid not null,
  actor_user_id uuid not null,
  claimed_at timestamptz not null default now()
);
alter table private.knowledge_ingestion_claims enable row level security;
revoke all on private.knowledge_ingestion_claims from public,anon,authenticated,service_role;

create function private.assert_knowledge_ingestion_claim(target_version_id uuid,actor_user_id uuid,target_claim_id uuid)
returns void language plpgsql security invoker set search_path='' as $function$
declare claim_row private.knowledge_ingestion_claims%rowtype;
begin
  select c.* into claim_row from private.knowledge_ingestion_claims c where c.version_id=target_version_id;
  if found then
    if target_claim_id is distinct from claim_row.claim_id or actor_user_id is distinct from claim_row.actor_user_id then
      raise exception using errcode='42501',message='INGESTION_CLAIM_MISMATCH';
    end if;
  elsif target_claim_id is not null then
    raise exception using errcode='42501',message='INGESTION_CLAIM_MISMATCH';
  end if;
end $function$;

create function private.claim_knowledge_ingestion(target_version_id uuid,actor_user_id uuid,target_claim_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $function$
declare version_row public.official_document_versions%rowtype; gid uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  if target_claim_id is null then raise exception using errcode='22023',message='INGESTION_CLAIM_REQUIRED'; end if;
  select v.* into version_row from public.official_document_versions v where v.id=target_version_id for update;
  if not found then raise exception using errcode='P0002',message='DOCUMENT_VERSION_NOT_FOUND'; end if;
  select d.game_id into gid from public.official_documents d where d.id=version_row.document_id;
  if gid is null or not exists(select 1 from public.game_members m where m.game_id=gid and m.user_id=actor_user_id and m.member_role in ('owner','gm')) then
    raise exception using errcode='42501',message='GM_ACCESS_REQUIRED';
  end if;
  if version_row.status<>'PROCESSING' or version_row.requested_status not in ('ACTIVE','APPROVED','DRAFT') then return false; end if;
  insert into private.knowledge_ingestion_claims(version_id,claim_id,actor_user_id)
    values(target_version_id,target_claim_id,actor_user_id) on conflict (version_id) do nothing;
  return found;
end $function$;

CREATE OR REPLACE FUNCTION private.complete_knowledge_ingestion_claimed(target_version_id uuid, target_extracted_text text, target_summary text, target_chunks jsonb, actor_user_id uuid, target_claim_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare target_document public.official_documents%rowtype; target_version public.official_document_versions%rowtype; chunk jsonb; chunk_number integer := 0;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  select v.* into target_version from public.official_document_versions v where v.id=target_version_id for update;
  if not found then raise exception using errcode='P0002',message='DOCUMENT_VERSION_NOT_FOUND'; end if;
  select d.* into target_document from public.official_documents d where d.id=target_version.document_id;
  if target_document.game_id is null or not exists(select 1 from public.game_members m where m.game_id=target_document.game_id and m.user_id=actor_user_id and m.member_role in ('owner','gm'))
  then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  perform private.assert_knowledge_ingestion_claim(target_version_id,actor_user_id,target_claim_id);
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
  if target_version.requested_status = 'ACTIVE' then update public.official_document_versions set status='SUPERSEDED' where document_id=target_document.id and id<>target_version_id and status='ACTIVE'; end if;
  update public.official_document_versions set status=requested_status,extracted_text=coalesce(target_extracted_text,''),summary=coalesce(target_summary,''),approved_by=case when requested_status in ('APPROVED','ACTIVE') then actor_user_id else null end,completed_at=now() where id=target_version_id;
  update public.official_documents set updated_at=now() where id=target_document.id;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(target_document.game_id,actor_user_id,'knowledge',target_document.id::text,'Official document indexed',jsonb_build_object('versionId',target_version_id,'chunks',chunk_number,'status',target_version.requested_status));
end $function$;

create function private.fail_knowledge_ingestion_claimed(target_version_id uuid,target_error text,actor_user_id uuid,target_claim_id uuid)
returns void language plpgsql security invoker set search_path='' as $function$
declare version_row public.official_document_versions%rowtype; gid uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  select v.* into version_row from public.official_document_versions v where v.id=target_version_id for update;
  if not found then raise exception using errcode='P0002',message='DOCUMENT_VERSION_NOT_FOUND'; end if;
  select d.game_id into gid from public.official_documents d where d.id=version_row.document_id;
  if gid is null or not exists(select 1 from public.game_members m where m.game_id=gid and m.user_id=actor_user_id and m.member_role in ('owner','gm')) then
    raise exception using errcode='42501',message='GM_ACCESS_REQUIRED';
  end if;
  perform private.assert_knowledge_ingestion_claim(target_version_id,actor_user_id,target_claim_id);
  update public.official_document_versions set status='FAILED',ingestion_error=left(coalesce(target_error,'Ingestion failed.'),2000),completed_at=now()
    where id=target_version_id and status='PROCESSING';
end $function$;

-- Keep the established public service-only bridge; do not grant schema-wide
-- private access. Internal implementations run only through these tiny wrappers.
create function public.claim_knowledge_ingestion_internal(target_version_id uuid,actor_user_id uuid,target_claim_id uuid)
returns boolean language sql security definer set search_path=''
as $function$ select private.claim_knowledge_ingestion(target_version_id,actor_user_id,target_claim_id) $function$;
create function public.complete_claimed_knowledge_ingestion_internal(target_version_id uuid,target_extracted_text text,target_summary text,target_chunks jsonb,actor_user_id uuid,target_claim_id uuid)
returns void language sql security definer set search_path=''
as $function$ select private.complete_knowledge_ingestion_claimed(target_version_id,target_extracted_text,target_summary,target_chunks,actor_user_id,target_claim_id) $function$;
create function public.fail_claimed_knowledge_ingestion_internal(target_version_id uuid,target_error text,actor_user_id uuid,target_claim_id uuid)
returns void language sql security definer set search_path=''
as $function$ select private.fail_knowledge_ingestion_claimed(target_version_id,target_error,actor_user_id,target_claim_id) $function$;

-- Compatibility for already-running pre-deployment workers: null-claim calls
-- may finish ONLY unclaimed versions, never take over a newly claimed attempt.
create or replace function public.complete_knowledge_ingestion_internal(target_version_id uuid,target_extracted_text text,target_summary text,target_chunks jsonb,actor_user_id uuid)
returns void language sql security definer set search_path=''
as $function$ select private.complete_knowledge_ingestion_claimed(target_version_id,target_extracted_text,target_summary,target_chunks,actor_user_id,null) $function$;
create or replace function public.fail_knowledge_ingestion_internal(target_version_id uuid,target_error text,actor_user_id uuid)
returns void language sql security definer set search_path=''
as $function$ select private.fail_knowledge_ingestion_claimed(target_version_id,target_error,actor_user_id,null) $function$;

revoke all on function private.assert_knowledge_ingestion_claim(uuid,uuid,uuid),private.claim_knowledge_ingestion(uuid,uuid,uuid),private.complete_knowledge_ingestion_claimed(uuid,text,text,jsonb,uuid,uuid),private.fail_knowledge_ingestion_claimed(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_knowledge_ingestion_internal(uuid,uuid,uuid),public.complete_claimed_knowledge_ingestion_internal(uuid,text,text,jsonb,uuid,uuid),public.fail_claimed_knowledge_ingestion_internal(uuid,text,uuid,uuid),public.complete_knowledge_ingestion_internal(uuid,text,text,jsonb,uuid),public.fail_knowledge_ingestion_internal(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_knowledge_ingestion_internal(uuid,uuid,uuid),public.complete_claimed_knowledge_ingestion_internal(uuid,text,text,jsonb,uuid,uuid),public.fail_claimed_knowledge_ingestion_internal(uuid,text,uuid,uuid),public.complete_knowledge_ingestion_internal(uuid,text,text,jsonb,uuid),public.fail_knowledge_ingestion_internal(uuid,text,uuid) to service_role;
