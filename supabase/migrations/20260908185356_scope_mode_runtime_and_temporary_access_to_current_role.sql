-- Keep current role identity consistent across mode UI, queue access and immutable snapshots.
-- Existing authorization, function ownership, search_path and ACLs are retained.
CREATE OR REPLACE FUNCTION public.mutate_temporary_mode_access(target_game_id uuid, target_player_id text, target_mode_id text, target_operation text, target_reason text, target_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, target_expires_cycle integer DEFAULT NULL::integer, target_expires_phase text DEFAULT ''::text)
 RETURNS player_mode_states
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid:=(select auth.uid());stored public.game_documents%rowtype;player_record jsonb;role_record jsonb;mode_record jsonb;current_state public.player_mode_states%rowtype;result public.player_mode_states%rowtype;operation text:=upper(btrim(coalesce(target_operation,'')));next_access jsonb;current_cycle integer;current_phase text;
begin
  if actor_id is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if operation not in ('GRANT','REVOKE') then raise exception using errcode='22023',message='INVALID_MODE_ACCESS_OPERATION'; end if;
  if length(btrim(coalesce(target_reason,'')))<3 then raise exception using errcode='22023',message='MODE_ACCESS_REASON_REQUIRED'; end if;
  select * into stored from public.game_documents document_row where document_row.game_id=target_game_id for update;
  select value into player_record from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) player(value) where player.value->>'id'=target_player_id limit 1;
  select value into role_record from jsonb_array_elements(coalesce(stored.document#>'{data,roles}','[]'::jsonb)) role(value) where role.value->>'id'=player_record->>'roleId' limit 1;
  select value into mode_record from jsonb_array_elements(coalesce(role_record->'modes','[]'::jsonb)) mode(value) where mode.value->>'id'=target_mode_id limit 1;
  if mode_record is null then raise exception using errcode='23503',message='MODE_NOT_FOUND'; end if;
  select * into current_state from public.player_mode_states state_row where state_row.game_id=target_game_id and state_row.player_id=target_player_id for update;
  if not found or current_state.role_id is distinct from role_record->>'id' then current_state:=private.change_player_mode_state(target_game_id,target_player_id,coalesce(nullif(player_record->>'currentModeId',''),nullif(role_record->>'startingModeId',''),role_record#>>'{modes,0,id}'),'Initialized before temporary configuration access.','SYSTEM',false); end if;
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into next_access from jsonb_array_elements(coalesce(current_state.temporary_mode_access,'[]'::jsonb)) with ordinality access(value,ordinality) where value->>'modeId'<>target_mode_id;
  if operation='GRANT' then next_access:=next_access||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('modeId',target_mode_id,'modeName',mode_record->>'name','grantedAt',now(),'expiresAt',target_expires_at,'expiresCycle',target_expires_cycle,'expiresPhase',nullif(btrim(target_expires_phase),''),'reason',btrim(target_reason)))); end if;
  update public.player_mode_states state_row set temporary_mode_access=next_access,version=state_row.version+1,updated_at=now(),updated_by=actor_id where state_row.game_id=target_game_id and state_row.player_id=target_player_id returning * into result;
  current_cycle:=coalesce(nullif(stored.document#>>'{game,currentDay}','')::integer,0);current_phase:=coalesce(stored.document#>>'{game,currentPhase}','');
  insert into public.player_mode_events(game_id,player_id,role_id,previous_mode_id,new_mode_id,event_type,reason,source_type,cycle,phase,temporary,payload,actor_user_id) values(target_game_id,target_player_id,result.role_id,result.current_mode_id,target_mode_id,case when operation='GRANT' then 'TEMPORARY_ACCESS_GRANTED' else 'TEMPORARY_ACCESS_REVOKED' end,btrim(target_reason),'GM_TRIGGERED',current_cycle,current_phase,true,jsonb_build_object('modeName',mode_record->>'name','expiresAt',target_expires_at,'expiresCycle',target_expires_cycle,'expiresPhase',nullif(btrim(target_expires_phase),'')),actor_id);
  return result;
end$function$
;

CREATE OR REPLACE FUNCTION private.validate_player_action_mode_context(target_game_id uuid, target_action jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare doc jsonb;player_record jsonb;role_record jsonb;ability_record jsonb;mode_record jsonb;action_mode_id text;action_ability_id text;action_player_id text;current_mode_id text;override_reason text;role_wide boolean:=false;mode_owns boolean:=false;grant_owns boolean:=false;mode_access boolean:=false;state_access boolean:=false;mode_state public.player_mode_states%rowtype;current_cycle integer;current_phase text;
begin
  if upper(coalesce(target_action->>'sourceType','PLAYER'))<>'PLAYER' then return '{}'::jsonb; end if;
  select document into doc from public.game_documents where game_id=target_game_id;if doc is null then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  action_player_id:=coalesce(target_action->>'sourcePlayerId',target_action->>'actorId','');action_ability_id:=coalesce(target_action->>'abilityId','');action_mode_id:=coalesce(target_action->>'modeId','');override_reason:=btrim(coalesce(target_action->>'overrideReason',''));
  select value into player_record from jsonb_array_elements(coalesce(doc#>'{data,players}','[]'::jsonb)) where value->>'id'=action_player_id limit 1;
  select value into role_record from jsonb_array_elements(coalesce(doc#>'{data,roles}','[]'::jsonb)) where value->>'id'=player_record->>'roleId' limit 1;
  select value into ability_record from jsonb_array_elements(coalesce(doc#>'{data,abilities}','[]'::jsonb)) where value->>'id'=action_ability_id limit 1;
  if ability_record is null then raise exception using errcode='23503',message='ABILITY_NOT_FOUND'; end if;
  if action_mode_id=action_ability_id or coalesce(nullif(ability_record->>'selectableAsAction','')::boolean,true)=false or coalesce(nullif(ability_record->>'modeContextOnly','')::boolean,false) or upper(coalesce(ability_record->>'recordType',''))='MODE_CONTEXT' then raise exception using errcode='22023',message='MODE_IS_NOT_AN_ACTION'; end if;
  if jsonb_array_length(coalesce(role_record->'modes','[]'::jsonb))=0 then return '{}'::jsonb; end if;
  if action_mode_id='' then raise exception using errcode='22023',message='MODE_CONTEXT_REQUIRED'; end if;
  select value into mode_record from jsonb_array_elements(coalesce(role_record->'modes','[]'::jsonb)) where value->>'id'=action_mode_id limit 1;if mode_record is null then raise exception using errcode='23503',message='MODE_NOT_FOUND'; end if;
  select exists(select 1 from jsonb_array_elements_text(coalesce(role_record->'roleWideAbilityIds','[]'::jsonb)||coalesce(role_record->'roleWidePassiveAbilityIds','[]'::jsonb)) allowed(value) where allowed.value=action_ability_id) into role_wide;
  select exists(select 1 from jsonb_array_elements_text(coalesce(mode_record->'abilityIds','[]'::jsonb)||coalesce(mode_record->'passiveAbilityIds','[]'::jsonb)) allowed(value) where allowed.value=action_ability_id) into mode_owns;
  select exists(select 1 from public.player_ability_grants grant_source where grant_source.game_id=target_game_id and grant_source.player_id=action_player_id and grant_source.ability_id=action_ability_id and grant_source.status='ACTIVE') into grant_owns;
  if not role_wide and not mode_owns and not grant_owns and override_reason='' then raise exception using errcode='42501',message='ABILITY_NOT_AVAILABLE_IN_MODE'; end if;
  select * into mode_state from public.player_mode_states state_row where state_row.game_id=target_game_id and state_row.player_id=action_player_id;
  current_mode_id:=coalesce(case when mode_state.role_id=role_record->>'id' then nullif(mode_state.current_mode_id,'') end,player_record->>'currentModeId',role_record->>'startingModeId',role_record#>>'{modes,0,id}');current_cycle:=coalesce(nullif(doc#>>'{game,currentDay}','')::integer,0);current_phase:=coalesce(doc#>>'{game,currentPhase}','');
  select exists(select 1 from jsonb_array_elements(case when mode_state.role_id=role_record->>'id' then coalesce(mode_state.temporary_mode_access,'[]'::jsonb) else '[]'::jsonb end) access(value) where value->>'modeId'=action_mode_id and (nullif(value->>'expiresAt','') is null or (value->>'expiresAt')::timestamptz>now()) and (nullif(value->>'expiresCycle','') is null or (value->>'expiresCycle')::integer>=current_cycle) and not coalesce((nullif(value->>'expiresCycle','')::integer=current_cycle and nullif(value->>'expiresPhase','')=current_phase and coalesce((value->>'expireOnPhaseStart')::boolean,true)),false)) into state_access;
  mode_access:=current_mode_id=action_mode_id or state_access;
  if not mode_access then
    select exists(select 1 from public.player_status_effects effect cross join lateral jsonb_array_elements_text(coalesce(effect.metadata->'modeIds',effect.metadata->'mode_ids',effect.metadata->'modeAccessIds',effect.metadata->'mode_access_ids','[]'::jsonb)) allowed(value) where effect.game_id=target_game_id and effect.player_id=action_player_id and effect.state='ACTIVE' and allowed.value=action_mode_id union all select 1 from public.player_ability_grants grant_source cross join lateral jsonb_array_elements_text(coalesce(grant_source.special_conditions->'modeIds',grant_source.special_conditions->'mode_ids',grant_source.metadata->'modeIds',grant_source.metadata->'mode_ids','[]'::jsonb)) allowed(value) where grant_source.game_id=target_game_id and grant_source.player_id=action_player_id and grant_source.status='ACTIVE' and allowed.value=action_mode_id) into mode_access;
  end if;
  if not mode_access and upper(coalesce(role_record->>'modeSelectionPolicy','CURRENT_ONLY'))<>'CHOOSE_BEFORE_ACTION' and override_reason='' then raise exception using errcode='42501',message='INACTIVE_MODE'; end if;
  if mode_state.role_id=role_record->>'id' and mode_state.mode_locked and mode_state.locked_mode_id<>action_mode_id and override_reason='' then raise exception using errcode='55000',message='MODE_LOCKED'; end if;
  return jsonb_build_object('modeId',action_mode_id,'modeName',mode_record->>'name','currentModeId',nullif(current_mode_id,''),'temporaryAccess',state_access,'requiresSwitch',not mode_access,'modeLocked',case when mode_state.role_id=role_record->>'id' then coalesce(mode_state.mode_locked,false) else false end);
end$function$
;

CREATE OR REPLACE FUNCTION private.start_resolution_session(target_game_id uuid, expected_game_version integer)
 RETURNS resolution_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result public.resolution_sessions%rowtype;
  stored public.game_documents%rowtype;
  complete_snapshot jsonb;
begin
  result:=private.start_resolution_session_v11_9(target_game_id,expected_game_version);
  if result.status in ('FINALIZED','REJECTED') or result.pre_resolution_state->>'engine_snapshot_version'='1' then return result; end if;
  select * into stored from public.game_documents document where document.game_id=target_game_id;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  complete_snapshot:=jsonb_build_object(
    'schema_version',1,
    'engine_snapshot_version',1,
    'game_id',target_game_id,
    'resolution_id',result.id,
    'round',result.cycle,
    'phase',result.phase,
    'captured_at',now(),
    'game_version',stored.version,
    'players',coalesce(stored.document#>'{data,players}','[]'::jsonb),
    'roles',coalesce(stored.document#>'{data,roles}','[]'::jsonb),
    'factions',coalesce(stored.document#>'{data,factions}','[]'::jsonb),
    'abilities',coalesce(stored.document#>'{data,abilities}','[]'::jsonb),
    'rules',coalesce(stored.document#>'{data,rules}','[]'::jsonb),
    'statuses',coalesce((select jsonb_agg(to_jsonb(effect) order by effect.created_at) from public.player_status_effects effect where effect.game_id=target_game_id and effect.state in ('ACTIVE','PENDING')),'[]'::jsonb),
    'grants',coalesce((select jsonb_agg(to_jsonb(grant_record) order by grant_record.created_at) from public.player_ability_grants grant_record where grant_record.game_id=target_game_id and grant_record.status='ACTIVE'),'[]'::jsonb),
    'modes',coalesce((select jsonb_agg(to_jsonb(mode_state) order by mode_state.player_id) from public.player_mode_states mode_state where mode_state.game_id=target_game_id and exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) snapshot_player(value) where snapshot_player.value->>'id'=mode_state.player_id and snapshot_player.value->>'roleId'=mode_state.role_id)),'[]'::jsonb),
    'temporary_mode_access',coalesce((select jsonb_agg(access.value||jsonb_build_object('player_id',mode_state.player_id,'role_id',mode_state.role_id)) from public.player_mode_states mode_state cross join lateral jsonb_array_elements(mode_state.temporary_mode_access) access(value) where mode_state.game_id=target_game_id and exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) snapshot_player(value) where snapshot_player.value->>'id'=mode_state.player_id and snapshot_player.value->>'roleId'=mode_state.role_id) and (nullif(access.value->>'expiresAt','') is null or (access.value->>'expiresAt')::timestamptz>now()) and (nullif(access.value->>'expiresCycle','') is null or (access.value->>'expiresCycle')::integer>=result.cycle) and not coalesce((nullif(access.value->>'expiresCycle','')::integer=result.cycle and nullif(access.value->>'expiresPhase','')=result.phase and coalesce((access.value->>'expireOnPhaseStart')::boolean,true)),false)),'[]'::jsonb),
    'precedents',coalesce((select jsonb_agg(jsonb_build_object('id',precedent.id,'title',precedent.title,'summary',precedent.summary,'scope',precedent.scope,'interaction_signature',precedent.interaction_signature,'final_outcome',precedent.final_outcome) order by precedent.updated_at desc) from public.gm_precedents precedent where precedent.game_id=target_game_id and precedent.status='ACTIVE'),'[]'::jsonb)
  );
  update public.resolution_sessions session
  set pre_resolution_state=complete_snapshot
  where session.id=result.id and session.status not in ('FINALIZED','REJECTED')
  returning * into result;
  return result;
end $function$
;
