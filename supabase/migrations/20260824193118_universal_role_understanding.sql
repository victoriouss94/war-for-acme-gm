-- GM Command Center v11.4: source-first role mechanics, first-class faction/global
-- actions, mechanics review, and action-id-deduplicated usage statistics.
-- This migration is additive. Existing game documents and historical events remain.

alter table public.resolution_session_events
  drop constraint if exists resolution_session_events_event_type_check;
alter table public.resolution_session_events
  add constraint resolution_session_events_event_type_check check (event_type in (
    'SUCCESS','FAILURE','BLOCK','INELIGIBLE_EFFECT','CANCELLED','REDIRECT','REFLECT','TRANSFER',
    'PASSIVE_TRIGGER','PASSIVE_PREVENTED','PROTECTION_USED','DEATH','SURVIVAL','CONVERSION',
    'STATUS_ADDED','STATUS_REMOVED','ABILITY_CONSUMED','USE_REFUNDED','STATE_CHANGE','OTHER'
  ));

create index if not exists resolution_session_events_game_ability_actor_type_idx
  on public.resolution_session_events(game_id,ability_id,actor_player_id,event_type)
  where ability_id is not null;
create index if not exists player_ability_grants_game_ability_player_active_idx
  on public.player_ability_grants(game_id,ability_id,player_id)
  where status='ACTIVE';

-- Preserve the established phase controller wrapper. Replace only its document
-- validator so faction actions and soft eligibility are understood server-side.
create or replace function private.queue_player_action_document_v11_2(target_game_id uuid,expected_game_version integer,target_action jsonb,target_replace_action_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=(select auth.uid());stored public.game_documents%rowtype;player_record jsonb;role_record jsonb;ability_record jsonb;effective_ability_record jsonb;grant_record public.player_ability_grants%rowtype;action_value jsonb;actions jsonb;source_type text;player_id text;ability_id text;effective_ability_id text;grant_id uuid;current_cycle integer;current_phase text;target_type text;target_ids text[];target_id text;target_record jsonb;override_reason text;ownership boolean:=false;uses_before integer;queued_count integer:=0;role_limit integer;role_consumed integer:=0;cooldown_cycles integer:=0;last_consumed_cycle integer;actor_faction_id text;target_faction_id text;source_faction_id text;selection_rule_type text;performer_required boolean:=false;eligible_performer_count integer:=0;warnings jsonb:='[]'::jsonb;saved record;
begin
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if jsonb_typeof(target_action)<>'object' or octet_length(target_action::text)>50000 then raise exception using errcode='22023',message='INVALID_ACTION'; end if;
  select * into stored from public.game_documents where game_id=target_game_id for update;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  if stored.version<>expected_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  source_type:=upper(coalesce(target_action->>'sourceType','PLAYER'));player_id:=coalesce(target_action->>'sourcePlayerId',target_action->>'actorId','');source_faction_id:=coalesce(target_action->>'sourceFactionId','');ability_id:=coalesce(target_action->>'abilityId','');effective_ability_id:=coalesce(nullif(target_action->>'effectiveAbilityId',''),ability_id);override_reason:=btrim(coalesce(target_action->>'overrideReason',''));
  if source_type not in ('PLAYER','FACTION','GM_MANUAL','SYSTEM') then raise exception using errcode='22023',message='INVALID_ACTION_SOURCE'; end if;
  if source_type='FACTION' and not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,factions}','[]'::jsonb)) faction where faction->>'id'=source_faction_id) then raise exception using errcode='23503',message='SOURCE_FACTION_NOT_FOUND'; end if;
  select value into ability_record from jsonb_array_elements(coalesce(stored.document#>'{data,abilities}','[]'::jsonb)) where value->>'id'=ability_id limit 1;
  if ability_record is null then raise exception using errcode='23503',message='ABILITY_NOT_FOUND'; end if;
  select value into effective_ability_record from jsonb_array_elements(coalesce(stored.document#>'{data,abilities}','[]'::jsonb)) where value->>'id'=effective_ability_id limit 1;
  if effective_ability_record is null then raise exception using errcode='23503',message='EFFECTIVE_ABILITY_NOT_FOUND'; end if;
  current_cycle:=greatest(0,coalesce(nullif(stored.document#>>'{game,currentDay}','')::integer,0));current_phase:=coalesce(stored.document#>>'{game,currentPhase}','Any');
  if source_type='PLAYER' then
    select value into player_record from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) where value->>'id'=player_id limit 1;
    if player_record is null then raise exception using errcode='23503',message='PLAYER_NOT_FOUND'; end if;
    select value into role_record from jsonb_array_elements(coalesce(stored.document#>'{data,roles}','[]'::jsonb)) where value->>'id'=player_record->>'roleId' limit 1;
    if nullif(target_action->>'playerAbilityGrantId','') is not null then
      grant_id:=(target_action->>'playerAbilityGrantId')::uuid;select * into grant_record from public.player_ability_grants where id=grant_id for update;
      if not found or grant_record.game_id<>target_game_id or grant_record.player_id<>player_id or grant_record.ability_id<>ability_id or not private.grant_is_current(grant_record,current_cycle,current_phase) then raise exception using errcode='42501',message='ABILITY_GRANT_NOT_AVAILABLE'; end if;
      if nullif(target_action->>'grantVersion','') is not null and grant_record.version<>(target_action->>'grantVersion')::integer then raise exception using errcode='40001',message='GRANT_VERSION_CONFLICT'; end if;
      select count(*) into queued_count from jsonb_array_elements(coalesce(stored.document#>'{data,actions}','[]'::jsonb)) action where action->>'playerAbilityGrantId'=grant_id::text and action->>'id' is distinct from target_replace_action_id;
      if grant_record.uses_remaining is not null and queued_count>=grant_record.uses_remaining and override_reason='' then raise exception using errcode='22023',message='GRANT_USES_ALREADY_QUEUED'; end if;
      ownership:=true;uses_before:=grant_record.uses_remaining;
      if cardinality(grant_record.phase_restrictions)>0 and not ('Any'=any(grant_record.phase_restrictions)) and not (current_phase=any(grant_record.phase_restrictions)) and override_reason='' then raise exception using errcode='22023',message='GRANT_PHASE_RESTRICTION'; end if;
    elsif private.role_owns_ability(role_record,ability_record) then
      ownership:=true;role_limit:=nullif(role_record->>'abilityUses','')::integer;
      if role_limit is not null then
        select count(*) into role_consumed from public.resolution_session_events event join public.resolution_sessions session on session.id=event.session_id where event.game_id=target_game_id and event.actor_player_id=player_id and event.ability_id=ability_id and event.event_type='ABILITY_CONSUMED';
        select count(*) into queued_count from jsonb_array_elements(coalesce(stored.document#>'{data,actions}','[]'::jsonb)) action where coalesce(action->>'sourcePlayerId',action->>'actorId')=player_id and action->>'abilityId'=ability_id and nullif(action->>'playerAbilityGrantId','') is null and action->>'id' is distinct from target_replace_action_id;
        uses_before:=greatest(0,role_limit-role_consumed);if queued_count>=uses_before and override_reason='' then raise exception using errcode='22023',message='ROLE_ABILITY_USES_ALREADY_QUEUED'; end if;
      end if;
    end if;
    if not ownership and override_reason='' then raise exception using errcode='42501',message='PLAYER_DOES_NOT_OWN_ABILITY'; end if;
    if effective_ability_id<>ability_id and not exists(select 1 from public.player_status_effects effect where effect.game_id=target_game_id and effect.player_id=player_id and effect.state='ACTIVE' and effect.status_type='ABILITY_AMPLIFY' and coalesce(effect.metadata->>'baseAbilityId',ability_id)=ability_id and coalesce(effect.metadata->>'effectiveAbilityId',effect.metadata->>'amplifiedAbilityId')=effective_ability_id) and override_reason='' then raise exception using errcode='42501',message='EFFECTIVE_ABILITY_NOT_AUTHORIZED'; end if;
    if coalesce(effective_ability_record->>'phase','Any')='Passive' and coalesce(nullif(effective_ability_record#>>'{understanding,targeting,manuallyTriggerable}','')::boolean,nullif(effective_ability_record#>>'{targeting,manuallyTriggerable}','')::boolean,false)=false and override_reason='' then raise exception using errcode='22023',message='PASSIVE_NOT_MANUALLY_SELECTABLE'; end if;
    if coalesce(effective_ability_record->>'phase','Any') not in ('Any','Passive',current_phase) and override_reason='' then raise exception using errcode='22023',message='ABILITY_WRONG_PHASE'; end if;
    cooldown_cycles:=greatest(0,coalesce(nullif(effective_ability_record->>'cooldownCycles','')::integer,0));
    if cooldown_cycles>0 then select max(session.cycle) into last_consumed_cycle from public.resolution_session_events event join public.resolution_sessions session on session.id=event.session_id where event.game_id=target_game_id and event.actor_player_id=player_id and event.ability_id=ability_id and event.event_type='ABILITY_CONSUMED';if last_consumed_cycle is not null and current_cycle<last_consumed_cycle+cooldown_cycles and override_reason='' then raise exception using errcode='22023',message='ABILITY_ON_COOLDOWN'; end if;end if;
    select coalesce(jsonb_agg(status_name),'[]'::jsonb) into warnings from (select effect.status_name from public.player_status_effects effect where effect.game_id=target_game_id and effect.player_id=player_id and effect.state='ACTIVE' and effect.status_type in ('ROLEBLOCK','MARK','POISON','DRUNK','SILENCED','ACTION_SUCCESS_GUARANTEE','ABILITY_AMPLIFY','ADDITIONAL_USES') order by effect.created_at) current_warnings;
  elsif source_type='FACTION' then
    if coalesce(nullif(ability_record#>>'{understanding,factionAction}','')::boolean,false)=false
      and not exists(select 1 from jsonb_array_elements(coalesce(ability_record#>'{understanding,mechanics}','[]'::jsonb)) mechanic where upper(coalesce(mechanic->>'type','')) in ('FACTION_EFFECT','FACTION_BLOCK','FACTION_RULE') or coalesce(nullif(mechanic->>'factionAction','')::boolean,false))
    then raise exception using errcode='42501',message='FACTION_ACTION_NOT_SOURCE_DEFINED'; end if;
    if jsonb_array_length(coalesce(ability_record#>'{understanding,sourceFactionIds}','[]'::jsonb))>0 and not exists(select 1 from jsonb_array_elements_text(ability_record#>'{understanding,sourceFactionIds}') allowed(value) where allowed.value=source_faction_id) then raise exception using errcode='42501',message='FACTION_ACTION_NOT_AUTHORIZED'; end if;
    performer_required:=coalesce(nullif(ability_record#>>'{understanding,performerRequired}','')::boolean,false);
    if performer_required then
      select count(*) into eligible_performer_count from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) candidate
      where coalesce(nullif(candidate->>'alive','')::boolean,true)
        and coalesce(nullif(candidate->>'currentFactionId',''),nullif(candidate->>'factionId',''),(select role->>'factionId' from jsonb_array_elements(coalesce(stored.document#>'{data,roles}','[]'::jsonb)) role where role->>'id'=candidate->>'roleId' limit 1))=source_faction_id
        and not exists(select 1 from public.player_status_effects effect where effect.game_id=target_game_id and effect.player_id=candidate->>'id' and effect.state='ACTIVE' and effect.status_type in ('DEN_BLOCKED','FACTION_ACTION_BLOCKED'));
      if eligible_performer_count=0 then raise exception using errcode='55000',message='NO_ELIGIBLE_FACTION_PERFORMER'; end if;
    end if;
  elsif override_reason='' then raise exception using errcode='22023',message='GM_OVERRIDE_REASON_REQUIRED'; end if;
  if override_reason<>'' and char_length(override_reason)<3 then raise exception using errcode='22023',message='GM_OVERRIDE_REASON_REQUIRED'; end if;
  target_type:=upper(coalesce(effective_ability_record#>>'{understanding,targeting,type}',effective_ability_record#>>'{targeting,type}',target_action->>'targetType','ONE_PLAYER'));
  if target_type not in ('ONE_PLAYER','MULTIPLE_PLAYERS','SELF','NO_TARGET','DEAD_PLAYER','ABILITY','FACTION','GLOBAL','CUSTOM_TARGET','OTHER') then target_type:='ONE_PLAYER'; end if;
  selection_rule_type:=upper(coalesce(effective_ability_record#>>'{understanding,targeting,selectionRuleType}',effective_ability_record#>>'{targeting,selectionRuleType}','UNDEFINED'));
  select coalesce(array_agg(value),'{}') into target_ids from jsonb_array_elements_text(coalesce(target_action->'targetIds','[]'::jsonb));
  if target_type in ('ONE_PLAYER','DEAD_PLAYER','SELF') and cardinality(target_ids)<>1 then raise exception using errcode='22023',message='ONE_TARGET_REQUIRED'; end if;
  if target_type in ('NO_TARGET','GLOBAL','FACTION','ABILITY','CUSTOM_TARGET','OTHER') and cardinality(target_ids)<>0 then raise exception using errcode='22023',message='TARGET_NOT_ALLOWED'; end if;
  if target_type='MULTIPLE_PLAYERS' and cardinality(target_ids)<greatest(1,coalesce(nullif(effective_ability_record#>>'{understanding,targeting,minTargets}','')::integer,nullif(effective_ability_record#>>'{targeting,minTargets}','')::integer,1)) then raise exception using errcode='22023',message='NOT_ENOUGH_TARGETS'; end if;
  if target_type='MULTIPLE_PLAYERS' and cardinality(target_ids)>coalesce(nullif(effective_ability_record#>>'{understanding,targeting,maxTargets}','')::integer,nullif(effective_ability_record#>>'{targeting,maxTargets}','')::integer,1000) then raise exception using errcode='22023',message='TOO_MANY_TARGETS'; end if;
  if target_type='ABILITY' and not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,abilities}','[]'::jsonb)) target_ability where target_ability->>'id'=(target_action#>>'{parameters,targetAbilityId}')) then raise exception using errcode='23503',message='TARGET_ABILITY_NOT_FOUND'; end if;
  if target_type='FACTION' and not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,factions}','[]'::jsonb)) faction where faction->>'id'=(target_action#>>'{parameters,targetFactionId}')) then raise exception using errcode='22023',message='TARGET_FACTION_REQUIRED'; end if;
  if target_type in ('CUSTOM_TARGET','OTHER') and nullif(btrim((target_action#>>'{parameters,customTarget}')),'') is null then raise exception using errcode='22023',message='CUSTOM_TARGET_REQUIRED'; end if;
  foreach target_id in array target_ids loop
    select value into target_record from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) where value->>'id'=target_id limit 1;if target_record is null then raise exception using errcode='23503',message='TARGET_NOT_FOUND'; end if;
    if target_type='SELF' and target_id<>player_id then raise exception using errcode='22023',message='SELF_TARGET_REQUIRED'; end if;
    if target_type='DEAD_PLAYER' and coalesce(nullif(target_record->>'alive','')::boolean,true) then raise exception using errcode='22023',message='DEAD_TARGET_REQUIRED'; end if;
    if coalesce(nullif(effective_ability_record#>>'{understanding,targeting,deadOnly}','')::boolean,nullif(effective_ability_record#>>'{targeting,deadOnly}','')::boolean,false) and coalesce(nullif(target_record->>'alive','')::boolean,true) then raise exception using errcode='22023',message='DEAD_TARGET_REQUIRED'; end if;
    if coalesce(nullif(effective_ability_record#>>'{understanding,targeting,livingOnly}','')::boolean,nullif(effective_ability_record#>>'{targeting,livingOnly}','')::boolean,false) and not coalesce(nullif(target_record->>'alive','')::boolean,true) then raise exception using errcode='22023',message='LIVING_TARGET_REQUIRED'; end if;
    if (coalesce(nullif(effective_ability_record#>>'{understanding,targeting,selfProhibited}','')::boolean,nullif(effective_ability_record#>>'{targeting,selfProhibited}','')::boolean,false) or coalesce(nullif(effective_ability_record#>>'{understanding,targeting,selfAllowed}','')::boolean,nullif(effective_ability_record#>>'{targeting,selfAllowed}','')::boolean,true)=false) and target_id=player_id then raise exception using errcode='22023',message='SELF_TARGET_PROHIBITED'; end if;
    actor_faction_id:=case when source_type='FACTION' then source_faction_id else coalesce(nullif(player_record->>'currentFactionId',''),nullif(player_record->>'factionId',''),nullif(role_record->>'factionId','')) end;target_faction_id:=coalesce(nullif(target_record->>'currentFactionId',''),nullif(target_record->>'factionId',''),(select value->>'factionId' from jsonb_array_elements(coalesce(stored.document#>'{data,roles}','[]'::jsonb)) where value->>'id'=target_record->>'roleId' limit 1));
    if selection_rule_type<>'SOFT_EFFECT_ELIGIBILITY' and coalesce(nullif(effective_ability_record#>>'{understanding,targeting,factionMemberOnly}','')::boolean,nullif(effective_ability_record#>>'{targeting,factionMemberOnly}','')::boolean,false) and target_faction_id is distinct from actor_faction_id then raise exception using errcode='22023',message='FACTION_MEMBER_TARGET_REQUIRED'; end if;
    if selection_rule_type<>'SOFT_EFFECT_ELIGIBILITY' and coalesce(nullif(effective_ability_record#>>'{understanding,targeting,nonFactionMemberOnly}','')::boolean,nullif(effective_ability_record#>>'{targeting,nonFactionMemberOnly}','')::boolean,false) and target_faction_id is not distinct from actor_faction_id then raise exception using errcode='22023',message='NON_FACTION_TARGET_REQUIRED'; end if;
    if selection_rule_type<>'SOFT_EFFECT_ELIGIBILITY' and jsonb_array_length(coalesce(effective_ability_record#>'{understanding,targeting,targetFactionRestrictions}',effective_ability_record#>'{targeting,targetFactionRestrictions}','[]'::jsonb))>0 and not exists(select 1 from jsonb_array_elements_text(coalesce(effective_ability_record#>'{understanding,targeting,targetFactionRestrictions}',effective_ability_record#>'{targeting,targetFactionRestrictions}','[]'::jsonb)) allowed(value) where lower(allowed.value) in (lower(target_faction_id),lower(coalesce((select faction->>'name' from jsonb_array_elements(coalesce(stored.document#>'{data,factions}','[]'::jsonb)) faction where faction->>'id'=target_faction_id limit 1),'')))) then raise exception using errcode='22023',message='TARGET_FACTION_RESTRICTED'; end if;
    if selection_rule_type<>'SOFT_EFFECT_ELIGIBILITY' and jsonb_array_length(coalesce(effective_ability_record#>'{understanding,targeting,targetRoleRestrictions}',effective_ability_record#>'{targeting,targetRoleRestrictions}','[]'::jsonb))>0 and not exists(select 1 from jsonb_array_elements_text(coalesce(effective_ability_record#>'{understanding,targeting,targetRoleRestrictions}',effective_ability_record#>'{targeting,targetRoleRestrictions}','[]'::jsonb)) allowed(value) where lower(allowed.value) in (lower(coalesce(target_record->>'roleId','')),lower(coalesce((select role->>'name' from jsonb_array_elements(coalesce(stored.document#>'{data,roles}','[]'::jsonb)) role where role->>'id'=target_record->>'roleId' limit 1),'')))) then raise exception using errcode='22023',message='TARGET_ROLE_RESTRICTED'; end if;
  end loop;
  action_value:=jsonb_strip_nulls(jsonb_build_object('id',coalesce(nullif(target_action->>'id',''),gen_random_uuid()::text),'gameId',target_game_id::text,'cycle',current_cycle,'phase',current_phase,'sourceType',source_type,'actorId',nullif(player_id,''),'sourcePlayerId',nullif(player_id,''),'sourceFactionId',nullif(source_faction_id,''),'roleId',nullif(player_record->>'roleId',''),'abilityId',ability_id,'playerAbilityGrantId',case when grant_id is null then null else grant_id::text end,'grantVersion',case when grant_id is null then null else grant_record.version end,'abilitySource',coalesce(nullif(target_action->>'abilitySource',''),case when grant_id is null then case when source_type='PLAYER' then 'ROLE' else source_type end else grant_record.source_type end),'baseAbilityId',ability_id,'effectiveAbilityId',effective_ability_id,'name',coalesce(effective_ability_record->>'name',ability_record->>'name'),'category',coalesce(effective_ability_record->>'category',ability_record->>'category','Other'),'targetType',target_type,'targeting',coalesce(effective_ability_record#>'{understanding,targeting}',effective_ability_record->'targeting','{}'::jsonb),'mechanicUnderstanding',coalesce(effective_ability_record->'understanding','{}'::jsonb),'selectionRuleType',selection_rule_type,'effectEligibilityRules',coalesce(effective_ability_record#>'{understanding,targeting,effectEligibilityRules}',effective_ability_record#>'{targeting,effectEligibilityRules}','[]'::jsonb),'targetId',target_ids[1],'targetIds',to_jsonb(target_ids),'parameters',coalesce(target_action->'parameters','{}'::jsonb),'submittedBy',actor,'submittedAt',now(),'validationState',case when override_reason='' then 'VALID' else 'GM_OVERRIDE' end,'status','ATTEMPTED','usesBefore',uses_before,'activeWarnings',warnings,'gmOverride',override_reason<>'','overrideReason',nullif(override_reason,'')));
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

-- The proven finalization/learning/grant flow remains authoritative. Rebuild its
-- event projection afterward so the richer event vocabulary is preserved.
create or replace function private.finalize_resolution_with_grants(target_session_id uuid,expected_lock_version integer,target_decision text,target_manual_resolution jsonb,target_gm_explanation text,target_teach_ai boolean,target_teach_scope text,target_consumed_action_ids text[])
returns public.resolution_sessions language plpgsql security definer set search_path='' as $$
declare result public.resolution_sessions%rowtype;item jsonb;ordinal integer:=0;event_kind text;
begin
  result:=private.finalize_resolution_with_grants_v11_2(target_session_id,expected_lock_version,target_decision,target_manual_resolution,target_gm_explanation,target_teach_ai,target_teach_scope,target_consumed_action_ids);
  if result.status='FINALIZED' and jsonb_typeof(result.final_resolution->'events')='array' then
    delete from public.resolution_session_events where session_id=result.id;
    for item in select value from jsonb_array_elements(result.final_resolution->'events') loop
      ordinal:=ordinal+1;event_kind:=upper(coalesce(item->>'event_type','OTHER'));
      if event_kind not in ('SUCCESS','FAILURE','BLOCK','INELIGIBLE_EFFECT','CANCELLED','REDIRECT','REFLECT','TRANSFER','PASSIVE_TRIGGER','PASSIVE_PREVENTED','PROTECTION_USED','DEATH','SURVIVAL','CONVERSION','STATUS_ADDED','STATUS_REMOVED','ABILITY_CONSUMED','USE_REFUNDED','STATE_CHANGE','OTHER') then event_kind:='OTHER'; end if;
      insert into public.resolution_session_events(session_id,game_id,event_order,event_type,actor_player_id,target_player_id,ability_id,outcome,action_id)
      values(result.id,result.game_id,ordinal,event_kind,nullif(item->>'actor_player_id',''),nullif(item->>'target_player_id',''),nullif(item->>'ability_id',''),item,coalesce(nullif(item->>'action_id',''),nullif(item->>'actionId','')));
    end loop;
    for item in select queued.value from jsonb_array_elements(result.submitted_actions) queued(value) where queued.value->>'id'=any(coalesce(target_consumed_action_ids,'{}')) and not exists(select 1 from public.resolution_session_events existing where existing.session_id=result.id and existing.event_type='ABILITY_CONSUMED' and existing.action_id=queued.value->>'id') loop
      ordinal:=ordinal+1;
      insert into public.resolution_session_events(session_id,game_id,event_order,event_type,actor_player_id,ability_id,outcome,action_id)
      values(result.id,result.game_id,ordinal,'ABILITY_CONSUMED',nullif(coalesce(item->>'sourcePlayerId',item->>'actorId'),''),nullif(item->>'abilityId',''),jsonb_build_object('action_id',item->>'id','uses_consumed',1,'result','CONSUMED'),item->>'id');
    end loop;
  end if;
  if result.phase_id is not null then
    update public.game_phases phase_row set resolution_summary=jsonb_build_object('sessionId',result.id,'status',result.status,'decision',result.gm_decision,'finalResolution',result.final_resolution,'finalizedAt',result.finalized_at),updated_at=now() where phase_row.id=result.phase_id;
    insert into public.game_phase_events(game_id,phase_id,event_type,resolution_session_id,summary,payload,actor_user_id) values(result.game_id,result.phase_id,'RESOLUTION_FINALIZED',result.id,coalesce(nullif(result.gm_explanation,''),'Resolution finalized by a GM.'),jsonb_build_object('status',result.status,'decision',result.gm_decision,'finalResolution',result.final_resolution),auth.uid());
  end if;
  return result;
end$$;

create or replace function public.get_mechanics_review_queue(target_game_id uuid default null)
returns jsonb language sql security invoker set search_path='' stable as $$
with authorized_documents as (
  select document_row.game_id,game.name as game_name,document_row.document
  from public.game_documents document_row join public.games game on game.id=document_row.game_id
  where (select auth.uid()) is not null and public.can_edit_game(document_row.game_id) and ($1 is null or document_row.game_id=$1)
), derived as (
  select document_row.game_id,document_row.game_name,role.value as role,ability.value as ability,mechanic.value as mechanic
  from authorized_documents document_row
  cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,roles}','[]'::jsonb)) role(value)
  cross join lateral jsonb_array_elements(coalesce(role.value#>'{understanding,mechanics}',role.value->'mechanicalStatements','[]'::jsonb)) mechanic(value)
  left join lateral (select candidate.value from jsonb_array_elements(coalesce(document_row.document#>'{data,abilities}','[]'::jsonb)) candidate(value) where candidate.value->>'id'=mechanic.value->>'sourceAbilityId' limit 1) ability on true
  where coalesce(nullif(mechanic.value->>'requiresReview','')::boolean,false) or upper(coalesce(mechanic.value->>'interpretationState',mechanic.value->>'interpretation_state','NEEDS_REVIEW')) in ('PARTIALLY_UNDERSTOOD','NEEDS_REVIEW','UNRESOLVED') or jsonb_array_length(coalesce(mechanic.value->'unresolvedComponents',mechanic.value->'unresolved_components','[]'::jsonb))>0 or coalesce(nullif(mechanic.value->>'confidence','')::numeric,0)<.75
  union all
  select document_row.game_id,document_row.game_name,null::jsonb,ability.value,mechanic.value
  from authorized_documents document_row
  cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,abilities}','[]'::jsonb)) ability(value)
  cross join lateral jsonb_array_elements(coalesce(ability.value#>'{understanding,mechanics}',ability.value->'mechanicalStatements','[]'::jsonb)) mechanic(value)
  where coalesce(nullif(mechanic.value->>'requiresReview','')::boolean,false) or upper(coalesce(mechanic.value->>'interpretationState',mechanic.value->>'interpretation_state','NEEDS_REVIEW')) in ('PARTIALLY_UNDERSTOOD','NEEDS_REVIEW','UNRESOLVED') or jsonb_array_length(coalesce(mechanic.value->'unresolvedComponents',mechanic.value->'unresolved_components','[]'::jsonb))>0 or coalesce(nullif(mechanic.value->>'confidence','')::numeric,0)<.75
), suspicious as (
  select document_row.game_id,document_row.game_name,role.value as role,
    case
      when nullif(role.value->>'passiveAbilityId','') is not null and coalesce(role.value->>'sourceText','')!~* '\m(passive|automatically|whenever|when targeted|cannot be|immune|first time|upon death|after death)\M' then 'POSSIBLY_INVENTED_PASSIVE'
      when coalesce(role.value->>'sourceText','')~* '\m(all|entire)\M.*\m(faction|den)\M' then 'FACTION_SCOPE_NOT_STRUCTURED'
      else 'SOURCE_STRUCTURE_MISSING' end as review_type
  from authorized_documents document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,roles}','[]'::jsonb)) role(value)
  where jsonb_array_length(coalesce(role.value#>'{understanding,mechanics}',role.value->'mechanicalStatements','[]'::jsonb))=0 and (
    (char_length(coalesce(role.value->>'sourceText',''))>300 and coalesce(role.value->>'sourceText','')~* '\m(if|when|unless|only|except|all|entire|until|after|before)\M')
    or nullif(role.value->>'passiveAbilityId','') is not null
    or coalesce(role.value->>'sourceText','')~* '\m(all|entire)\M.*\m(faction|den)\M'
  )
), combined as (
  select coalesce(mechanic->>'id',game_id::text||':derived:'||row_number() over()) as review_id,game_id,game_name,jsonb_build_object('id',mechanic->>'id','roleId',role->>'id','roleName',role->>'name','abilityId',coalesce(ability->>'id',mechanic->>'sourceAbilityId'),'abilityName',coalesce(ability->>'name',mechanic->>'sourceAbilityName'),'mechanicType',coalesce(mechanic->>'type','CUSTOM_MECHANIC'),'confidence',coalesce(nullif(mechanic->>'confidence','')::numeric,0),'interpretationState',coalesce(mechanic->>'interpretationState',mechanic->>'interpretation_state','NEEDS_REVIEW'),'originalText',coalesce(mechanic->>'originalText',mechanic->>'original_text',role->>'sourceText',ability->>'sourceText',''),'parsedUnderstanding',coalesce(mechanic->>'summary',mechanic->>'effect',''),'knownComponents',coalesce(mechanic->'effects','[]'::jsonb),'unknownComponents',coalesce(mechanic->'unresolvedComponents',mechanic->'unresolved_components','[]'::jsonb),'possibleInterpretations',coalesce(mechanic->'possibleInterpretations',mechanic->'possible_interpretations','[]'::jsonb),'source',coalesce(mechanic->>'sourceLocation',mechanic->>'source_location',role->>'sourceLocation',ability->>'sourceLocation',''),'origin',coalesce(mechanic->>'origin','AI_INTERPRETATION_PENDING'),'current',mechanic,'proposed',null) as review from derived
  union all
  select game_id::text||':'||coalesce(role->>'id','role')||':'||lower(review_type),game_id,game_name,jsonb_build_object('roleId',role->>'id','roleName',role->>'name','mechanicType',review_type,'confidence',0,'interpretationState','NEEDS_REVIEW','originalText',coalesce(role->>'sourceText',''),'parsedUnderstanding',case review_type when 'POSSIBLY_INVENTED_PASSIVE' then 'A stored passive is not supported by the preserved source text. Preserve it until a GM reviews its origin.' when 'FACTION_SCOPE_NOT_STRUCTURED' then 'The source appears faction-wide but no structured faction/global mechanic exists.' else 'Conditional or scoped source text has no structured mechanical statements.' end,'knownComponents','[]'::jsonb,'unknownComponents',jsonb_build_array('Structured interpretation'),'possibleInterpretations','[]'::jsonb,'source',coalesce(role->>'sourceLocation',''),'origin','AI_INTERPRETATION_PENDING','current',coalesce(role->'understanding','{}'::jsonb),'proposed',null) from suspicious
), deduplicated as (
  select distinct on (game_id,review_id) review_id,game_id,game_name,review from combined order by game_id,review_id
)
select coalesce(jsonb_agg((review||jsonb_build_object('id',review_id,'gameId',game_id,'gameName',game_name)) order by game_name,coalesce(review->>'roleName',review->>'abilityName',''),review_id),'[]'::jsonb) from deduplicated
$$;

create or replace function public.get_ability_usage_statistics(target_game_id uuid)
returns jsonb language sql security invoker set search_path='' stable as $$
with permitted as (
  select document from public.game_documents where game_id=$1 and (select auth.uid()) is not null and public.can_edit_game($1)
), actions as (
  select action->>'id' as action_id,coalesce(action->>'abilityId',action->>'baseAbilityId') as ability_id,coalesce(action->>'sourcePlayerId',action->>'actorId','') as player_id,coalesce(action->>'roleId','') as role_id,upper(coalesce(action->>'sourceType','PLAYER')) as source_type,coalesce(nullif(action->>'cycle','')::integer,phase.cycle) as cycle,coalesce(action->>'phase',phase.phase) as phase,coalesce(action->>'submittedAt','') as submitted_at
  from public.game_phases phase cross join lateral jsonb_array_elements(coalesce(phase.action_queue,'[]'::jsonb)) action
  where phase.game_id=$1
), events as (
  select event.id,event.action_id,event.event_type,event.ability_id,coalesce(event.actor_player_id,'') as player_id,event.outcome
  from public.resolution_session_events event where event.game_id=$1
), keys as (
  select distinct ability_id,player_id from actions where coalesce(ability_id,'')<>''
  union select distinct ability_id,player_id from events where coalesce(ability_id,'')<>''
), affected as (
  select event.ability_id,event.player_id,affected_player.value as affected_player_id
  from events event cross join lateral jsonb_array_elements_text(coalesce(event.outcome->'affected_player_ids','[]'::jsonb)) affected_player(value)
), statistics as (
  select key.ability_id,key.player_id,
    (select count(distinct action.action_id) from actions action where action.ability_id=key.ability_id and action.player_id=key.player_id) as attempts,
    (select count(distinct action.action_id) from actions action where action.ability_id=key.ability_id and action.player_id=key.player_id and action.source_type='FACTION') as faction_action_attempts,
    (select count(distinct coalesce(event.action_id,event.id::text)) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='SUCCESS') as successful,
    (select count(distinct coalesce(event.action_id,event.id::text)) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='FAILURE') as failed,
    (select count(distinct coalesce(event.action_id,event.id::text)) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='BLOCK') as blocked,
    (select count(distinct coalesce(event.action_id,event.id::text)) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='INELIGIBLE_EFFECT') as ineligible,
    (select count(distinct coalesce(event.action_id,event.id::text)) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='REDIRECT') as redirected,
    (select count(distinct coalesce(event.action_id,event.id::text)) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='REFLECT') as reflected,
    (select count(distinct coalesce(event.action_id,event.id::text)) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='CANCELLED') as cancelled,
    (select coalesce(sum(greatest(1,coalesce(nullif(event.outcome->>'uses_consumed','')::integer,1))),0) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='ABILITY_CONSUMED') as uses_consumed,
    (select coalesce(sum(greatest(1,coalesce(nullif(event.outcome->>'uses_refunded','')::integer,1))),0) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='USE_REFUNDED') as uses_refunded,
    (select count(*) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='PASSIVE_TRIGGER') as passive_triggers,
    (select count(*) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='PASSIVE_TRIGGER' and upper(coalesce(event.outcome->>'result','SUCCESS')) not in ('FAILURE','FAILED','PREVENTED','BLOCKED')) as passive_successful,
    (select count(*) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and event.event_type='PASSIVE_PREVENTED') as passive_prevented,
    (select count(*) from events event where event.ability_id=key.ability_id and event.player_id=key.player_id and (event.event_type='PASSIVE_PREVENTED' or event.event_type='PASSIVE_TRIGGER' and upper(coalesce(event.outcome->>'result','')) in ('FAILURE','FAILED','PREVENTED','BLOCKED'))) as passive_failed,
    (select count(distinct affected_player_id) from affected item where item.ability_id=key.ability_id and item.player_id=key.player_id) as affected_players,
    (select max(action.submitted_at) from actions action where action.ability_id=key.ability_id and action.player_id=key.player_id) as last_attempt_at,
    (select max(action.cycle) from actions action where action.ability_id=key.ability_id and action.player_id=key.player_id) as last_attempt_cycle,
    (select action.phase from actions action where action.ability_id=key.ability_id and action.player_id=key.player_id order by action.submitted_at desc,action.cycle desc limit 1) as last_attempt_phase,
    (select case when count(*)=0 then null when bool_or(grant_record.uses_remaining is null) then -1 else sum(grant_record.uses_remaining) end from public.player_ability_grants grant_record where grant_record.game_id=$1 and grant_record.ability_id=key.ability_id and grant_record.player_id=key.player_id and grant_record.status='ACTIVE') as granted_uses_remaining,
    (select min(action.role_id) from actions action where action.ability_id=key.ability_id and action.player_id=key.player_id and action.role_id<>'') as role_id
  from keys key
)
select case when exists(select 1 from permitted) then coalesce(jsonb_agg(jsonb_build_object('ability_id',statistic.ability_id,'ability_name',coalesce((select ability->>'name' from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,abilities}','[]'::jsonb)) ability where ability->>'id'=statistic.ability_id limit 1),statistic.ability_id),'player_id',nullif(statistic.player_id,''),'player_name',(select player->>'name' from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=statistic.player_id limit 1),'role_id',statistic.role_id,'role_name',(select role->>'name' from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,roles}','[]'::jsonb)) role where role->>'id'=statistic.role_id limit 1),'attempts',statistic.attempts,'faction_action_attempts',statistic.faction_action_attempts,'successful',statistic.successful,'failed',statistic.failed,'blocked',statistic.blocked,'ineligible',statistic.ineligible,'redirected',statistic.redirected,'reflected',statistic.reflected,'cancelled',statistic.cancelled,'uses_consumed',statistic.uses_consumed,'uses_refunded',statistic.uses_refunded,'remaining_uses',coalesce(statistic.granted_uses_remaining,(select greatest(0,(role->>'abilityUses')::integer-statistic.uses_consumed+statistic.uses_refunded) from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,roles}','[]'::jsonb)) role where role->>'id'=statistic.role_id and nullif(role->>'abilityUses','') is not null limit 1)),'passive_triggers',statistic.passive_triggers,'passive_successful',statistic.passive_successful,'passive_prevented',statistic.passive_prevented,'passive_failed',statistic.passive_failed,'affected_players',statistic.affected_players,'last_attempt_at',statistic.last_attempt_at,'last_attempt_cycle',statistic.last_attempt_cycle,'last_attempt_phase',statistic.last_attempt_phase) order by statistic.attempts desc,statistic.ability_id),'[]'::jsonb) else '[]'::jsonb end from statistics statistic
$$;

create or replace function public.get_cross_game_ability_usage_statistics()
returns jsonb language sql security invoker set search_path='' stable as $$
with authorized_games as (
  select game.id,game.name
  from public.games game
  where (select auth.uid()) is not null and public.can_edit_game(game.id)
), rows as (
  select game.id as game_id,game.name as game_name,statistic.value as statistic
  from authorized_games game
  cross join lateral jsonb_array_elements(public.get_ability_usage_statistics(game.id)) statistic(value)
)
select coalesce(jsonb_agg(statistic||jsonb_build_object('game_id',game_id,'game_name',game_name) order by game_name,statistic->>'ability_name',statistic->>'player_name'),'[]'::jsonb)
from rows
$$;

-- Extend the existing atomic, human-approved Master GM patch path for bounded
-- structured-mechanic corrections. The same proposal/version checks still apply.
create or replace function private.master_gm_patch_entity(candidate jsonb,section_name text,target_id text,patch jsonb,actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare allowed_keys text[];current_item jsonb;next_items jsonb;sanitized jsonb;did_find boolean:=false;
begin
  if section_name='roles' then allowed_keys:=array['name','factionId','roleType','abilityDataStatus','basicEvidence','slotCount','alignment','description','activeAbilityId','passiveAbilityId','tags','abilityUses','cooldowns','immunities','restrictions','mechanicalStatements','understanding','unresolvedComponents','sourceVersion','winCondition','notes','gmNotes','labels','enabled','archivedAt'];
  elsif section_name='abilities' then allowed_keys:=array['name','category','definition','phase','mechanics','mechanicalStatements','understanding','targeting','baseStandardAbilityId','standardAbilityId','mapping','unresolvedComponents','sourceVersion'];
  elsif section_name='factions' then allowed_keys:=array['name','class','alignment','description','winCondition','notes','alias','teamNumber'];
  elsif section_name='rules' then allowed_keys:=array['title','description','category','visibility','notes','enabled','sortOrder'];
  else raise exception using errcode='22023',message='INVALID_PATCH_SECTION'; end if;
  if jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) key where key<>all(allowed_keys)) then raise exception using errcode='22023',message='INVALID_PATCH_FIELDS'; end if;
  select value into current_item from jsonb_array_elements(candidate#>array['data',section_name]) where value->>'id'=target_id limit 1;
  if current_item is null then raise exception using errcode='P0002',message='PATCH_TARGET_NOT_FOUND'; end if;
  if section_name='roles' then
    if char_length(coalesce(patch->>'name',current_item->>'name','')) not between 1 and 120 or char_length(coalesce(patch->>'description',current_item->>'description',''))>8000 or coalesce(patch->>'roleType',current_item->>'roleType','STANDARD') not in ('STANDARD','BASIC') or coalesce(patch->>'abilityDataStatus',current_item->>'abilityDataStatus','POSSIBLY_INCOMPLETE') not in ('COMPLETE','INTENTIONALLY_NONE','POSSIBLY_INCOMPLETE') then raise exception using errcode='22023',message='INVALID_ROLE_PATCH'; end if;
    if nullif(patch->>'factionId','') is not null and not exists(select 1 from jsonb_array_elements(candidate#>'{data,factions}') item where item->>'id'=patch->>'factionId') then raise exception using errcode='23503',message='FACTION_NOT_FOUND'; end if;
    if nullif(patch->>'activeAbilityId','') is not null and not exists(select 1 from jsonb_array_elements(candidate#>'{data,abilities}') item where item->>'id'=patch->>'activeAbilityId') then raise exception using errcode='23503',message='ABILITY_NOT_FOUND'; end if;
    if nullif(patch->>'passiveAbilityId','') is not null and not exists(select 1 from jsonb_array_elements(candidate#>'{data,abilities}') item where item->>'id'=patch->>'passiveAbilityId') then raise exception using errcode='23503',message='ABILITY_NOT_FOUND'; end if;
    if patch?'tags' and (jsonb_typeof(patch->'tags')<>'array' or jsonb_array_length(patch->'tags')>100 or exists(select 1 from jsonb_array_elements_text(patch->'tags') requested where not exists(select 1 from jsonb_array_elements(candidate#>'{data,abilities}') ability where lower(ability->>'name')=lower(requested)))) then raise exception using errcode='22023',message='INVALID_ROLE_ABILITIES'; end if;
  elsif section_name='abilities' then
    if char_length(coalesce(patch->>'name',current_item->>'name','')) not between 1 and 120 or char_length(coalesce(patch->>'definition',current_item->>'definition','')) not between 1 and 8000 or coalesce(patch->>'category',current_item->>'category','Other') not in ('Investigation','Harmful','Protection','Support','Control','Communication','Passive','Other') or coalesce(patch->>'phase',current_item->>'phase','Any') not in ('Night','Day','Any','Passive') then raise exception using errcode='22023',message='INVALID_ABILITY_PATCH'; end if;
    if patch?'mechanics' and (jsonb_typeof(patch->'mechanics')<>'array' or jsonb_array_length(patch->'mechanics')>100) then raise exception using errcode='22023',message='INVALID_ABILITY_MECHANICS'; end if;
  elsif section_name='factions' then
    if char_length(coalesce(patch->>'name',current_item->>'name','')) not between 1 and 120 or coalesce(patch->>'class',current_item->>'class','NEUTRAL') not in ('VILLAGER','DEN','NEUTRAL') then raise exception using errcode='22023',message='INVALID_FACTION_PATCH'; end if;
  elsif section_name='rules' then
    if char_length(coalesce(patch->>'title',current_item->>'title','')) not between 1 and 200 or char_length(coalesce(patch->>'description',current_item->>'description','')) not between 1 and 8000 or coalesce(patch->>'visibility',current_item->>'visibility','public') not in ('public','gm') then raise exception using errcode='22023',message='INVALID_RULE_PATCH'; end if;
  end if;
  if section_name in ('roles','abilities') then
    if patch?'mechanicalStatements' and (jsonb_typeof(patch->'mechanicalStatements')<>'array' or jsonb_array_length(patch->'mechanicalStatements')>1000) then raise exception using errcode='22023',message='INVALID_MECHANICAL_STATEMENTS'; end if;
    if patch?'understanding' and (jsonb_typeof(patch->'understanding')<>'object' or jsonb_typeof(coalesce(patch#>'{understanding,mechanics}','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(patch#>'{understanding,mechanics}','[]'::jsonb))>1000) then raise exception using errcode='22023',message='INVALID_MECHANIC_UNDERSTANDING'; end if;
    if patch?'unresolvedComponents' and (jsonb_typeof(patch->'unresolvedComponents')<>'array' or jsonb_array_length(patch->'unresolvedComponents')>100) then raise exception using errcode='22023',message='INVALID_UNRESOLVED_COMPONENTS'; end if;
  end if;
  if section_name='abilities' and patch?'targeting' and jsonb_typeof(patch->'targeting')<>'object' then raise exception using errcode='22023',message='INVALID_TARGETING'; end if;
  if coalesce(patch->>'name',patch->>'title','')<>'' and exists(select 1 from jsonb_array_elements(candidate#>array['data',section_name]) item where item->>'id'<>target_id and lower(coalesce(item->>'name',item->>'title'))=lower(coalesce(patch->>'name',patch->>'title'))) then raise exception using errcode='23505',message='DUPLICATE_ENTITY_NAME'; end if;
  sanitized:=patch-'id'-'gameId'-'createdAt'-'createdBy'-'updatedAt'-'updatedBy'-'version'-'revisions';
  if section_name='abilities' then sanitized:=sanitized||jsonb_build_object('revisions',coalesce(current_item->'revisions','[]'::jsonb)||jsonb_build_array(current_item-'revisions')); end if;
  sanitized:=sanitized||jsonb_build_object('version',coalesce((current_item->>'version')::integer,0)+1,'updatedAt',now(),'updatedBy',actor);
  select jsonb_agg(case when value->>'id'=target_id then value||sanitized else value end order by ordinality),bool_or(value->>'id'=target_id) into next_items,did_find from jsonb_array_elements(candidate#>array['data',section_name]) with ordinality;
  if not did_find then raise exception using errcode='P0002',message='PATCH_TARGET_NOT_FOUND'; end if;
  return jsonb_set(candidate,array['data',section_name],next_items,false);
end$$;

comment on function public.get_mechanics_review_queue(uuid) is 'Source-preserving review queue for unresolved role and ability mechanics across authorized games.';
comment on function public.get_ability_usage_statistics(uuid) is 'Action-id-deduplicated ability usage and passive-trigger statistics for an authorized game.';
comment on function public.get_cross_game_ability_usage_statistics() is 'Per-game ability usage rows for all games the caller can edit; callers may aggregate only by stable identity or approved concept mapping.';

revoke all on function private.queue_player_action_document_v11_2(uuid,integer,jsonb,text),private.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[]),private.master_gm_patch_entity(jsonb,text,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_mechanics_review_queue(uuid),public.get_ability_usage_statistics(uuid) from public,anon;
grant execute on function public.get_mechanics_review_queue(uuid),public.get_ability_usage_statistics(uuid) to authenticated;
revoke all on function public.get_cross_game_ability_usage_statistics() from public,anon;
grant execute on function public.get_cross_game_ability_usage_statistics() to authenticated;
