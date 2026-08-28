-- v11.7.2: keep PL/pgSQL locals distinct from table column names so mode
-- validation cannot fail with "column reference player_id is ambiguous".

create or replace function private.validate_player_action_mode_context(target_game_id uuid,target_action jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc jsonb;player_record jsonb;role_record jsonb;ability_record jsonb;mode_record jsonb;action_mode_id text;action_ability_id text;action_player_id text;current_mode_id text;override_reason text;role_wide boolean:=false;mode_owns boolean:=false;grant_owns boolean:=false;mode_access boolean:=false;
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
  select value into mode_record from jsonb_array_elements(coalesce(role_record->'modes','[]'::jsonb)) where value->>'id'=action_mode_id limit 1;
  if mode_record is null then raise exception using errcode='23503',message='MODE_NOT_FOUND'; end if;
  select exists(select 1 from jsonb_array_elements_text(coalesce(role_record->'roleWideAbilityIds','[]'::jsonb)) allowed(value) where allowed.value=action_ability_id) into role_wide;
  select exists(select 1 from jsonb_array_elements_text(coalesce(mode_record->'abilityIds','[]'::jsonb)||coalesce(mode_record->'passiveAbilityIds','[]'::jsonb)) allowed(value) where allowed.value=action_ability_id) into mode_owns;
  select exists(select 1 from public.player_ability_grants grant_source where grant_source.game_id=target_game_id and grant_source.player_id=action_player_id and grant_source.ability_id=action_ability_id and grant_source.status='ACTIVE') into grant_owns;
  if not role_wide and not mode_owns and not grant_owns and override_reason='' then raise exception using errcode='42501',message='ABILITY_NOT_AVAILABLE_IN_MODE'; end if;
  current_mode_id:=coalesce(player_record->>'currentModeId',player_record->>'current_mode_id','');
  mode_access:=current_mode_id='' or current_mode_id=action_mode_id or upper(coalesce(role_record->>'modeSelectionPolicy','CURRENT_ONLY'))='CHOOSE_BEFORE_ACTION';
  if not mode_access then
    select exists(
      select 1 from public.player_status_effects effect cross join lateral jsonb_array_elements_text(coalesce(effect.metadata->'modeIds',effect.metadata->'mode_ids',effect.metadata->'modeAccessIds',effect.metadata->'mode_access_ids','[]'::jsonb)) allowed(value)
      where effect.game_id=target_game_id and effect.player_id=action_player_id and effect.state='ACTIVE' and allowed.value=action_mode_id
      union all
      select 1 from public.player_ability_grants grant_source cross join lateral jsonb_array_elements_text(coalesce(grant_source.special_conditions->'modeIds',grant_source.special_conditions->'mode_ids',grant_source.metadata->'modeIds',grant_source.metadata->'mode_ids','[]'::jsonb)) allowed(value)
      where grant_source.game_id=target_game_id and grant_source.player_id=action_player_id and grant_source.status='ACTIVE' and allowed.value=action_mode_id
    ) into mode_access;
  end if;
  if not mode_access and override_reason='' then raise exception using errcode='42501',message='INACTIVE_MODE'; end if;
  return jsonb_build_object('modeId',action_mode_id,'modeName',mode_record->>'name','currentModeId',nullif(current_mode_id,''),'temporaryAccess',current_mode_id<>action_mode_id and upper(coalesce(role_record->>'modeSelectionPolicy','CURRENT_ONLY'))<>'CHOOSE_BEFORE_ACTION');
end$$;

revoke all on function private.validate_player_action_mode_context(uuid,jsonb) from public,anon,authenticated,service_role;
comment on function private.validate_player_action_mode_context(uuid,jsonb) is 'Validates mode context separately from the selectable ability ID using collision-safe PL/pgSQL locals.';
