-- Preserve the existing approval implementation, signature, ACLs and PT422 conflicts.
CREATE OR REPLACE FUNCTION private.approve_and_apply_resolution_v11_5(target_session_id uuid, expected_lock_version integer, target_final_resolution jsonb, target_gm_explanation text, target_teach_ai boolean, target_teach_scope text, target_consumed_action_ids text[], target_idempotency_key uuid, target_override_warnings boolean, target_reject boolean)
 RETURNS resolution_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=(select auth.uid());session_row public.resolution_sessions%rowtype;phase_row public.game_phases%rowtype;
  stored public.game_documents%rowtype;saved record;result public.resolution_sessions%rowtype;final_value jsonb:=coalesce(target_final_resolution,'{}'::jsonb);
  action_result jsonb;queued_action jsonb;passive_result jsonb;status_effect jsonb;player_outcome jsonb;grant_effect jsonb;
  normalized_action_results jsonb;canonical_events jsonb;next_players jsonb;next_actions jsonb;next_document jsonb;
  differences jsonb;warnings jsonb:='[]'::jsonb;warning_text text;consumed_from_ruling text[];status_result public.player_status_effects%rowtype;
  grant_result public.player_ability_grants%rowtype;event_item jsonb;ordinal integer:=0;event_kind text;current_faction text;
begin
  if target_idempotency_key is null then raise exception using errcode='22023',message='IDEMPOTENCY_KEY_REQUIRED'; end if;
  select * into session_row from public.resolution_sessions session_check where session_check.id=target_session_id for update;
  if not found then raise exception using errcode='P0002',message='RESOLUTION_SESSION_NOT_FOUND'; end if;
  if actor is null or not public.can_edit_game(session_row.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if session_row.status in ('FINALIZED','REJECTED') then
    if session_row.approval_idempotency_key=target_idempotency_key then return session_row; end if;
    raise exception using errcode = 'PT422',message='RESOLUTION_ALREADY_FINALIZED';
  end if;
  if session_row.lock_version<>expected_lock_version then raise exception using errcode = 'PT422',message='RESOLUTION_VERSION_CONFLICT'; end if;
  if session_row.phase_id is not null then select * into phase_row from public.game_phases current_phase where current_phase.id=session_row.phase_id for update; end if;
  select * into stored from public.game_documents document_row where document_row.game_id=session_row.game_id for update;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  if stored.version<>session_row.source_game_version and not coalesce(target_override_warnings,false) then raise exception using errcode = 'PT422',message='SOURCE_GAME_VERSION_CONFLICT'; end if;
  if coalesce(target_reject,false) then
    if cardinality(coalesce(target_consumed_action_ids,'{}'))>0 then raise exception using errcode='22023',message='REJECTED_RESOLUTION_CANNOT_CONSUME_GRANTS'; end if;
    update public.resolution_sessions set approval_idempotency_key=target_idempotency_key where id=target_session_id;
    result:=private.finalize_resolution_with_grants(target_session_id,expected_lock_version,'REJECT',final_value,target_gm_explanation,false,'GAME_SPECIFIC','{}');
    update public.resolution_sessions set approval_validation=jsonb_build_object('validatedAt',now(),'override',false,'warnings','[]'::jsonb,'rejectedWithoutApplication',true) where id=result.id returning * into result;
    return result;
  end if;
  if jsonb_typeof(final_value)<>'object' or octet_length(final_value::text)>300000
    or coalesce(nullif(final_value->>'schema_version','')::integer,0)<>2
    or jsonb_typeof(final_value->'action_results') is distinct from 'array'
    or jsonb_typeof(final_value->'passive_results') is distinct from 'array'
    or jsonb_typeof(final_value->'status_effects') is distinct from 'array'
    or jsonb_typeof(final_value->'player_outcomes') is distinct from 'array'
    or jsonb_typeof(final_value->'grant_effects') is distinct from 'array'
    or jsonb_typeof(final_value->'other_effects') is distinct from 'array'
  then raise exception using errcode='22023',message='INVALID_STRUCTURED_FINAL_RULING'; end if;
  if char_length(btrim(coalesce(final_value->>'final_ruling','')))=0 then raise exception using errcode='22023',message='FINAL_RULING_REQUIRED'; end if;
  if jsonb_array_length(final_value->'action_results')<>jsonb_array_length(session_row.submitted_actions)
    or jsonb_array_length(final_value->'action_results')>150
    or jsonb_array_length(final_value->'passive_results')>100
    or jsonb_array_length(final_value->'status_effects')>100
    or jsonb_array_length(final_value->'player_outcomes')>200
    or jsonb_array_length(final_value->'grant_effects')>100
    or jsonb_array_length(final_value->'other_effects')>100
  then raise exception using errcode='22023',message='INVALID_RULING_CARDINALITY'; end if;
  if exists(select 1 from jsonb_array_elements(final_value->'action_results') item group by item->>'action_id' having count(*)<>1)
    or exists(select 1 from jsonb_array_elements(session_row.submitted_actions) queued where not exists(select 1 from jsonb_array_elements(final_value->'action_results') item where item->>'action_id'=queued->>'id'))
    or exists(select 1 from jsonb_array_elements(final_value->'action_results') item where not exists(select 1 from jsonb_array_elements(session_row.submitted_actions) queued where queued->>'id'=item->>'action_id'))
  then raise exception using errcode='22023',message='DUPLICATE_OR_UNKNOWN_ACTION_ID'; end if;

  -- Replace attribution fields with the immutable queue snapshot. A client can
  -- edit the ruling, but cannot relabel a reward as role-owned or move history.
  select jsonb_agg(item.value||jsonb_build_object(
    'actor_player_id',coalesce(action.value->>'sourcePlayerId',action.value->>'actorId',''),
    'ability_id',coalesce(action.value->>'abilityId',action.value->>'baseAbilityId',''),
    'ability_name',coalesce(action.value->>'abilityNameSnapshot',action.value->>'name',''),
    'ability_source',upper(coalesce(action.value->>'abilitySource',case when action.value->>'sourceType'='PLAYER' then 'ROLE' else action.value->>'sourceType' end,'ROLE')),
    'source_type',upper(coalesce(action.value->>'abilitySource',case when action.value->>'sourceType'='PLAYER' then 'ROLE' else action.value->>'sourceType' end,'ROLE')),
    'source_faction_id',coalesce(action.value->>'sourceFactionId',''),
    'faction_action',upper(coalesce(action.value->>'sourceType',''))='FACTION',
    'role_id',coalesce(action.value->>'roleId',''),
    'role_version',coalesce(nullif(action.value->>'roleVersion','')::integer,1),
    'original_target_ids',coalesce(action.value->'targetIds','[]'::jsonb),
    'player_ability_grant_id',coalesce(action.value->>'playerAbilityGrantId','')
  ) order by item.ordinality) into normalized_action_results
  from jsonb_array_elements(final_value->'action_results') with ordinality item(value,ordinality)
  join lateral (select queued.value from jsonb_array_elements(session_row.submitted_actions) queued(value) where queued.value->>'id'=item.value->>'action_id' limit 1) action on true;
  final_value:=jsonb_set(final_value,'{action_results}',coalesce(normalized_action_results,'[]'::jsonb),false);

  for action_result in select value from jsonb_array_elements(final_value->'action_results') loop
    if upper(coalesce(action_result->>'result','')) not in ('SUCCESS','FAILURE','BLOCKED','CANCELLED','INELIGIBLE_EFFECT')
      or upper(coalesce(action_result->>'use_disposition','')) not in ('CONSUMED','REFUNDED','NOT_CONSUMED','NOT_APPLICABLE')
      or jsonb_typeof(action_result->'final_target_ids') is distinct from 'array'
      or jsonb_typeof(action_result->'affected_player_ids') is distinct from 'array'
    then raise exception using errcode='22023',message='INVALID_ACTION_RESULT'; end if;
    if exists(select 1 from jsonb_array_elements_text(action_result->'final_target_ids') target_id where not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=target_id))
      or exists(select 1 from jsonb_array_elements_text(action_result->'affected_player_ids') target_id where not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=target_id))
    then raise exception using errcode='23503',message='FINAL_TARGET_NOT_FOUND'; end if;
    if action_result->>'source_type'='ROLE' and exists(
      select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,roles}','[]'::jsonb)) role
      where role->>'id'=action_result->>'role_id' and upper(coalesce(role->>'roleType','STANDARD'))='BASIC'
    ) then warnings:=warnings||jsonb_build_array('A Basic Role action is marked role-owned: '||(action_result->>'action_id')); end if;
    if coalesce((action_result->>'faction_action')::boolean,false) and action_result->>'result'='SUCCESS' and coalesce(action_result->>'actor_player_id','')='' then warnings:=warnings||jsonb_build_array('A successful faction action has no recorded performer: '||(action_result->>'action_id')); end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(final_value->'passive_results') passive where coalesce((passive->>'triggered')::boolean,false) and coalesce(passive->>'ability_id','')='') then warnings:=warnings||jsonb_build_array('A triggered passive has no ability ID.'); end if;
  if exists(select 1 from jsonb_array_elements(final_value->'passive_results') passive where coalesce(passive->>'player_id','')<>'' and not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=passive->>'player_id'))
    or exists(select 1 from jsonb_array_elements(final_value->'passive_results') passive where coalesce(passive->>'ability_id','')<>'' and not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,abilities}','[]'::jsonb)) ability where ability->>'id'=passive->>'ability_id'))
    or exists(select 1 from jsonb_array_elements(final_value->'passive_results') passive where coalesce(passive->>'role_id','')<>'' and not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,roles}','[]'::jsonb)) role where role->>'id'=passive->>'role_id'))
  then raise exception using errcode='23503',message='PASSIVE_REFERENCE_NOT_FOUND'; end if;
  if exists(select 1 from jsonb_array_elements(final_value->'status_effects') status where coalesce(status->>'player_id','')='' or not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=status->>'player_id'))
  then raise exception using errcode='23503',message='STATUS_PLAYER_NOT_FOUND'; end if;
  if exists(select 1 from jsonb_array_elements(final_value->'player_outcomes') outcome where coalesce(outcome->>'player_id','')='' or upper(coalesce(outcome->>'life_state','')) not in ('UNCHANGED','ALIVE','DEAD','REVIVED') or not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=outcome->>'player_id'))
    or exists(select 1 from jsonb_array_elements(final_value->'player_outcomes') outcome where coalesce(outcome->>'role_id','')<>'' and not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,roles}','[]'::jsonb)) role where role->>'id'=outcome->>'role_id'))
    or exists(select 1 from jsonb_array_elements(final_value->'player_outcomes') outcome where coalesce(outcome->>'faction_id','')<>'' and not exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,factions}','[]'::jsonb)) faction where faction->>'id'=outcome->>'faction_id'))
  then raise exception using errcode='23503',message='PLAYER_OUTCOME_REFERENCE_NOT_FOUND'; end if;
  if exists(select 1 from jsonb_array_elements(final_value->'player_outcomes') outcome where outcome->>'life_state'='DEAD' and not exists(select 1 from jsonb_array_elements(final_value->'action_results') action where action->>'result'='SUCCESS' and exists(select 1 from jsonb_array_elements_text(action->'affected_player_ids') affected where affected=outcome->>'player_id'))) then warnings:=warnings||jsonb_build_array('A player is marked DEAD without a successful effect affecting that player.'); end if;
  if jsonb_array_length(warnings)>0 and not coalesce(target_override_warnings,false) then raise exception using errcode='22023',message='RULING_WARNINGS_REQUIRE_GM_OVERRIDE',detail=warnings::text; end if;
  select coalesce(array_agg(item.value->>'action_id'),'{}'::text[]) into consumed_from_ruling from jsonb_array_elements(final_value->'action_results') as item(value) where item.value->>'use_disposition'='CONSUMED' and coalesce(item.value->>'player_ability_grant_id','')<>'';
  if (select coalesce(array_agg(value order by value),'{}') from unnest(coalesce(target_consumed_action_ids,'{}')) value) is distinct from (select coalesce(array_agg(value order by value),'{}') from unnest(consumed_from_ruling) value) then raise exception using errcode='22023',message='GRANT_CONSUMPTION_MISMATCH'; end if;

  -- Canonical server-owned event projection. Attempts are never derived from
  -- this list, so redirects, reflections and audits cannot duplicate attempts.
  select coalesce(jsonb_agg(source.event order by source.sort_order),'[]'::jsonb) into canonical_events from (
    select ordinality*10 sort_order,jsonb_build_object('action_id',item->>'action_id','event_type',case item->>'result' when 'BLOCKED' then 'BLOCK' else item->>'result' end,'actor_player_id',item->>'actor_player_id','target_player_id',coalesce(item#>>'{final_target_ids,0}',''),'ability_id',item->>'ability_id','affected_player_ids',coalesce(item->'affected_player_ids','[]'::jsonb),'uses_consumed',case when item->>'use_disposition'='CONSUMED' then 1 else 0 end,'uses_refunded',case when item->>'use_disposition'='REFUNDED' then 1 else 0 end,'result',item->>'result','summary',coalesce(item->>'reason',item->>'ability_name'||': '||item->>'result'),'role_id',item->>'role_id','role_version',item->'role_version','ability_source',item->>'ability_source','source_type',item->>'source_type','source_faction_id',item->>'source_faction_id','original_target_ids',coalesce(item->'original_target_ids','[]'::jsonb),'final_target_ids',coalesce(item->'final_target_ids','[]'::jsonb)) event from jsonb_array_elements(final_value->'action_results') with ordinality action(item,ordinality)
    union all select ordinality*10+1,jsonb_build_object('action_id',item->>'action_id','event_type','REDIRECT','actor_player_id',item->>'actor_player_id','target_player_id',coalesce(item#>>'{final_target_ids,0}',''),'ability_id',item->>'ability_id','affected_player_ids',coalesce(item->'affected_player_ids','[]'::jsonb),'uses_consumed',0,'uses_refunded',0,'result','REDIRECTED','summary','Action redirected.','role_id',item->>'role_id','role_version',item->'role_version','ability_source',item->>'ability_source','source_type',item->>'source_type','source_faction_id',item->>'source_faction_id','original_target_ids',coalesce(item->'original_target_ids','[]'::jsonb),'final_target_ids',coalesce(item->'final_target_ids','[]'::jsonb)) from jsonb_array_elements(final_value->'action_results') with ordinality action(item,ordinality) where coalesce((item->>'redirected')::boolean,false)
    union all select ordinality*10+2,jsonb_build_object('action_id',item->>'action_id','event_type','REFLECT','actor_player_id',item->>'actor_player_id','target_player_id',coalesce(item#>>'{final_target_ids,0}',''),'ability_id',item->>'ability_id','affected_player_ids',coalesce(item->'affected_player_ids','[]'::jsonb),'uses_consumed',0,'uses_refunded',0,'result','REFLECTED','summary','Action reflected.','role_id',item->>'role_id','role_version',item->'role_version','ability_source',item->>'ability_source','source_type',item->>'source_type','source_faction_id',item->>'source_faction_id','original_target_ids',coalesce(item->'original_target_ids','[]'::jsonb),'final_target_ids',coalesce(item->'final_target_ids','[]'::jsonb)) from jsonb_array_elements(final_value->'action_results') with ordinality action(item,ordinality) where coalesce((item->>'reflected')::boolean,false)
    union all select ordinality*10+3,jsonb_build_object('action_id',item->>'action_id','event_type',case item->>'use_disposition' when 'CONSUMED' then 'ABILITY_CONSUMED' else 'USE_REFUNDED' end,'actor_player_id',item->>'actor_player_id','target_player_id','','ability_id',item->>'ability_id','affected_player_ids','[]'::jsonb,'uses_consumed',case when item->>'use_disposition'='CONSUMED' then 1 else 0 end,'uses_refunded',case when item->>'use_disposition'='REFUNDED' then 1 else 0 end,'result',item->>'use_disposition','summary','Final GM ability-use disposition.','role_id',item->>'role_id','role_version',item->'role_version','ability_source',item->>'ability_source','source_type',item->>'source_type','source_faction_id',item->>'source_faction_id','original_target_ids','[]'::jsonb,'final_target_ids','[]'::jsonb) from jsonb_array_elements(final_value->'action_results') with ordinality action(item,ordinality) where item->>'use_disposition' in ('CONSUMED','REFUNDED')
    union all select 2000+ordinality,jsonb_build_object('action_id',coalesce(item->>'source_action_id',''),'event_type',case item->>'result' when 'PREVENTED' then 'PASSIVE_PREVENTED' else 'PASSIVE_TRIGGER' end,'actor_player_id',item->>'player_id','target_player_id',coalesce(item#>>'{target_ids,0}',''),'ability_id',item->>'ability_id','affected_player_ids',coalesce(item->'affected_player_ids','[]'::jsonb),'uses_consumed',coalesce(nullif(item->>'uses_consumed','')::integer,0),'uses_refunded',coalesce(nullif(item->>'uses_refunded','')::integer,0),'result',item->>'result','summary',coalesce(item->>'effect',item->>'reason','Passive triggered.'),'role_id',item->>'role_id','role_version',coalesce(item->'role_version','1'::jsonb),'ability_source','ROLE','source_type','ROLE','source_faction_id','','original_target_ids',coalesce(item->'target_ids','[]'::jsonb),'final_target_ids',coalesce(item->'target_ids','[]'::jsonb),'trigger_count',coalesce(item->'trigger_count','1'::jsonb)) from jsonb_array_elements(final_value->'passive_results') with ordinality passive(item,ordinality) where coalesce((item->>'triggered')::boolean,false)
    union all select 3000+ordinality,jsonb_build_object('action_id','','event_type',case item->>'operation' when 'REMOVE' then 'STATUS_REMOVED' else 'STATUS_ADDED' end,'actor_player_id',coalesce(item->>'source_player_id',''),'target_player_id',item->>'player_id','ability_id',coalesce(item->>'source_ability_id',''),'affected_player_ids',jsonb_build_array(item->>'player_id'),'uses_consumed',0,'uses_refunded',0,'result',item->>'operation','summary',coalesce(item->>'reason',item->>'status_name'),'role_id',coalesce(item->>'source_role_id',''),'role_version',1,'ability_source','ROLE','source_type','ROLE','source_faction_id','','original_target_ids',jsonb_build_array(item->>'player_id'),'final_target_ids',jsonb_build_array(item->>'player_id')) from jsonb_array_elements(final_value->'status_effects') with ordinality status(item,ordinality)
    union all select 4000+ordinality,jsonb_build_object('action_id','','event_type',case item->>'life_state' when 'DEAD' then 'DEATH' when 'ALIVE' then 'SURVIVAL' when 'REVIVED' then 'STATE_CHANGE' else 'OTHER' end,'actor_player_id','','target_player_id',item->>'player_id','ability_id','','affected_player_ids',jsonb_build_array(item->>'player_id'),'uses_consumed',0,'uses_refunded',0,'result',item->>'life_state','summary',coalesce(item->>'summary','Final player outcome.'),'role_id',coalesce(item->>'role_id',''),'role_version',1,'ability_source','','source_type','','source_faction_id',coalesce(item->>'faction_id',''),'original_target_ids',jsonb_build_array(item->>'player_id'),'final_target_ids',jsonb_build_array(item->>'player_id')) from jsonb_array_elements(final_value->'player_outcomes') with ordinality outcome(item,ordinality) where item->>'life_state'<>'UNCHANGED'
    union all select 5000+ordinality,jsonb_build_object('action_id','','event_type','CONVERSION','actor_player_id','','target_player_id',item->>'player_id','ability_id','','affected_player_ids',jsonb_build_array(item->>'player_id'),'uses_consumed',0,'uses_refunded',0,'result','FACTION_CHANGED','summary',coalesce(item->>'summary','Faction changed.'),'role_id',coalesce(item->>'role_id',''),'role_version',1,'ability_source','','source_type','','source_faction_id',item->>'faction_id','original_target_ids',jsonb_build_array(item->>'player_id'),'final_target_ids',jsonb_build_array(item->>'player_id')) from jsonb_array_elements(final_value->'player_outcomes') with ordinality outcome(item,ordinality) where coalesce(item->>'faction_id','')<>'' and item->>'faction_id' is distinct from (select coalesce(player->>'currentFactionId',player->>'factionId','') from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=item->>'player_id' limit 1)
    union all select 6000+ordinality,jsonb_build_object('action_id','','event_type','OTHER','actor_player_id','','target_player_id',coalesce(item->>'player_id',item->>'target_id',''),'ability_id','','affected_player_ids',case when coalesce(item->>'player_id','')='' then '[]'::jsonb else jsonb_build_array(item->>'player_id') end,'uses_consumed',0,'uses_refunded',0,'result',coalesce(item->>'type','OTHER'),'summary',coalesce(item->>'summary',item->>'value','Other approved effect.'),'role_id','','role_version',1,'ability_source','','source_type','','source_faction_id','','original_target_ids','[]'::jsonb,'final_target_ids','[]'::jsonb) from jsonb_array_elements(final_value->'other_effects') with ordinality effect(item,ordinality)
  ) source;
  final_value:=jsonb_set(final_value,'{events}',canonical_events,false);
  differences:=jsonb_build_object(
    'changed',coalesce(session_row.ai_proposal->'resolution','{}'::jsonb) is distinct from final_value,
    'actions',coalesce((select jsonb_agg(jsonb_build_object('action_id',final_action->>'action_id','ai_result',ai_action->>'result','final_result',final_action->>'result','ai_targets',coalesce(ai_action->'final_target_ids','[]'::jsonb),'final_targets',coalesce(final_action->'final_target_ids','[]'::jsonb),'ai_use',ai_action->>'use_disposition','final_use',final_action->>'use_disposition')) from jsonb_array_elements(final_value->'action_results') final_action left join lateral (select item from jsonb_array_elements(coalesce(session_row.ai_proposal#>'{resolution,action_results}','[]'::jsonb)) item where item->>'action_id'=final_action->>'action_id' limit 1) matched(ai_action) on true where matched.ai_action is null or matched.ai_action is distinct from final_action),'[]'::jsonb),
    'passives_changed',coalesce(session_row.ai_proposal#>'{resolution,passive_results}','[]'::jsonb) is distinct from final_value->'passive_results',
    'statuses_changed',coalesce(session_row.ai_proposal#>'{resolution,status_effects}','[]'::jsonb) is distinct from final_value->'status_effects',
    'player_outcomes_changed',coalesce(session_row.ai_proposal#>'{resolution,player_outcomes}','[]'::jsonb) is distinct from final_value->'player_outcomes',
    'recorded_at',now()
  );
  update public.resolution_sessions set approval_idempotency_key=target_idempotency_key,ruling_differences=differences,approval_validation=jsonb_build_object('validatedAt',now(),'override',coalesce(target_override_warnings,false),'warnings',warnings) where id=target_session_id;
  result:=private.finalize_resolution_with_grants(target_session_id,expected_lock_version,'MODIFY',final_value,target_gm_explanation,target_teach_ai,target_teach_scope,consumed_from_ruling);

  -- Apply/remove statuses and granted abilities only after the immutable final
  -- ruling has been accepted. Any later error rolls the entire transaction back.
  for status_effect in select value from jsonb_array_elements(final_value->'status_effects') loop
    if status_effect->>'operation'='REMOVE' then
      if coalesce(status_effect->>'status_id','')='' then raise exception using errcode='22023',message='STATUS_ID_REQUIRED'; end if;
      status_result:=public.mutate_player_status(result.game_id,(status_effect->>'status_id')::uuid,'RESOLVE',jsonb_build_object('reason',coalesce(status_effect->>'reason','Removed by approved final ruling.')));
    else
      status_result:=public.mutate_player_status(result.game_id,null,'APPLY',jsonb_strip_nulls(jsonb_build_object('player_id',status_effect->>'player_id','status_type',status_effect->>'status_type','status_name',status_effect->>'status_name','status_category',coalesce(status_effect->>'status_category','TEMPORARY'),'state',coalesce(status_effect->>'state','ACTIVE'),'source_player_id',nullif(status_effect->>'source_player_id',''),'source_role_id',nullif(status_effect->>'source_role_id',''),'source_ability_id',nullif(status_effect->>'source_ability_id',''),'description',coalesce(status_effect->>'description',''),'applied_at_cycle',result.cycle,'applied_at_phase',result.phase,'duration',nullif(status_effect->>'duration',''),'expires_at_cycle',nullif(status_effect->>'expires_at_cycle',''),'expires_at_phase',nullif(status_effect->>'expires_at_phase',''),'remaining_duration',nullif(status_effect->>'remaining_duration',''),'visibility',coalesce(status_effect->>'visibility','GM_ONLY'),'reason',coalesce(status_effect->>'reason','Applied by approved final ruling.'),'metadata',jsonb_build_object('resolutionSessionId',result.id))));
    end if;
  end loop;
  for grant_effect in select value from jsonb_array_elements(final_value->'grant_effects') loop
    if grant_effect->>'operation'='GRANT' then
      grant_result:=private.grant_player_ability(result.game_id,stored.version,grant_effect->>'player_id',grant_effect->>'ability_id',coalesce(grant_effect->>'source_type','GM_GRANT'),coalesce(grant_effect->>'source_reference',result.id::text),coalesce(grant_effect->>'reason','Granted by approved final ruling.'),nullif(nullif(grant_effect->>'uses','')::integer,0),coalesce(grant_effect->>'duration_type','UNTIL_REMOVED'),nullif(grant_effect->>'expires_at','')::timestamptz,nullif(nullif(grant_effect->>'expires_cycle','')::integer,0),coalesce(grant_effect->>'expires_phase',''),coalesce(array(select jsonb_array_elements_text(coalesce(grant_effect->'phase_restrictions','[]'::jsonb))),'{}'),coalesce(grant_effect->'special_conditions','{}'::jsonb),coalesce(nullif(grant_effect->>'survives_conversion','')::boolean,false),coalesce(nullif(grant_effect->>'stealable','')::boolean,true),jsonb_build_object('resolutionSessionId',result.id));
    elsif grant_effect->>'operation' in ('REVOKE','SET_USES') then
      grant_result:=private.mutate_player_ability_grant((grant_effect->>'grant_id')::uuid,coalesce(nullif(grant_effect->>'grant_version','')::integer,1),grant_effect->>'operation',coalesce(grant_effect->>'reason','Changed by approved final ruling.'),nullif(grant_effect->>'uses','')::integer);
    else raise exception using errcode='22023',message='INVALID_GRANT_EFFECT'; end if;
  end loop;

  select coalesce(jsonb_agg(
    case when outcome.value is null then player.value else player.value
      ||case outcome.value->>'life_state' when 'DEAD' then jsonb_build_object('alive',false) when 'ALIVE' then jsonb_build_object('alive',true) when 'REVIVED' then jsonb_build_object('alive',true) else '{}'::jsonb end
      ||case when coalesce(outcome.value->>'role_id','')<>'' then jsonb_build_object('roleId',outcome.value->>'role_id') when outcome.value->>'role_id'='' and exists(select 1 from jsonb_array_elements(coalesce(outcome.value->'changes','[]'::jsonb)) role_change where role_change->>'type'='ROLE' and role_change->>'after'='') then jsonb_build_object('roleId','','currentModeId','','modeName','') else '{}'::jsonb end
      ||case when coalesce(outcome.value->>'faction_id','')<>'' then jsonb_build_object('currentFactionId',outcome.value->>'faction_id') else '{}'::jsonb end
    end order by player.ordinality),'[]'::jsonb) into next_players
  from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) with ordinality player(value,ordinality)
  left join lateral (select item.value from jsonb_array_elements(final_value->'player_outcomes') item(value) where item.value->>'player_id'=player.value->>'id' limit 1) outcome on true;
  select coalesce(jsonb_agg(case when official.value is null then action.value else action.value||jsonb_build_object('status','RESOLVED','officialResult',official.value->>'result','finalTargetIds',official.value->'final_target_ids','resolvedBySessionId',result.id::text) end order by action.ordinality),'[]'::jsonb) into next_actions
  from jsonb_array_elements(coalesce(stored.document#>'{data,actions}','[]'::jsonb)) with ordinality action(value,ordinality)
  left join lateral (select item.value from jsonb_array_elements(final_value->'action_results') item(value) where item.value->>'action_id'=action.value->>'id' limit 1) official on true;
  next_document:=jsonb_set(jsonb_set(stored.document,'{data,players}',next_players,false),'{data,actions}',next_actions,false);
  select * into saved from public.save_game_document(result.game_id,stored.version,next_document,'Master GM ruling approved and applied','resolution_session',result.id::text) limit 1;
  if result.phase_id is not null then
    update public.game_phases phase_update set action_queue=coalesce((select jsonb_agg(case when official.value is null then action.value else action.value||jsonb_build_object('status','RESOLVED','officialResult',official.value->>'result','finalTargetIds',official.value->'final_target_ids','resolvedBySessionId',result.id::text) end order by action.ordinality) from jsonb_array_elements(phase_update.action_queue) with ordinality action(value,ordinality) left join lateral (select item.value from jsonb_array_elements(final_value->'action_results') item(value) where item.value->>'action_id'=action.value->>'id' limit 1) official on true),'[]'::jsonb),resolution_summary=phase_update.resolution_summary||jsonb_build_object('official',true,'appliedGameVersion',saved.version,'validationWarnings',warnings),updated_at=now() where phase_update.id=result.phase_id;
  end if;
  delete from public.resolution_session_events where session_id=result.id;
  for event_item in select value from jsonb_array_elements(canonical_events) loop
    ordinal:=ordinal+1;event_kind:=upper(event_item->>'event_type');
    insert into public.resolution_session_events(session_id,game_id,event_order,event_type,actor_player_id,target_player_id,ability_id,outcome,action_id,role_id,role_version,ability_source,source_type,source_faction_id,original_target_ids,final_target_ids)
    values(result.id,result.game_id,ordinal,event_kind,nullif(event_item->>'actor_player_id',''),nullif(event_item->>'target_player_id',''),nullif(event_item->>'ability_id',''),event_item,nullif(event_item->>'action_id',''),nullif(event_item->>'role_id',''),nullif(event_item->>'role_version','')::integer,nullif(event_item->>'ability_source',''),nullif(event_item->>'source_type',''),nullif(event_item->>'source_faction_id',''),coalesce(array(select jsonb_array_elements_text(coalesce(event_item->'original_target_ids','[]'::jsonb))),'{}'),coalesce(array(select jsonb_array_elements_text(coalesce(event_item->'final_target_ids','[]'::jsonb))),'{}'));
  end loop;
  update public.resolution_sessions set post_resolution_state=jsonb_build_object('gameVersion',saved.version,'players',next_players,'statusesApplied',jsonb_array_length(final_value->'status_effects'),'grantEffects',jsonb_array_length(final_value->'grant_effects')),applied_game_version=saved.version,ruling_differences=differences,approval_validation=jsonb_build_object('validatedAt',now(),'override',coalesce(target_override_warnings,false),'warnings',warnings,'canonicalEventCount',ordinal) where id=result.id returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(result.game_id,actor,'resolution_session',result.id::text,'Final GM ruling applied transactionally',jsonb_build_object('idempotencyKey',target_idempotency_key,'gameVersion',saved.version,'differences',differences,'warnings',warnings,'eventCount',ordinal));
  return result;
end$function$
;

