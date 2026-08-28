-- v11.7: a role mode is state/context, never an action. Preserve legacy mode
-- records for audit, relink known source-backed Transformers mechanics, and
-- validate mode_id independently from ability_id at the database boundary.

create or replace function private.jsonb_text_union_excluding(base_values jsonb,additional_values text[],excluded_pattern text default null)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(value order by value),'[]'::jsonb)
  from (
    select distinct value
    from (
      select item.value from jsonb_array_elements_text(case when jsonb_typeof(base_values)='array' then base_values else '[]'::jsonb end) item(value)
      union all select unnest(coalesce(additional_values,'{}'::text[]))
    ) combined
    where nullif(btrim(value),'') is not null and (excluded_pattern is null or value !~* excluded_pattern)
  ) unique_values
$$;

do $$
declare
  stored public.game_documents%rowtype;doc jsonb;roles jsonb;abilities jsonb;players jsonb;role_item jsonb;player_item jsonb;ability_item jsonb;next_roles jsonb;next_players jsonb;next_abilities jsonb;next_role jsonb;next_player jsonb;next_ability jsonb;role_name text;role_id text;player_role_name text;den_block_id text;guard_id text;reflection_id text;bulletproof_id text;save_id text;heal_id text;protect_id text;basic_ask_id text;roleblock_id text;death_immunity_id text;instant_kill_id text;super_kill_id text;robot_mode_id text;alt_mode_id text;migrated boolean;
begin
  for stored in select * from public.game_documents for update loop
    doc:=stored.document;roles:=coalesce(doc#>'{data,roles}','[]'::jsonb);abilities:=coalesce(doc#>'{data,abilities}','[]'::jsonb);players:=coalesce(doc#>'{data,players}','[]'::jsonb);migrated:=false;
    if not exists(select 1 from jsonb_array_elements(roles) role where lower(coalesce(role->>'name','')) in ('den blocker – ironhide','den blocker - ironhide','doc – ratchet','doc - ratchet','ultimate – optimus','ultimate - optimus')) then continue; end if;

    select value->>'id' into guard_id from jsonb_array_elements(abilities) where lower(value->>'name')='guard' limit 1;
    select value->>'id' into reflection_id from jsonb_array_elements(abilities) where lower(value->>'name')='reflection' limit 1;
    select value->>'id' into bulletproof_id from jsonb_array_elements(abilities) where lower(value->>'name')='bulletproof / passive immunity' limit 1;
    select value->>'id' into save_id from jsonb_array_elements(abilities) where lower(value->>'name')='save' limit 1;
    select value->>'id' into heal_id from jsonb_array_elements(abilities) where lower(value->>'name')='heal' limit 1;
    select value->>'id' into protect_id from jsonb_array_elements(abilities) where lower(value->>'name')='protect' limit 1;
    select value->>'id' into basic_ask_id from jsonb_array_elements(abilities) where lower(value->>'name')='basic ask' limit 1;
    select value->>'id' into roleblock_id from jsonb_array_elements(abilities) where lower(value->>'name')='roleblock' limit 1;
    select value->>'id' into death_immunity_id from jsonb_array_elements(abilities) where lower(value->>'name')='death immunity' limit 1;
    select value->>'id' into instant_kill_id from jsonb_array_elements(abilities) where lower(value->>'name')='personal instant kill' limit 1;
    select value->>'id' into super_kill_id from jsonb_array_elements(abilities) where lower(value->>'name')='super kill' limit 1;
    select value->>'id' into den_block_id from jsonb_array_elements(abilities) where lower(value->>'name')='den block' limit 1;

    if den_block_id is null and exists(select 1 from jsonb_array_elements(roles) role where lower(coalesce(role->>'name','')) in ('den blocker – ironhide','den blocker - ironhide')) then
      den_block_id:=gen_random_uuid()::text;
      abilities:=abilities||jsonb_build_array(jsonb_build_object(
        'id',den_block_id,'gameId',stored.game_id::text,'name','Den Block','category','Harmful','phase','Night','definition','Block the Den faction for the applicable cycle using Ironhide''s barricades. This is the action available in Alt Mode; Alt Mode itself is not an action.','mechanics',jsonb_build_array('faction block','den blocked'),'builtIn',false,'revisions','[]'::jsonb,'standardAbilityId','den_block','baseStandardAbilityId','den_block','standardizedAbilityType','Den Block','resolutionCategory','BLOCKS','resolutionPriority',1,'resolutionTiming','ORDERED_STAGE','activePassive','ACTIVE','targeting',jsonb_build_object('type','FACTION','selectionRuleType','HARD_SELECTION_RESTRICTION','minTargets',0,'maxTargets',0,'selectionRules',jsonb_build_array('Den faction'),'effectEligibilityRules','[]'::jsonb,'targetFactionRestrictions',jsonb_build_array('Den'),'targetRoleRestrictions','[]'::jsonb,'livingOnly',false,'deadOnly',false,'selfAllowed',false,'selfProhibited',false,'factionMemberOnly',false,'nonFactionMemberOnly',false,'hiddenInformationSafe',true,'manuallyTriggerable',false),'understanding',jsonb_build_object('schemaVersion',2,'targeting',jsonb_build_object('type','FACTION','selectionRuleType','HARD_SELECTION_RESTRICTION','minTargets',0,'maxTargets',0,'selectionRules',jsonb_build_array('Den faction'),'effectEligibilityRules','[]'::jsonb,'targetFactionRestrictions',jsonb_build_array('Den'),'targetRoleRestrictions','[]'::jsonb,'livingOnly',false,'deadOnly',false,'selfAllowed',false,'selfProhibited',false,'factionMemberOnly',false,'nonFactionMemberOnly',false,'hiddenInformationSafe',true,'manuallyTriggerable',false),'globalResolution',jsonb_build_object('standardAbilityId','den_block','standardizedAbilityType','Den Block','resolutionCategory','BLOCKS','resolutionPriority',1,'resolutionTiming','ORDERED_STAGE','activePassive','ACTIVE','classificationSource','EXPLICIT_GAME_OR_ROLE_OVERRIDE','requiresGmClassification',false),'mechanics','[]'::jsonb,'unresolvedComponents','[]'::jsonb),'sourceText','Uses his barricades to block the den (1 time use).','sourceLocation','Transformers — Den Blocker – Ironhide — Alt Mode','createdAt',now(),'updatedAt',now()
      ));migrated:=true;
    end if;

    next_roles:='[]'::jsonb;
    for role_item in select value from jsonb_array_elements(roles) loop
      role_name:=lower(coalesce(role_item->>'name',''));role_id:=coalesce(role_item->>'id','');next_role:=role_item;
      if role_name in ('den blocker – ironhide','den blocker - ironhide') then
        robot_mode_id:=role_id||':mode:robot-mode';alt_mode_id:=role_id||':mode:alt-mode';
        next_role:=role_item||jsonb_build_object('tags',private.jsonb_text_union_excluding(role_item->'tags',array['Guard','Reflection','Bulletproof / Passive Immunity','Den Block'],'(robot|alt)[[:space:]]+mode'),'activeAbilityId',guard_id,'passiveAbilityId',bulletproof_id,'roleWideAbilityIds','[]'::jsonb,'modeSelectionPolicy','CHOOSE_BEFORE_ACTION','modes',jsonb_build_array(jsonb_build_object('id',robot_mode_id,'name','Robot Mode','abilityIds',to_jsonb(array_remove(array[guard_id,reflection_id],null)),'passiveAbilityIds',to_jsonb(array_remove(array[bulletproof_id],null)),'sourceText','Robot Mode: Guard, reflection, and protective plates.','sourceLocation','Transformers — Den Blocker – Ironhide — Robot Mode'),jsonb_build_object('id',alt_mode_id,'name','Alt Mode','abilityIds',to_jsonb(array_remove(array[den_block_id],null)),'passiveAbilityIds','[]'::jsonb,'sourceText','Alt Mode: Uses barricades to block the Den. Protective plates are inactive.','sourceLocation','Transformers — Den Blocker – Ironhide — Alt Mode')),'legacyModeAbilityIds',(select coalesce(jsonb_agg(value->>'id'),'[]'::jsonb) from jsonb_array_elements(abilities) where value->>'name' in (select tag.value from jsonb_array_elements_text(coalesce(role_item->'tags','[]'::jsonb)) tag(value)) and value->>'name' ~* '(robot|alt)[[:space:]]+mode'));
        migrated:=true;
      elsif role_name in ('doc – ratchet','doc - ratchet') then
        robot_mode_id:=role_id||':mode:robot-mode';alt_mode_id:=role_id||':mode:alt-mode';
        next_role:=role_item||jsonb_build_object('tags',private.jsonb_text_union_excluding(role_item->'tags',array['Save','Heal','Protect'],'(robot|alt)[[:space:]]+mode'),'activeAbilityId',save_id,'passiveAbilityId','','roleWideAbilityIds','[]'::jsonb,'modeSelectionPolicy','CHOOSE_BEFORE_ACTION','modes',jsonb_build_array(jsonb_build_object('id',robot_mode_id,'name','Robot Mode','abilityIds',to_jsonb(array_remove(array[save_id,heal_id],null)),'passiveAbilityIds','[]'::jsonb,'sourceText','Robot Mode: Save and Heal.','sourceLocation','Transformers — Doc – Ratchet — Robot Mode'),jsonb_build_object('id',alt_mode_id,'name','Alt Mode','abilityIds',to_jsonb(array_remove(array[protect_id],null)),'passiveAbilityIds','[]'::jsonb,'sourceText','Alt Mode: Protect one player.','sourceLocation','Transformers — Doc – Ratchet — Alt Mode')),'legacyModeAbilityIds',(select coalesce(jsonb_agg(value->>'id'),'[]'::jsonb) from jsonb_array_elements(abilities) where value->>'name' in (select tag.value from jsonb_array_elements_text(coalesce(role_item->'tags','[]'::jsonb)) tag(value)) and value->>'name' ~* '(robot|alt)[[:space:]]+mode'));
        migrated:=true;
      elsif role_name in ('ultimate – optimus','ultimate - optimus') then
        robot_mode_id:=role_id||':mode:robot-mode';alt_mode_id:=role_id||':mode:alt-mode';
        next_role:=role_item||jsonb_build_object('tags',private.jsonb_text_union_excluding(role_item->'tags',array['Basic Ask','Protect','Roleblock','Save','Death Immunity','Personal Instant Kill','Super Kill'],'(robot|alt)[[:space:]]+mode'),'activeAbilityId',basic_ask_id,'passiveAbilityId',death_immunity_id,'roleWideAbilityIds',to_jsonb(array_remove(array[instant_kill_id,super_kill_id],null)),'modeSelectionPolicy','CHOOSE_BEFORE_ACTION','modes',jsonb_build_array(jsonb_build_object('id',robot_mode_id,'name','Robot Mode','abilityIds',to_jsonb(array_remove(array[basic_ask_id,protect_id,roleblock_id,save_id],null)),'passiveAbilityIds',to_jsonb(array_remove(array[death_immunity_id],null)),'sourceText','Robot Mode: Basic Ask, Protect, Roleblock, Save, and active kill/conversion immunity.','sourceLocation','Transformers — Ultimate – Optimus — Robot Mode'),jsonb_build_object('id',alt_mode_id,'name','Alt Mode','abilityIds','[]'::jsonb,'passiveAbilityIds','[]'::jsonb,'sourceText','Alt Mode loses night-kill immunity but retains role-wide kill abilities and conversion immunity from source text.','sourceLocation','Transformers — Ultimate – Optimus — Alt Mode')),'legacyModeAbilityIds',(select coalesce(jsonb_agg(value->>'id'),'[]'::jsonb) from jsonb_array_elements(abilities) where value->>'name' in (select tag.value from jsonb_array_elements_text(coalesce(role_item->'tags','[]'::jsonb)) tag(value)) and value->>'name' ~* '(robot|alt)[[:space:]]+mode'));
        migrated:=true;
      end if;
      next_roles:=next_roles||jsonb_build_array(next_role);
    end loop;

    next_abilities:='[]'::jsonb;
    for ability_item in select value from jsonb_array_elements(abilities) loop
      next_ability:=ability_item;
      if ability_item->>'name' ~* '(robot|alt)[[:space:]]+mode' and exists(select 1 from jsonb_array_elements(roles) role cross join lateral jsonb_array_elements_text(coalesce(role->'tags','[]'::jsonb)) tag(value) where tag.value=ability_item->>'name' and lower(ability_item->>'name') like lower(role->>'name')||'%') then
        next_ability:=ability_item||jsonb_build_object('recordType','MODE_CONTEXT','modeContextOnly',true,'selectableAsAction',false,'legacyRecordPreserved',true,'migrationNote','Relinked to Role → Mode → Ability in v11.7; retained for audit and import history.');migrated:=true;
      end if;
      next_abilities:=next_abilities||jsonb_build_array(next_ability);
    end loop;

    next_players:='[]'::jsonb;
    for player_item in select value from jsonb_array_elements(players) loop
      next_player:=player_item;
      if nullif(player_item->>'currentModeId','') is null then
        select lower(role->>'name'),role->>'id' into player_role_name,role_id from jsonb_array_elements(next_roles) role where role->>'id'=player_item->>'roleId' limit 1;
        if player_role_name in ('den blocker – ironhide','den blocker - ironhide','doc – ratchet','doc - ratchet','ultimate – optimus','ultimate - optimus') then next_player:=player_item||jsonb_build_object('currentModeId',role_id||':mode:robot-mode');migrated:=true; end if;
      end if;
      next_players:=next_players||jsonb_build_array(next_player);
    end loop;

    if migrated then
      doc:=jsonb_set(jsonb_set(jsonb_set(doc,'{data,abilities}',next_abilities,false),'{data,roles}',next_roles,false),'{data,players}',next_players,false);
      doc:=jsonb_set(doc,'{data,history}',coalesce(doc#>'{data,history}','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'gameId',stored.game_id::text,'type','MIGRATION','entityId','multi-mode-action-context-v11.7','message','Relinked preserved mode placeholders into Role → Mode → Ability context. No role, ability, player, action, or comment was deleted.','timestamp',now())),true);
      update public.game_documents set document=doc,version=version+1,updated_at=now() where game_id=stored.game_id;
    end if;
  end loop;
end$$;

create or replace function private.validate_player_action_mode_context(target_game_id uuid,target_action jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc jsonb;player_record jsonb;role_record jsonb;ability_record jsonb;mode_record jsonb;mode_id text;ability_id text;player_id text;current_mode_id text;override_reason text;role_wide boolean:=false;mode_owns boolean:=false;grant_owns boolean:=false;mode_access boolean:=false;
begin
  if upper(coalesce(target_action->>'sourceType','PLAYER'))<>'PLAYER' then return '{}'::jsonb; end if;
  select document into doc from public.game_documents where game_id=target_game_id;if doc is null then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  player_id:=coalesce(target_action->>'sourcePlayerId',target_action->>'actorId','');ability_id:=coalesce(target_action->>'abilityId','');mode_id:=coalesce(target_action->>'modeId','');override_reason:=btrim(coalesce(target_action->>'overrideReason',''));
  select value into player_record from jsonb_array_elements(coalesce(doc#>'{data,players}','[]'::jsonb)) where value->>'id'=player_id limit 1;
  select value into role_record from jsonb_array_elements(coalesce(doc#>'{data,roles}','[]'::jsonb)) where value->>'id'=player_record->>'roleId' limit 1;
  select value into ability_record from jsonb_array_elements(coalesce(doc#>'{data,abilities}','[]'::jsonb)) where value->>'id'=ability_id limit 1;
  if ability_record is null then raise exception using errcode='23503',message='ABILITY_NOT_FOUND'; end if;
  if mode_id=ability_id or coalesce(nullif(ability_record->>'selectableAsAction','')::boolean,true)=false or coalesce(nullif(ability_record->>'modeContextOnly','')::boolean,false) or upper(coalesce(ability_record->>'recordType',''))='MODE_CONTEXT' then raise exception using errcode='22023',message='MODE_IS_NOT_AN_ACTION'; end if;
  if jsonb_array_length(coalesce(role_record->'modes','[]'::jsonb))=0 then return '{}'::jsonb; end if;
  if mode_id='' then raise exception using errcode='22023',message='MODE_CONTEXT_REQUIRED'; end if;
  select value into mode_record from jsonb_array_elements(coalesce(role_record->'modes','[]'::jsonb)) where value->>'id'=mode_id limit 1;
  if mode_record is null then raise exception using errcode='23503',message='MODE_NOT_FOUND'; end if;
  select exists(select 1 from jsonb_array_elements_text(coalesce(role_record->'roleWideAbilityIds','[]'::jsonb)) allowed(value) where allowed.value=ability_id) into role_wide;
  select exists(select 1 from jsonb_array_elements_text(coalesce(mode_record->'abilityIds','[]'::jsonb)||coalesce(mode_record->'passiveAbilityIds','[]'::jsonb)) allowed(value) where allowed.value=ability_id) into mode_owns;
  select exists(select 1 from public.player_ability_grants grant_source where grant_source.game_id=target_game_id and grant_source.player_id=player_id and grant_source.ability_id=ability_id and grant_source.status='ACTIVE') into grant_owns;
  if not role_wide and not mode_owns and not grant_owns and override_reason='' then raise exception using errcode='42501',message='ABILITY_NOT_AVAILABLE_IN_MODE'; end if;
  current_mode_id:=coalesce(player_record->>'currentModeId',player_record->>'current_mode_id','');
  mode_access:=current_mode_id='' or current_mode_id=mode_id or upper(coalesce(role_record->>'modeSelectionPolicy','CURRENT_ONLY'))='CHOOSE_BEFORE_ACTION';
  if not mode_access then
    select exists(
      select 1 from public.player_status_effects effect cross join lateral jsonb_array_elements_text(coalesce(effect.metadata->'modeIds',effect.metadata->'mode_ids',effect.metadata->'modeAccessIds',effect.metadata->'mode_access_ids','[]'::jsonb)) allowed(value)
      where effect.game_id=target_game_id and effect.player_id=player_id and effect.state='ACTIVE' and allowed.value=mode_id
      union all
      select 1 from public.player_ability_grants grant_source cross join lateral jsonb_array_elements_text(coalesce(grant_source.special_conditions->'modeIds',grant_source.special_conditions->'mode_ids',grant_source.metadata->'modeIds',grant_source.metadata->'mode_ids','[]'::jsonb)) allowed(value)
      where grant_source.game_id=target_game_id and grant_source.player_id=player_id and grant_source.status='ACTIVE' and allowed.value=mode_id
    ) into mode_access;
  end if;
  if not mode_access and override_reason='' then raise exception using errcode='42501',message='INACTIVE_MODE'; end if;
  return jsonb_build_object('modeId',mode_id,'modeName',mode_record->>'name','currentModeId',nullif(current_mode_id,''),'temporaryAccess',current_mode_id<>mode_id and upper(coalesce(role_record->>'modeSelectionPolicy','CURRENT_ONLY'))<>'CHOOSE_BEFORE_ACTION');
end$$;

create or replace function private.queue_player_action(target_game_id uuid,expected_game_version integer,target_action jsonb,target_replace_action_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row public.game_phases%rowtype;updated_row public.game_phases%rowtype;result jsonb;phase_actions jsonb;requested_phase_id uuid;requested_phase_version integer;mode_context jsonb;patched_document jsonb;patched_actions jsonb;saved record;
begin
  if (select auth.uid()) is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  begin requested_phase_id:=(target_action->>'phaseId')::uuid;requested_phase_version:=(target_action->>'phaseVersion')::integer;exception when others then raise exception using errcode='22023',message='PHASE_CONTEXT_REQUIRED'; end;
  select * into current_row from public.game_phases phase_row where phase_row.game_id=target_game_id and phase_row.status='CURRENT' for update;
  if not found or current_row.id<>requested_phase_id then raise exception using errcode='40001',message='PHASE_CHANGED'; end if;
  if current_row.queue_version<>requested_phase_version then raise exception using errcode='40001',message='PHASE_VERSION_CONFLICT'; end if;
  if (select game.status from public.games game where game.id=target_game_id)<>'ACTIVE' then raise exception using errcode='55000',message='GAME_NOT_ACTIVE'; end if;
  mode_context:=private.validate_player_action_mode_context(target_game_id,target_action);
  result:=private.queue_player_action_document_v11_2(target_game_id,expected_game_version,target_action,target_replace_action_id);
  if mode_context<>'{}'::jsonb then
    result:=jsonb_set(result,'{action}',(result->'action')||jsonb_build_object('modeId',mode_context->>'modeId','modeName',mode_context->>'modeName','modeContext',mode_context),false);
    select coalesce(jsonb_agg(case when item->>'id'=result#>>'{action,id}' then item||jsonb_build_object('modeId',mode_context->>'modeId','modeName',mode_context->>'modeName','modeContext',mode_context) else item end order by ordinality),'[]'::jsonb) into patched_actions from jsonb_array_elements(coalesce(result#>'{document,data,actions}','[]'::jsonb)) with ordinality queued(item,ordinality);
    patched_document:=jsonb_set(result->'document','{data,actions}',patched_actions,false);
    select * into saved from public.save_game_document(target_game_id,(result->>'version')::integer,patched_document,'Mode context attached to queued ability','action',result#>>'{action,id}') limit 1;
    result:=result||jsonb_build_object('document',saved.document,'version',saved.version,'updated_at',saved.updated_at,'updated_by',saved.updated_by);
  end if;
  select coalesce(jsonb_agg(item||jsonb_build_object('phaseId',current_row.id,'phaseVersion',current_row.queue_version+1) order by ordinality),'[]'::jsonb) into phase_actions from jsonb_array_elements(coalesce(result#>'{document,data,actions}','[]'::jsonb)) with ordinality queued(item,ordinality);
  update public.game_phases phase_row set action_queue=phase_actions,queue_version=phase_row.queue_version+1,updated_at=now() where phase_row.id=current_row.id returning * into updated_row;
  insert into public.game_phase_events(game_id,phase_id,event_type,action_id,summary,payload,actor_user_id) values(target_game_id,current_row.id,case when target_replace_action_id is null then 'ACTION_QUEUED' else 'ACTION_EDITED' end,result#>>'{action,id}',coalesce(result#>>'{action,name}','Structured action')||case when target_replace_action_id is null then ' queued.' else ' edited.' end,jsonb_build_object('phaseVersion',updated_row.queue_version,'action',result->'action'),auth.uid());
  return result||jsonb_build_object('phase',to_jsonb(updated_row),'document',jsonb_set(result->'document','{data,actions}',phase_actions,false));
end$$;

revoke all on function private.jsonb_text_union_excluding(jsonb,text[],text),private.validate_player_action_mode_context(uuid,jsonb),private.queue_player_action(uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
comment on function private.validate_player_action_mode_context(uuid,jsonb) is 'Validates mode context separately from the actual selectable ability ID.';
comment on function private.queue_player_action(uuid,integer,jsonb,text) is 'Integrated phase queue with v11.7 multi-mode context validation.';
