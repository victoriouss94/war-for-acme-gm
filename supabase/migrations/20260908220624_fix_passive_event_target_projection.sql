-- Keep passive target metadata consistent with its official target columns.
-- No live state change or historical event backfill; existing ACL/signature preserved.
do $guard$
begin
  if md5(pg_get_functiondef('private.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)'::regprocedure)) <> '56839759881652165eb3833accc01bd6' then
    raise exception 'PASSIVE_PROJECTION_SOURCE_CHANGED';
  end if;
end $guard$;

CREATE OR REPLACE FUNCTION private.approve_and_apply_resolution(target_session_id uuid, expected_lock_version integer, target_final_resolution jsonb, target_gm_explanation text, target_teach_ai boolean, target_teach_scope text, target_consumed_action_ids text[], target_idempotency_key uuid, target_override_warnings boolean, target_reject boolean)
 RETURNS resolution_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item jsonb;queued jsonb;last_priority integer:=0;item_priority integer;canonical jsonb;result public.resolution_sessions%rowtype;
begin
  if not coalesce(target_reject,false) then
    if jsonb_typeof(target_final_resolution->'action_results') is distinct from 'array' then raise exception using errcode='22023',message='INVALID_STRUCTURED_FINAL_RULING'; end if;
    for item in select value from jsonb_array_elements(target_final_resolution->'action_results') order by coalesce(nullif(value->>'order','')::integer,999999) loop
      if coalesce(item->>'resolution_category','') not in ('BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC','PASSIVES') then raise exception using errcode='22023',message='ABILITY_CLASSIFICATION_REQUIRED'; end if;
      if item->>'resolution_category' not in ('PASSIVES') and coalesce(item->>'resolution_timing','ORDERED_STAGE')<>'ANY_TIME' then
        item_priority:=array_position(array['BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS_EFFECTS','INTEL','CONVERTS','KILLS','DOC'],item->>'resolution_category');
        if item_priority<last_priority then raise exception using errcode='22023',message='INVALID_GLOBAL_RESOLUTION_ORDER'; end if;last_priority:=item_priority;
      end if;
      if coalesce((item->>'generated')::boolean,false) and (coalesce((item->>'submitted_attempt')::boolean,false) or coalesce(item->>'parent_action_id','')='') then raise exception using errcode='22023',message='INVALID_GENERATED_EFFECT_LINEAGE'; end if;
      if jsonb_typeof(coalesce(item->'transformation_history','[]'::jsonb))<>'array' then raise exception using errcode='22023',message='INVALID_TRANSFORMATION_HISTORY'; end if;
      select value into queued from public.resolution_sessions session_row cross join lateral jsonb_array_elements(session_row.submitted_actions) action(value) where session_row.id=target_session_id and action.value->>'id'=item->>'action_id' limit 1;
      if queued is not null and coalesce(item->'original_target_ids','[]'::jsonb) is distinct from coalesce(queued->'originalTargetIds',queued->'targetIds','[]'::jsonb) then raise exception using errcode='22023',message='ORIGINAL_TARGETS_IMMUTABLE'; end if;
    end loop;
    canonical:=jsonb_set(target_final_resolution,'{resolution_order}',to_jsonb(array['BLOCKS','GUARANTEE','CONTROL','SWAPS','REDIRECTS','STATUS EFFECTS','INTEL','CONVERTS','KILLS','DOC']),true);
  else canonical:=target_final_resolution; end if;
  result:=private.approve_and_apply_resolution_v11_5(target_session_id,expected_lock_version,canonical,target_gm_explanation,target_teach_ai,target_teach_scope,target_consumed_action_ids,target_idempotency_key,target_override_warnings,target_reject);
  if not coalesce(target_reject,false) and result.status='FINALIZED' then
    with action_metadata as (
      select value from jsonb_array_elements(coalesce(result.final_resolution->'action_results','[]'::jsonb)) value
    )
    update public.resolution_session_events event_row set outcome=event_row.outcome||jsonb_build_object(
      'standardized_ability_type',metadata.value->>'standardized_ability_type','resolution_category',metadata.value->>'resolution_category',
      'resolution_priority',metadata.value->'resolution_priority','resolution_timing',metadata.value->>'resolution_timing',
      'source_game_rule',metadata.value->>'source_game_rule','global_rule_used',metadata.value->>'global_rule_used','gm_override',metadata.value->'gm_override',
      'original_target_ids',coalesce(metadata.value->'original_target_ids','[]'::jsonb),'final_target_ids',coalesce(metadata.value->'final_target_ids','[]'::jsonb),
      'effective_target_ids',coalesce(metadata.value->'final_target_ids','[]'::jsonb),'transformation_history',coalesce(metadata.value->'transformation_history','[]'::jsonb),
      'generated',coalesce(metadata.value->'generated','false'::jsonb),'parent_action_id',coalesce(metadata.value->>'parent_action_id',''),
      'submitted_attempt',coalesce(metadata.value->'submitted_attempt','true'::jsonb)
    ) from action_metadata metadata
    where event_row.session_id=result.id and event_row.action_id=metadata.value->>'action_id';

    with passive_metadata as (
      select value from jsonb_array_elements(coalesce(result.final_resolution->'passive_results','[]'::jsonb)) value where coalesce((value->>'triggered')::boolean,false)
    )
    update public.resolution_session_events event_row set outcome=event_row.outcome||jsonb_build_object(
      'standardized_ability_type',coalesce(metadata.value->>'ability_name',metadata.value->>'ability_id','Passive'),
      'resolution_category','PASSIVES','resolution_priority','null'::jsonb,'resolution_timing','EVENT_TRIGGERED',
      'original_target_ids',coalesce(metadata.value->'target_ids','[]'::jsonb),
      'final_target_ids',coalesce(metadata.value->'target_ids','[]'::jsonb),
      'effective_target_ids',coalesce(metadata.value->'target_ids',metadata.value->'affected_player_ids','[]'::jsonb),
      'transformation_history','[]'::jsonb,'generated',false,'parent_action_id',coalesce(metadata.value->>'source_action_id',''),'submitted_attempt',false
    ) from passive_metadata metadata
    where event_row.session_id=result.id and event_row.event_type in ('PASSIVE_TRIGGER','PASSIVE_PREVENTED')
      and coalesce(event_row.action_id,'')=coalesce(metadata.value->>'source_action_id','')
      and coalesce(event_row.ability_id,'')=coalesce(metadata.value->>'ability_id','')
      and coalesce(event_row.actor_player_id,'')=coalesce(metadata.value->>'player_id','');
  end if;
  return result;
end$function$
;

