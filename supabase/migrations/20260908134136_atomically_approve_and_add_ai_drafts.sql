-- Add one review-only content entity and mark its draft approved in the same
-- transaction, using the existing game-save validation and review delegates.
set local lock_timeout='5s';
set local statement_timeout='30s';

create function private.approve_and_add_ai_draft(target_draft_id uuid,expected_game_version integer,target_entity jsonb)
returns table(document jsonb,version integer,updated_at timestamptz,updated_by uuid)
language plpgsql security definer set search_path=''
as $function$
declare draft public.ai_drafts%rowtype; current_document jsonb; actual_version integer;
  collection_name text; entity_name text; entity_id text; candidate jsonb; saved record; message text;
begin
  select d.* into draft from public.ai_drafts d where d.id=target_draft_id;
  if not found then raise exception using errcode='P0002',message='AI_DRAFT_NOT_FOUND'; end if;
  if auth.uid() is null or not public.can_edit_game(draft.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  -- Match normal saves' document lock order. Recheck the draft under its lock.
  select gd.document,gd.version into current_document,actual_version from public.game_documents gd where gd.game_id=draft.game_id for update;
  if not found then raise exception using errcode='P0002',message='GAME_DOCUMENT_NOT_FOUND'; end if;
  select d.* into draft from public.ai_drafts d where d.id=target_draft_id for update;
  if not found then raise exception using errcode='P0002',message='AI_DRAFT_NOT_FOUND'; end if;
  if draft.status<>'DRAFT' then raise exception using errcode='55000',message='AI_DRAFT_ALREADY_REVIEWED'; end if;
  if actual_version is distinct from expected_game_version then raise exception using errcode='PT422',message='VERSION_CONFLICT'; end if;
  collection_name:=case draft.draft_type when 'ROLE' then 'roles' when 'ABILITY' then 'abilities' when 'FACTION' then 'factions' when 'RULE' then 'rules' else null end;
  if collection_name is null then raise exception using errcode='22023',message='DRAFT_REQUIRES_SEPARATE_WORKFLOW'; end if;
  if coalesce(jsonb_typeof(target_entity),'null')<>'object' or octet_length(target_entity::text)>100000 or target_entity->>'gameId' is distinct from draft.game_id::text then raise exception using errcode='22023',message='INVALID_DRAFT_ENTITY'; end if;
  entity_id:=target_entity->>'id';
  entity_name:=btrim(coalesce(case when draft.draft_type='RULE' then target_entity->>'title' else target_entity->>'name' end,''));
  if coalesce(length(entity_id),0) not between 1 and 160 or length(entity_name) not between 1 and 200 then raise exception using errcode='22023',message='INVALID_DRAFT_ENTITY'; end if;
  if coalesce(jsonb_typeof(current_document#>array['data',collection_name]),'null')<>'array' then raise exception using errcode='22023',message='INVALID_GAME_COLLECTION'; end if;
  if exists(select 1 from jsonb_array_elements(current_document#>array['data',collection_name]) item where item->>'id'=entity_id or lower(btrim(case when draft.draft_type='RULE' then item->>'title' else item->>'name' end))=lower(entity_name)) then raise exception using errcode='23505',message='DRAFT_ENTITY_ALREADY_EXISTS'; end if;
  if draft.draft_type='ABILITY' and nullif(btrim(target_entity->>'definition'),'') is null then raise exception using errcode='22023',message='ABILITY_DEFINITION_REQUIRED'; end if;
  if draft.draft_type='RULE' and nullif(btrim(target_entity->>'description'),'') is null then raise exception using errcode='22023',message='RULE_DESCRIPTION_REQUIRED'; end if;
  if draft.draft_type='ROLE' then
    if coalesce(target_entity->>'roleType','') not in ('BASIC','STANDARD') or coalesce(jsonb_typeof(target_entity->'tags'),'null')<>'array' then raise exception using errcode='22023',message='INVALID_ROLE_DRAFT'; end if;
    if not exists(select 1 from jsonb_array_elements(current_document#>'{data,factions}') f where f->>'id'=target_entity->>'factionId') then raise exception using errcode='23503',message='ROLE_FACTION_NOT_FOUND'; end if;
    if target_entity->>'roleType'='BASIC' then
      if jsonb_array_length(target_entity->'tags')<>0 or coalesce(target_entity->>'activeAbilityId','')<>'' or coalesce(target_entity->>'passiveAbilityId','')<>'' then raise exception using errcode='22023',message='BASIC_ROLE_CANNOT_HAVE_ABILITIES'; end if;
    else
      if jsonb_array_length(target_entity->'tags')=0 or exists(select 1 from jsonb_array_elements_text(target_entity->'tags') tag where not exists(select 1 from jsonb_array_elements(current_document#>'{data,abilities}') a where lower(btrim(a->>'name'))=lower(btrim(tag)))) then raise exception using errcode='23503',message='ROLE_ENCYCLOPEDIA_ABILITY_REQUIRED'; end if;
      if exists(select 1 from unnest(array[target_entity->>'activeAbilityId',target_entity->>'passiveAbilityId']) selected_id where coalesce(selected_id,'')<>'' and not exists(select 1 from jsonb_array_elements(current_document#>'{data,abilities}') a where a->>'id'=selected_id and exists(select 1 from jsonb_array_elements_text(target_entity->'tags') tag where lower(btrim(a->>'name'))=lower(btrim(tag))))) then raise exception using errcode='23503',message='ROLE_SELECTED_ABILITY_NOT_FOUND'; end if;
    end if;
  end if;
  message:=left('AI '||lower(draft.draft_type)||' draft approved and added: '||entity_name||'.',120);
  candidate:=jsonb_set(current_document,array['data',collection_name],(current_document#>array['data',collection_name])||jsonb_build_array(target_entity));
  candidate:=jsonb_set(candidate,'{data,history}',coalesce(candidate#>'{data,history}','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'gameId',draft.game_id,'type',draft.draft_type,'message',message,'day',current_document#>'{game,currentDay}','phase',current_document#>'{game,currentPhase}','timestamp',now())));
  candidate:=jsonb_set(candidate,'{data,lastSavedAt}',to_jsonb(now()));
  candidate:=jsonb_set(candidate,'{game,lastSavedAt}',to_jsonb(now()));
  candidate:=jsonb_set(candidate,'{game,updatedAt}',to_jsonb(now()));
  select * into saved from public.save_game_document(draft.game_id,expected_game_version,candidate,message,lower(draft.draft_type),entity_id);
  perform private.review_ai_draft(target_draft_id,'APPROVED');
  return query select saved.document,saved.version,saved.updated_at,saved.updated_by;
end $function$;

create function public.approve_and_add_ai_draft(target_draft_id uuid,expected_game_version integer,target_entity jsonb)
returns table(document jsonb,version integer,updated_at timestamptz,updated_by uuid)
language sql security invoker set search_path=''
as $function$select * from private.approve_and_add_ai_draft(target_draft_id,expected_game_version,target_entity)$function$;

revoke all on function private.approve_and_add_ai_draft(uuid,integer,jsonb),public.approve_and_add_ai_draft(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.approve_and_add_ai_draft(uuid,integer,jsonb),public.approve_and_add_ai_draft(uuid,integer,jsonb) to authenticated;
