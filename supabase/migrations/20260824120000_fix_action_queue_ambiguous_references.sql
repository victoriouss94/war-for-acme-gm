-- Fix PL/pgSQL variable/column collisions in the structured action queue.
-- The original function declared player_id and ability_id locals, then used those
-- names in SQL statements against tables with matching column names.

create or replace function private.queue_player_action(target_game_id uuid,expected_game_version integer,target_action jsonb,target_replace_action_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());stored public.game_documents%rowtype;player_record jsonb;role_record jsonb;ability_record jsonb;effective_ability_record jsonb;grant_record public.player_ability_grants%rowtype;action_value jsonb;actions jsonb;source_type text;action_player_id text;action_ability_id text;effective_ability_id text;grant_id uuid;current_cycle integer;current_phase text;target_type text;target_ids text[];target_id text;target_record jsonb;override_reason text;ownership boolean:=false;uses_before integer;queued_count integer:=0;role_limit integer;role_consumed integer:=0;cooldown_cycles integer:=0;last_consumed_cycle integer;actor_faction_id text;target_faction_id text;warnings jsonb:='[]'::jsonb;saved record;
begin
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if jsonb_typeof(target_action)<>'object' or octet_length(target_action::text)>50000 then raise exception using errcode='22023',message='INVALID_ACTION'; end if;
  select * into stored from public.game_documents where game_id=target_game_id for update;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  if stored.version<>expected_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  source_type:=upper(coalesce(target_action->>'sourceType','PLAYER'));action_player_id:=coalesce(target_action->>'sourcePlayerId',target_action->>'actorId','');action_ability_id:=coalesce(target_action->>'abilityId','');effective_ability_id:=coalesce(nullif(target_action->>'effectiveAbilityId',''),action_ability_id);override_reason:=btrim(coalesce(target_action->>'overrideReason',''));
  if source_type not in ('PLAYER','FACTION','GM_MANUAL','SYSTEM') then raise exception using errcode='22023',message='INVALID_ACTION_SOURCE'; end if;
  if source_type='FACTION' and not exists(select 1 from jsonb_array_elements(stored.document#>'{data,factions}') faction where faction->>'id'=(target_action->>'sourceFactionId')) then raise exception using errcode='23503',message='SOURCE_FACTION_NOT_FOUND'; end if;
  select value into ability_record from jsonb_array_elements(stored.document#>'{data,abilities}') where value->>'id'=action_ability_id limit 1;
  if ability_record is null then raise exception using errcode='23503',message='ABILITY_NOT_FOUND'; end if;
  select value into effective_ability_record from jsonb_array_elements(stored.document#>'{data,abilities}') where value->>'id'=effective_ability_id limit 1;
  if effective_ability_record is null then raise exception using errcode='23503',message='EFFECTIVE_ABILITY_NOT_FOUND'; end if;
  current_cycle:=greatest(0,coalesce(nullif(stored.document#>>'{game,currentDay}','')::integer,0));current_phase:=coalesce(stored.document#>>'{game,currentPhase}','Any');
  if source_type='PLAYER' then
    select value into player_record from jsonb_array_elements(stored.document#>'{data,players}') where value->>'id'=action_player_id limit 1;
    if player_record is null then raise exception using errcode='23503',message='PLAYER_NOT_FOUND'; end if;
    select value into role_record from jsonb_array_elements(stored.document#>'{data,roles}') where value->>'id'=player_record->>'roleId' limit 1;
    if nullif(target_action->>'playerAbilityGrantId','') is not null then
      grant_id:=(target_action->>'playerAbilityGrantId')::uuid;select * into grant_record from public.player_ability_grants where id=grant_id for update;
      if not found or grant_record.game_id<>target_game_id or grant_record.player_id<>action_player_id or grant_record.ability_id<>action_ability_id or not private.grant_is_current(grant_record,current_cycle,current_phase) then raise exception using errcode='42501',message='ABILITY_GRANT_NOT_AVAILABLE'; end if;
      if nullif(target_action->>'grantVersion','') is not null and grant_record.version<>(target_action->>'grantVersion')::integer then raise exception using errcode='40001',message='GRANT_VERSION_CONFLICT'; end if;
      select count(*) into queued_count from jsonb_array_elements(coalesce(stored.document#>'{data,actions}','[]'::jsonb)) action where action->>'playerAbilityGrantId'=grant_id::text and action->>'id' is distinct from target_replace_action_id;
      if grant_record.uses_remaining is not null and queued_count>=grant_record.uses_remaining and override_reason='' then raise exception using errcode='22023',message='GRANT_USES_ALREADY_QUEUED'; end if;
      ownership:=true;uses_before:=grant_record.uses_remaining;
      if cardinality(grant_record.phase_restrictions)>0 and not ('Any'=any(grant_record.phase_restrictions)) and not (current_phase=any(grant_record.phase_restrictions)) and override_reason='' then raise exception using errcode='22023',message='GRANT_PHASE_RESTRICTION'; end if;
    elsif private.role_owns_ability(role_record,ability_record) then
      ownership:=true;role_limit:=nullif(role_record->>'abilityUses','')::integer;
      if role_limit is not null then
        select count(*) into role_consumed from public.resolution_session_events event join public.resolution_sessions session on session.id=event.session_id where event.game_id=target_game_id and event.actor_player_id=action_player_id and event.ability_id=action_ability_id and event.event_type='ABILITY_CONSUMED';
        select count(*) into queued_count from jsonb_array_elements(coalesce(stored.document#>'{data,actions}','[]'::jsonb)) action where coalesce(action->>'sourcePlayerId',action->>'actorId')=action_player_id and action->>'abilityId'=action_ability_id and nullif(action->>'playerAbilityGrantId','') is null and action->>'id' is distinct from target_replace_action_id;
        uses_before:=greatest(0,role_limit-role_consumed);if queued_count>=uses_before and override_reason='' then raise exception using errcode='22023',message='ROLE_ABILITY_USES_ALREADY_QUEUED'; end if;
      end if;
    end if;
    if not ownership and override_reason='' then raise exception using errcode='42501',message='PLAYER_DOES_NOT_OWN_ABILITY'; end if;
    if effective_ability_id<>action_ability_id and not exists(select 1 from public.player_status_effects effect where effect.game_id=target_game_id and effect.player_id=action_player_id and effect.state='ACTIVE' and effect.status_type='ABILITY_AMPLIFY' and coalesce(effect.metadata->>'baseAbilityId',action_ability_id)=action_ability_id and coalesce(effect.metadata->>'effectiveAbilityId',effect.metadata->>'amplifiedAbilityId')=effective_ability_id) and override_reason='' then raise exception using errcode='42501',message='EFFECTIVE_ABILITY_NOT_AUTHORIZED'; end if;
    if coalesce(ability_record->>'phase','Any')='Passive' and coalesce(nullif(ability_record#>>'{targeting,manuallyTriggerable}','')::boolean,false)=false and override_reason='' then raise exception using errcode='22023',message='PASSIVE_NOT_MANUALLY_SELECTABLE'; end if;
    if coalesce(ability_record->>'phase','Any') not in ('Any','Passive',current_phase) and override_reason='' then raise exception using errcode='22023',message='ABILITY_WRONG_PHASE'; end if;
    cooldown_cycles:=greatest(0,coalesce(nullif(ability_record->>'cooldownCycles','')::integer,0));
    if cooldown_cycles>0 then select max(session.cycle) into last_consumed_cycle from public.resolution_session_events event join public.resolution_sessions session on session.id=event.session_id where event.game_id=target_game_id and event.actor_player_id=action_player_id and event.ability_id=action_ability_id and event.event_type='ABILITY_CONSUMED';if last_consumed_cycle is not null and current_cycle<last_consumed_cycle+cooldown_cycles and override_reason='' then raise exception using errcode='22023',message='ABILITY_ON_COOLDOWN'; end if;end if;
    select coalesce(jsonb_agg(status_name),'[]'::jsonb) into warnings from (select effect.status_name from public.player_status_effects effect where effect.game_id=target_game_id and effect.player_id=action_player_id and effect.state='ACTIVE' and effect.status_type in ('ROLEBLOCK','MARK','POISON','DRUNK','SILENCED','ACTION_SUCCESS_GUARANTEE','ABILITY_AMPLIFY','ADDITIONAL_USES') order by effect.created_at) current_warnings;
  elsif override_reason='' then raise exception using errcode='22023',message='GM_OVERRIDE_REASON_REQUIRED'; end if;
  if override_reason<>'' and char_length(override_reason)<3 then raise exception using errcode='22023',message='GM_OVERRIDE_REASON_REQUIRED'; end if;
  target_type:=upper(coalesce(ability_record#>>'{targeting,type}',target_action->>'targetType','ONE_PLAYER'));
  if target_type not in ('ONE_PLAYER','MULTIPLE_PLAYERS','SELF','NO_TARGET','DEAD_PLAYER','ABILITY','FACTION','CUSTOM_TARGET','OTHER') then target_type:='ONE_PLAYER'; end if;
  select coalesce(array_agg(value),'{}') into target_ids from jsonb_array_elements_text(coalesce(target_action->'targetIds','[]'::jsonb));
  if target_type in ('ONE_PLAYER','DEAD_PLAYER','SELF') and cardinality(target_ids)<>1 then raise exception using errcode='22023',message='ONE_TARGET_REQUIRED'; end if;
  if target_type='NO_TARGET' and cardinality(target_ids)<>0 then raise exception using errcode='22023',message='TARGET_NOT_ALLOWED'; end if;
  if target_type='MULTIPLE_PLAYERS' and cardinality(target_ids)<greatest(1,coalesce(nullif(ability_record#>>'{targeting,minTargets}','')::integer,1)) then raise exception using errcode='22023',message='NOT_ENOUGH_TARGETS'; end if;
  if target_type='MULTIPLE_PLAYERS' and cardinality(target_ids)>coalesce(nullif(ability_record#>>'{targeting,maxTargets}','')::integer,1000) then raise exception using errcode='22023',message='TOO_MANY_TARGETS'; end if;
  if target_type='ABILITY' and not exists(select 1 from jsonb_array_elements(stored.document#>'{data,abilities}') target_ability where target_ability->>'id'=(target_action#>>'{parameters,targetAbilityId}')) then raise exception using errcode='23503',message='TARGET_ABILITY_NOT_FOUND'; end if;
  if target_type='FACTION' and not exists(select 1 from jsonb_array_elements(stored.document#>'{data,factions}') faction where faction->>'id'=(target_action#>>'{parameters,targetFactionId}')) then raise exception using errcode='22023',message='TARGET_FACTION_REQUIRED'; end if;
  if target_type in ('CUSTOM_TARGET','OTHER') and nullif(btrim((target_action#>>'{parameters,customTarget}')),'') is null then raise exception using errcode='22023',message='CUSTOM_TARGET_REQUIRED'; end if;
  foreach target_id in array target_ids loop
    select value into target_record from jsonb_array_elements(stored.document#>'{data,players}') where value->>'id'=target_id limit 1;if target_record is null then raise exception using errcode='23503',message='TARGET_NOT_FOUND'; end if;
    if target_type='SELF' and target_id<>action_player_id then raise exception using errcode='22023',message='SELF_TARGET_REQUIRED'; end if;
    if target_type='DEAD_PLAYER' and coalesce(nullif(target_record->>'alive','')::boolean,true) then raise exception using errcode='22023',message='DEAD_TARGET_REQUIRED'; end if;
    if coalesce(nullif(ability_record#>>'{targeting,deadOnly}','')::boolean,false) and coalesce(nullif(target_record->>'alive','')::boolean,true) then raise exception using errcode='22023',message='DEAD_TARGET_REQUIRED'; end if;
    if coalesce(nullif(ability_record#>>'{targeting,livingOnly}','')::boolean,false) and not coalesce(nullif(target_record->>'alive','')::boolean,true) then raise exception using errcode='22023',message='LIVING_TARGET_REQUIRED'; end if;
    if (coalesce(nullif(ability_record#>>'{targeting,selfProhibited}','')::boolean,false) or coalesce(nullif(ability_record#>>'{targeting,selfAllowed}','')::boolean,true)=false) and target_id=action_player_id then raise exception using errcode='22023',message='SELF_TARGET_PROHIBITED'; end if;
    actor_faction_id:=coalesce(nullif(player_record->>'currentFactionId',''),nullif(player_record->>'factionId',''),nullif(role_record->>'factionId',''));target_faction_id:=coalesce(nullif(target_record->>'currentFactionId',''),nullif(target_record->>'factionId',''),(select value->>'factionId' from jsonb_array_elements(stored.document#>'{data,roles}') where value->>'id'=target_record->>'roleId' limit 1));
    if coalesce(nullif(ability_record#>>'{targeting,factionMemberOnly}','')::boolean,false) and target_faction_id is distinct from actor_faction_id then raise exception using errcode='22023',message='FACTION_MEMBER_TARGET_REQUIRED'; end if;
    if coalesce(nullif(ability_record#>>'{targeting,nonFactionMemberOnly}','')::boolean,false) and target_faction_id is not distinct from actor_faction_id then raise exception using errcode='22023',message='NON_FACTION_TARGET_REQUIRED'; end if;
  end loop;
  action_value:=jsonb_strip_nulls(jsonb_build_object('id',coalesce(nullif(target_action->>'id',''),gen_random_uuid()::text),'gameId',target_game_id::text,'cycle',current_cycle,'phase',current_phase,'sourceType',source_type,'actorId',nullif(action_player_id,''),'sourcePlayerId',nullif(action_player_id,''),'sourceFactionId',nullif(target_action->>'sourceFactionId',''),'roleId',nullif(player_record->>'roleId',''),'abilityId',action_ability_id,'playerAbilityGrantId',case when grant_id is null then null else grant_id::text end,'grantVersion',case when grant_id is null then null else grant_record.version end,'abilitySource',coalesce(nullif(target_action->>'abilitySource',''),case when grant_id is null then case when source_type='PLAYER' then 'ROLE' else source_type end else grant_record.source_type end),'baseAbilityId',action_ability_id,'effectiveAbilityId',effective_ability_id,'name',coalesce(effective_ability_record->>'name',ability_record->>'name'),'category',coalesce(effective_ability_record->>'category',ability_record->>'category','Other'),'targetType',target_type,'targetId',target_ids[1],'targetIds',to_jsonb(target_ids),'parameters',coalesce(target_action->'parameters','{}'::jsonb),'submittedBy',actor,'submittedAt',now(),'validationState',case when override_reason='' then 'VALID' else 'GM_OVERRIDE' end,'status','ATTEMPTED','usesBefore',uses_before,'activeWarnings',warnings,'gmOverride',override_reason<>'','overrideReason',nullif(override_reason,'')));
  actions:=coalesce(stored.document#>'{data,actions}','[]'::jsonb);
  if target_replace_action_id is null then
    if exists(select 1 from jsonb_array_elements(actions) action where action->>'id'=action_value->>'id') then raise exception using errcode='23505',message='DUPLICATE_ACTION_ID'; end if;actions:=actions||jsonb_build_array(action_value);
  else
    if not exists(select 1 from jsonb_array_elements(actions) action where action->>'id'=target_replace_action_id) then raise exception using errcode='P0002',message='ACTION_NOT_FOUND'; end if;
    select jsonb_agg(case when action->>'id'=target_replace_action_id then action_value else action end order by ordinality) into actions from jsonb_array_elements(actions) with ordinality queued(action,ordinality);
  end if;
  select * into saved from public.save_game_document(target_game_id,stored.version,jsonb_set(stored.document,'{data,actions}',actions,false),case when target_replace_action_id is null then 'Structured action queued' else 'Queued action edited' end,'action',action_value->>'id') limit 1;
  return jsonb_build_object('action',action_value,'document',saved.document,'version',saved.version,'updated_at',saved.updated_at,'updated_by',saved.updated_by);
end$$;
