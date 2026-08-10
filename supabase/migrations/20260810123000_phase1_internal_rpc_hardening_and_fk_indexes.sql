-- Keep AI-generated persistence behind authenticated Edge Functions and cover every Phase 1 foreign key.
create index official_documents_created_by_idx on public.official_documents(created_by) where created_by is not null;
create index official_document_versions_created_by_idx on public.official_document_versions(created_by) where created_by is not null;
create index official_document_versions_approved_by_idx on public.official_document_versions(approved_by) where approved_by is not null;
create index standard_ability_datasets_source_version_idx on public.standard_ability_datasets(source_document_version_id) where source_document_version_id is not null;
create index standard_ability_versions_source_version_idx on public.standard_ability_versions(source_document_version_id) where source_document_version_id is not null;
create index standard_ability_versions_created_by_idx on public.standard_ability_versions(created_by) where created_by is not null;
create index game_ability_datasets_activated_by_idx on public.game_ability_datasets(activated_by);
create index role_ability_modifiers_created_by_idx on public.role_ability_modifiers(created_by);
create index ai_conversations_created_by_idx on public.ai_conversations(created_by);
create index ai_messages_created_by_idx on public.ai_messages(created_by);

revoke all on function public.complete_knowledge_ingestion(uuid,text,text,jsonb) from authenticated;
revoke all on function public.fail_knowledge_ingestion(uuid,text) from authenticated;
revoke all on function public.record_ai_exchange(uuid,uuid,text,text,jsonb,text,integer,uuid) from authenticated;

create or replace function public.complete_knowledge_ingestion_internal(target_version_id uuid, target_extracted_text text, target_summary text, target_chunks jsonb, actor_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_document public.official_documents%rowtype; target_version public.official_document_versions%rowtype; chunk jsonb; chunk_number integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  select v.* into target_version from public.official_document_versions v where v.id=target_version_id for update;
  if not found then raise exception using errcode='P0002',message='DOCUMENT_VERSION_NOT_FOUND'; end if;
  select d.* into target_document from public.official_documents d where d.id=target_version.document_id;
  if target_document.game_id is null or not exists(select 1 from public.game_members m where m.game_id=target_document.game_id and m.user_id=actor_user_id and m.member_role in ('owner','gm'))
  then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
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
end $$;

create or replace function public.fail_knowledge_ingestion_internal(target_version_id uuid, target_error text, actor_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_game_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  select d.game_id into target_game_id from public.official_document_versions v join public.official_documents d on d.id=v.document_id where v.id=target_version_id;
  if target_game_id is null or not exists(select 1 from public.game_members m where m.game_id=target_game_id and m.user_id=actor_user_id and m.member_role in ('owner','gm'))
  then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  update public.official_document_versions set status='FAILED',ingestion_error=left(coalesce(target_error,'Ingestion failed.'),2000),completed_at=now() where id=target_version_id and status='PROCESSING';
end $$;

create or replace function public.record_ai_exchange_internal(target_game_id uuid,target_conversation_id uuid,target_user_content text,target_assistant_content text,target_result jsonb,target_model text,target_game_version integer,target_request_id uuid,actor_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  if not exists(select 1 from public.game_members m where m.game_id=target_game_id and m.user_id=actor_user_id and m.member_role in ('owner','gm'))
    or not exists(select 1 from public.ai_conversations c where c.id=target_conversation_id and c.game_id=target_game_id and c.active)
    or nullif(btrim(target_user_content),'') is null or char_length(target_user_content)>6000
    or nullif(btrim(target_assistant_content),'') is null or char_length(target_assistant_content)>12000
    or jsonb_typeof(target_result)<>'object' or char_length(target_model)>120 or target_game_version<1 or target_request_id is null
  then raise exception using errcode='22023',message='INVALID_AI_EXCHANGE'; end if;
  insert into public.ai_messages(conversation_id,game_id,role,content,model,game_version,request_id,created_by)
  values(target_conversation_id,target_game_id,'user',btrim(target_user_content),'',target_game_version,target_request_id,actor_user_id);
  insert into public.ai_messages(conversation_id,game_id,role,content,structured_result,model,game_version,request_id,created_by)
  values(target_conversation_id,target_game_id,'assistant',btrim(target_assistant_content),target_result,target_model,target_game_version,target_request_id,actor_user_id);
end $$;

revoke all on function public.complete_knowledge_ingestion_internal(uuid,text,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.fail_knowledge_ingestion_internal(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.record_ai_exchange_internal(uuid,uuid,text,text,jsonb,text,integer,uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_knowledge_ingestion_internal(uuid,text,text,jsonb,uuid) to service_role;
grant execute on function public.fail_knowledge_ingestion_internal(uuid,text,uuid) to service_role;
grant execute on function public.record_ai_exchange_internal(uuid,uuid,text,text,jsonb,text,integer,uuid,uuid) to service_role;
