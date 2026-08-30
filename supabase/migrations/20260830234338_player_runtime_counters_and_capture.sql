-- Player-specific finite counters and phase-bounded capture restrictions.
-- No role definitions, ability definitions, or existing game data are rewritten.
create or replace function private.validate_player_runtime_action(target_game_id uuid,target_action jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  stored public.game_documents%rowtype;
  action_player text:=coalesce(target_action->>'sourcePlayerId',target_action->>'actorId','');
  source_kind text:=upper(coalesce(target_action->>'sourceType','PLAYER'));
  current_cycle integer;current_phase text;player_role text;
  counter public.player_ability_grants%rowtype;
begin
  if (select auth.uid()) is null or not public.can_edit_game(target_game_id) then
    raise exception using errcode='42501',message='GM_ACCESS_REQUIRED';
  end if;
  select * into stored from public.game_documents d where d.game_id=target_game_id for update;
  current_cycle:=coalesce((stored.document#>>'{game,currentDay}')::integer,0);
  current_phase:=stored.document#>>'{game,currentPhase}';
  if source_kind in ('PLAYER','FACTION') and action_player<>'' and exists(
    select 1 from public.player_status_effects e where e.game_id=target_game_id and e.player_id=action_player and e.state='ACTIVE'
      and (e.status_type='ABILITIES_DISABLED' or e.status_type='CAPTURED' and e.metadata->>'abilitiesDisabled'='true')
      and (e.applied_at_cycle is null or e.applied_at_cycle<=current_cycle)
      and (e.expires_at_cycle is null or e.expires_at_cycle>=current_cycle)
      and not(coalesce(e.applied_at_cycle=current_cycle,false) and coalesce(e.applied_at_phase,'')='Night' and current_phase='Day')
      and not(coalesce(e.expires_at_cycle=current_cycle,false) and coalesce(e.expires_at_phase,'')='Day' and current_phase='Night')
      and (nullif(e.metadata->>'disabledCycle','') is null or e.metadata->>'disabledCycle'=current_cycle::text)
      and (nullif(e.metadata->>'disabledPhase','') is null or e.metadata->>'disabledPhase' in ('Any',current_phase))
  ) then raise exception using errcode='22023',message='PLAYER_ABILITIES_DISABLED_FOR_PHASE'; end if;
  if source_kind='PLAYER' and nullif(target_action->>'playerAbilityGrantId','') is null then
    select p->>'roleId' into player_role from jsonb_array_elements(stored.document#>'{data,players}') p where p->>'id'=action_player;
    select * into counter from public.player_ability_grants g where g.game_id=target_game_id
      and g.player_id=action_player and g.ability_id=target_action->>'abilityId'
      and g.source_type='ROLE' and g.source_reference=player_role and g.metadata->>'replacesRoleAbility'='true'
      and g.status in ('ACTIVE','CONSUMED') and g.uses_remaining is not null
      order by g.created_at desc,g.id desc limit 1 for update;
    if found then
      if counter.uses_remaining<=0 or counter.status='CONSUMED' then
        raise exception using errcode='22023',message='ROLE_ABILITY_USES_EXHAUSTED';
      end if;
      target_action:=target_action||jsonb_build_object('playerAbilityGrantId',counter.id,'grantVersion',counter.version,'abilitySource','ROLE');
    end if;
  end if;
  return target_action;
end $$;
revoke all on function private.validate_player_runtime_action(uuid,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.queue_player_action(target_game_id uuid, expected_game_version integer, target_action jsonb, target_replace_action_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_row public.game_phases%rowtype;updated_row public.game_phases%rowtype;result jsonb;phase_actions jsonb;requested_phase_id uuid;requested_phase_version integer;mode_context jsonb;patched_document jsonb;patched_actions jsonb;saved record;switched_state public.player_mode_states%rowtype;
begin
  if (select auth.uid()) is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  begin requested_phase_id:=(target_action->>'phaseId')::uuid;requested_phase_version:=(target_action->>'phaseVersion')::integer;exception when others then raise exception using errcode='22023',message='PHASE_CONTEXT_REQUIRED'; end;
  select * into current_row from public.game_phases phase_row where phase_row.game_id=target_game_id and phase_row.status='CURRENT' for update;if not found or current_row.id<>requested_phase_id then raise exception using errcode='40001',message='PHASE_CHANGED'; end if;if current_row.queue_version<>requested_phase_version then raise exception using errcode='40001',message='PHASE_VERSION_CONFLICT'; end if;if (select game.status from public.games game where game.id=target_game_id)<>'ACTIVE' then raise exception using errcode='55000',message='GAME_NOT_ACTIVE'; end if;
  target_action:=private.validate_player_runtime_action(target_game_id,target_action);
  mode_context:=private.validate_player_action_mode_context(target_game_id,target_action);
  if coalesce((mode_context->>'requiresSwitch')::boolean,false) then switched_state:=private.change_player_mode_state(target_game_id,coalesce(target_action->>'sourcePlayerId',target_action->>'actorId'),mode_context->>'modeId','Switched to '||coalesce(mode_context->>'modeName','configuration')||' before queued action.','PLAYER_SELECTED',false);mode_context:=mode_context||jsonb_build_object('currentModeId',switched_state.current_mode_id,'requiresSwitch',false,'switchedBeforeAction',true);end if;
  result:=private.queue_player_action_document_v11_2(target_game_id,expected_game_version,target_action,target_replace_action_id);
  if mode_context<>'{}'::jsonb then result:=jsonb_set(result,'{action}',(result->'action')||jsonb_build_object('modeId',mode_context->>'modeId','modeName',mode_context->>'modeName','modeContext',mode_context),false);select coalesce(jsonb_agg(case when item->>'id'=result#>>'{action,id}' then item||jsonb_build_object('modeId',mode_context->>'modeId','modeName',mode_context->>'modeName','modeContext',mode_context) else item end order by ordinality),'[]'::jsonb) into patched_actions from jsonb_array_elements(coalesce(result#>'{document,data,actions}','[]'::jsonb)) with ordinality queued(item,ordinality);patched_document:=jsonb_set(result->'document','{data,actions}',patched_actions,false);select * into saved from public.save_game_document(target_game_id,(result->>'version')::integer,patched_document,'Configuration context attached to queued ability','action',result#>>'{action,id}') limit 1;result:=result||jsonb_build_object('document',saved.document,'version',saved.version,'updated_at',saved.updated_at,'updated_by',saved.updated_by);end if;
  select coalesce(jsonb_agg(item||jsonb_build_object('phaseId',current_row.id,'phaseVersion',current_row.queue_version+1) order by ordinality),'[]'::jsonb) into phase_actions from jsonb_array_elements(coalesce(result#>'{document,data,actions}','[]'::jsonb)) with ordinality queued(item,ordinality);update public.game_phases phase_row set action_queue=phase_actions,queue_version=phase_row.queue_version+1,updated_at=now() where phase_row.id=current_row.id returning * into updated_row;insert into public.game_phase_events(game_id,phase_id,event_type,action_id,summary,payload,actor_user_id) values(target_game_id,current_row.id,case when target_replace_action_id is null then 'ACTION_QUEUED' else 'ACTION_EDITED' end,result#>>'{action,id}',coalesce(result#>>'{action,name}','Structured action')||case when target_replace_action_id is null then ' queued.' else ' edited.' end,jsonb_build_object('phaseVersion',updated_row.queue_version,'action',result->'action'),auth.uid());return result||jsonb_build_object('phase',to_jsonb(updated_row),'document',jsonb_set(result->'document','{data,actions}',phase_actions,false));
end$function$;

revoke all on function private.queue_player_action(uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
