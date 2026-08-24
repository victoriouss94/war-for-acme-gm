-- GM Command Center v11.5: editable Master GM rulings, one approval/apply
-- transaction, immutable AI-vs-GM differences, and source-correct usage data.

alter table public.resolution_sessions
  add column approval_idempotency_key uuid,
  add column ruling_differences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(ruling_differences)='object' and octet_length(ruling_differences::text)<=300000),
  add column approval_validation jsonb not null default '{}'::jsonb
    check (jsonb_typeof(approval_validation)='object' and octet_length(approval_validation::text)<=100000),
  add column applied_game_version integer check (applied_game_version is null or applied_game_version>0);

create unique index resolution_sessions_approval_idempotency_idx
  on public.resolution_sessions(approval_idempotency_key)
  where approval_idempotency_key is not null;
create index resolution_sessions_game_status_cycle_phase_idx
  on public.resolution_sessions(game_id,status,cycle,phase,created_at desc);

alter table public.resolution_session_events
  add column role_id text check (role_id is null or char_length(role_id) between 1 and 100),
  add column role_version integer check (role_version is null or role_version between 1 and 100000),
  add column ability_source text check (ability_source is null or char_length(ability_source) between 1 and 64),
  add column source_type text check (source_type is null or char_length(source_type) between 1 and 64),
  add column source_faction_id text check (source_faction_id is null or char_length(source_faction_id) between 1 and 100),
  add column original_target_ids text[] not null default '{}',
  add column final_target_ids text[] not null default '{}';

create index resolution_session_events_game_action_idx
  on public.resolution_session_events(game_id,action_id)
  where action_id is not null;
create index resolution_session_events_game_role_ability_type_idx
  on public.resolution_session_events(game_id,role_id,ability_id,event_type)
  where role_id is not null or ability_id is not null;
create index resolution_session_events_game_source_faction_type_idx
  on public.resolution_session_events(game_id,source_type,source_faction_id,event_type)
  where source_type is not null;

-- Carry forward attribution already preserved inside older official event JSON,
-- then fill action-owned fields from the immutable submitted-action snapshot.
update public.resolution_session_events event_row set
  role_id=nullif(event_row.outcome->>'role_id',''),
  role_version=case when coalesce(event_row.outcome->>'role_version','')~'^[0-9]+$' then least(100000,greatest(1,(event_row.outcome->>'role_version')::integer)) end,
  ability_source=nullif(upper(event_row.outcome->>'ability_source'),''),
  source_type=nullif(upper(coalesce(event_row.outcome->>'source_type',event_row.outcome->>'ability_source')),''),
  source_faction_id=nullif(event_row.outcome->>'source_faction_id',''),
  original_target_ids=case when jsonb_typeof(event_row.outcome->'original_target_ids')='array' then coalesce(array(select jsonb_array_elements_text(event_row.outcome->'original_target_ids')),'{}') else event_row.original_target_ids end,
  final_target_ids=case when jsonb_typeof(event_row.outcome->'final_target_ids')='array' then coalesce(array(select jsonb_array_elements_text(event_row.outcome->'final_target_ids')),'{}') when event_row.target_player_id is not null then array[event_row.target_player_id] else event_row.final_target_ids end;

with event_attribution as (
  select event_row.id event_id,queued.action
  from public.resolution_session_events event_row
  join public.resolution_sessions session_row on session_row.id=event_row.session_id
  cross join lateral (
    select action
    from jsonb_array_elements(session_row.submitted_actions) action
    where action->>'id'=event_row.action_id
    limit 1
  ) queued
  where event_row.action_id is not null
)
update public.resolution_session_events event_row set
  role_id=coalesce(event_row.role_id,nullif(queued.action->>'roleId','')),
  role_version=coalesce(event_row.role_version,case when coalesce(queued.action->>'roleVersion','')~'^[0-9]+$' then least(100000,greatest(1,(queued.action->>'roleVersion')::integer)) else 1 end),
  ability_source=coalesce(event_row.ability_source,nullif(upper(coalesce(queued.action->>'abilitySource',case when queued.action->>'sourceType'='PLAYER' then 'ROLE' else queued.action->>'sourceType' end)),'')),
  source_type=coalesce(event_row.source_type,nullif(upper(coalesce(queued.action->>'abilitySource',case when queued.action->>'sourceType'='PLAYER' then 'ROLE' else queued.action->>'sourceType' end)),'')),
  source_faction_id=coalesce(event_row.source_faction_id,nullif(queued.action->>'sourceFactionId','')),
  original_target_ids=case when cardinality(event_row.original_target_ids)=0 and jsonb_typeof(queued.action->'targetIds')='array' then coalesce(array(select jsonb_array_elements_text(queued.action->'targetIds')),'{}') else event_row.original_target_ids end
from event_attribution queued
where event_row.id=queued.event_id;

-- Preserve the role definition/version and display names as they existed when
-- the phase snapshot became a Resolution Session. Later role edits cannot move
-- old activity into a different role.
alter function private.start_resolution_session(uuid,integer) rename to start_resolution_session_v11_4;
create or replace function private.start_resolution_session(target_game_id uuid,expected_game_version integer)
returns public.resolution_sessions language plpgsql security definer set search_path='' as $$
declare result public.resolution_sessions%rowtype;stored public.game_documents%rowtype;enriched jsonb;
begin
  result:=private.start_resolution_session_v11_4(target_game_id,expected_game_version);
  if result.status in ('FINALIZED','REJECTED') then return result; end if;
  select * into stored from public.game_documents document_row where document_row.game_id=target_game_id;
  select coalesce(jsonb_agg(
    action.value||jsonb_strip_nulls(jsonb_build_object(
      'roleVersion',coalesce(nullif(role.value->>'version','')::integer,1),
      'roleNameSnapshot',nullif(role.value->>'name',''),
      'abilityNameSnapshot',nullif(ability.value->>'name',''),
      'sourceFactionNameSnapshot',nullif(faction.value->>'name','')
    )) order by action.ordinality),'[]'::jsonb) into enriched
  from jsonb_array_elements(result.submitted_actions) with ordinality action(value,ordinality)
  left join lateral (
    select candidate.value from jsonb_array_elements(coalesce(stored.document#>'{data,roles}','[]'::jsonb)) candidate(value)
    where candidate.value->>'id'=action.value->>'roleId' limit 1
  ) role on true
  left join lateral (
    select candidate.value from jsonb_array_elements(coalesce(stored.document#>'{data,abilities}','[]'::jsonb)) candidate(value)
    where candidate.value->>'id'=coalesce(action.value->>'abilityId',action.value->>'baseAbilityId') limit 1
  ) ability on true
  left join lateral (
    select candidate.value from jsonb_array_elements(coalesce(stored.document#>'{data,factions}','[]'::jsonb)) candidate(value)
    where candidate.value->>'id'=action.value->>'sourceFactionId' limit 1
  ) faction on true;
  update public.resolution_sessions session_row set submitted_actions=enriched where session_row.id=result.id returning * into result;
  return result;
end$$;

create or replace function public.start_resolution_session(target_game_id uuid,expected_game_version integer)
returns public.resolution_sessions language sql security definer set search_path='' as $$
  select private.start_resolution_session(target_game_id,expected_game_version)
$$;

-- This is the sole v11.5 approval boundary. The older finalize/learning/grant
-- implementation remains in the transaction and is called only after the new
-- structured ruling has passed validation and its official events are rebuilt.
create or replace function private.approve_and_apply_resolution(
  target_session_id uuid,
  expected_lock_version integer,
  target_final_resolution jsonb,
  target_gm_explanation text,
  target_teach_ai boolean,
  target_teach_scope text,
  target_consumed_action_ids text[],
  target_idempotency_key uuid,
  target_override_warnings boolean,
  target_reject boolean
) returns public.resolution_sessions language plpgsql security definer set search_path='' as $$
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
    raise exception using errcode='40001',message='RESOLUTION_ALREADY_FINALIZED';
  end if;
  if session_row.lock_version<>expected_lock_version then raise exception using errcode='40001',message='RESOLUTION_VERSION_CONFLICT'; end if;
  if session_row.phase_id is not null then select * into phase_row from public.game_phases current_phase where current_phase.id=session_row.phase_id for update; end if;
  select * into stored from public.game_documents document_row where document_row.game_id=session_row.game_id for update;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  if stored.version<>session_row.source_game_version and not coalesce(target_override_warnings,false) then raise exception using errcode='40001',message='SOURCE_GAME_VERSION_CONFLICT'; end if;
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
  select coalesce(array_agg(value),'{}') into consumed_from_ruling from jsonb_array_elements(final_value->'action_results') item cross join lateral (select item->>'action_id' value) selected where item->>'use_disposition'='CONSUMED' and coalesce(item->>'player_ability_grant_id','')<>'';
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
      ||case when coalesce(outcome.value->>'role_id','')<>'' then jsonb_build_object('roleId',outcome.value->>'role_id') else '{}'::jsonb end
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
end$$;

create or replace function public.approve_and_apply_resolution(
  target_session_id uuid,expected_lock_version integer,target_final_resolution jsonb,target_gm_explanation text,
  target_teach_ai boolean,target_teach_scope text default 'GLOBAL',target_consumed_action_ids text[] default '{}',
  target_idempotency_key uuid default gen_random_uuid(),target_override_warnings boolean default false,target_reject boolean default false
) returns public.resolution_sessions language sql security definer set search_path='' as $$
  select private.approve_and_apply_resolution(target_session_id,expected_lock_version,target_final_resolution,target_gm_explanation,target_teach_ai,target_teach_scope,target_consumed_action_ids,target_idempotency_key,target_override_warnings,target_reject)
$$;

-- One filtered read model serves Player, Role, Ability, Faction, phase history,
-- the queue picker, and the Master GM. Stable action IDs establish attempts;
-- only FINALIZED session events establish official outcomes.
create or replace function public.get_resolution_usage_analytics(target_game_id uuid,target_filters jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' stable as $$
with permitted as (
  select document from public.game_documents where game_id=$1 and (select auth.uid()) is not null and public.can_edit_game($1)
), attempts as (
  select distinct on (action->>'id') action->>'id' action_id,coalesce(action->>'abilityId',action->>'baseAbilityId','') ability_id,coalesce(action->>'abilityNameSnapshot',action->>'name','') ability_name,coalesce(action->>'sourcePlayerId',action->>'actorId','') player_id,coalesce(action->>'roleId','') role_id,coalesce(nullif(action->>'roleVersion','')::integer,1) role_version,coalesce(action->>'roleNameSnapshot','') role_name_snapshot,upper(coalesce(action->>'abilitySource',case when action->>'sourceType'='PLAYER' then 'ROLE' else action->>'sourceType' end,'ROLE')) source_type,coalesce(action->>'sourceFactionId','') source_faction_id,session.cycle,session.phase,coalesce(action->>'submittedAt',session.created_at::text) submitted_at,session.id session_id,session.status
  from public.resolution_sessions session cross join lateral jsonb_array_elements(session.submitted_actions) action
  where session.game_id=$1 and session.status<>'REJECTED'
  order by action->>'id',case when session.status='FINALIZED' then 0 else 1 end,session.created_at desc
), events as (
  select event.* from public.resolution_session_events event join public.resolution_sessions session on session.id=event.session_id where event.game_id=$1 and session.status='FINALIZED'
), keys as (
  select distinct ability_id,player_id,role_id,role_version,source_type,source_faction_id,cycle,phase from attempts where ability_id<>''
  union
  select distinct coalesce(ability_id,''),coalesce(actor_player_id,''),coalesce(role_id,''),coalesce(role_version,1),coalesce(source_type,ability_source,''),coalesce(source_faction_id,''),session.cycle,session.phase from events event join public.resolution_sessions session on session.id=event.session_id where event.event_type in ('PASSIVE_TRIGGER','PASSIVE_PREVENTED') and coalesce(event.ability_id,'')<>''
), filtered_keys as (
  select * from keys where
    coalesce($2->>'player_id','') in ('',player_id) and coalesce($2->>'role_id','') in ('',role_id) and coalesce($2->>'ability_id','') in ('',ability_id)
    and upper(coalesce($2->>'source_type','')) in ('',source_type) and coalesce($2->>'faction_id','') in ('',source_faction_id)
    and coalesce($2->>'phase','') in ('',phase) and (coalesce($2->>'cycle','')='' or cycle=($2->>'cycle')::integer)
    and (coalesce(($2->>'passive')::boolean,false)=false or exists(select 1 from events event where event.ability_id=keys.ability_id and coalesce(event.actor_player_id,'')=keys.player_id and event.event_type in ('PASSIVE_TRIGGER','PASSIVE_PREVENTED')))
), statistics as (
  select key.*,
    (select count(distinct attempt.action_id) from attempts attempt where attempt.ability_id=key.ability_id and attempt.player_id=key.player_id and attempt.role_id=key.role_id and attempt.role_version=key.role_version and attempt.source_type=key.source_type and attempt.source_faction_id=key.source_faction_id and attempt.cycle=key.cycle and attempt.phase=key.phase) attempts,
    (select count(distinct event.action_id) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and event.event_type='SUCCESS') successful,
    (select count(distinct event.action_id) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and event.event_type='FAILURE') failed,
    (select count(distinct event.action_id) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and event.event_type='BLOCK') blocked,
    (select count(distinct event.action_id) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and event.event_type='CANCELLED') cancelled,
    (select count(distinct event.action_id) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and event.event_type='INELIGIBLE_EFFECT') ineligible,
    (select count(distinct event.action_id) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and event.event_type='REDIRECT') redirected,
    (select count(distinct event.action_id) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and event.event_type='REFLECT') reflected,
    (select coalesce(sum(coalesce(nullif(event.outcome->>'uses_consumed','')::integer,1)),0) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and event.event_type='ABILITY_CONSUMED') uses_consumed,
    (select coalesce(sum(coalesce(nullif(event.outcome->>'uses_refunded','')::integer,1)),0) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and event.event_type='USE_REFUNDED') uses_refunded,
    (select coalesce(sum(greatest(1,coalesce(nullif(event.outcome->>'trigger_count','')::integer,1))),0) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and event.event_type='PASSIVE_TRIGGER') passive_triggers,
    (select coalesce(sum(greatest(1,coalesce(nullif(event.outcome->>'trigger_count','')::integer,1))),0) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and event.event_type='PASSIVE_TRIGGER' and upper(coalesce(event.outcome->>'result','SUCCESS')) not in ('FAILURE','PREVENTED','BLOCKED')) passive_successful,
    (select coalesce(sum(greatest(1,coalesce(nullif(event.outcome->>'trigger_count','')::integer,1))),0) from events event join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase and (event.event_type='PASSIVE_PREVENTED' or event.event_type='PASSIVE_TRIGGER' and upper(coalesce(event.outcome->>'result','')) in ('FAILURE','PREVENTED','BLOCKED'))) passive_failed,
    (select count(distinct affected) from events event cross join lateral unnest(event.final_target_ids) affected join public.resolution_sessions session on session.id=event.session_id where event.ability_id=key.ability_id and coalesce(event.actor_player_id,'')=key.player_id and coalesce(event.role_id,'')=key.role_id and coalesce(event.role_version,1)=key.role_version and coalesce(event.source_type,event.ability_source,'')=key.source_type and coalesce(event.source_faction_id,'')=key.source_faction_id and session.cycle=key.cycle and session.phase=key.phase) affected_players,
    (select count(distinct attempt.action_id) from attempts attempt where attempt.ability_id=key.ability_id and attempt.player_id=key.player_id and attempt.source_type='FACTION' and attempt.source_faction_id=key.source_faction_id and attempt.cycle=key.cycle and attempt.phase=key.phase) faction_action_attempts,
    (select max(attempt.submitted_at) from attempts attempt where attempt.ability_id=key.ability_id and attempt.player_id=key.player_id and attempt.role_id=key.role_id and attempt.role_version=key.role_version and attempt.source_type=key.source_type and attempt.source_faction_id=key.source_faction_id and attempt.cycle=key.cycle and attempt.phase=key.phase) last_attempt_at
  from filtered_keys key
), rows as (
  select jsonb_build_object('ability_id',statistic.ability_id,'ability_name',coalesce((select attempt.ability_name from attempts attempt where attempt.ability_id=statistic.ability_id order by attempt.submitted_at desc limit 1),(select ability->>'name' from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,abilities}','[]'::jsonb)) ability where ability->>'id'=statistic.ability_id limit 1),statistic.ability_id),'player_id',nullif(statistic.player_id,''),'player_name',(select player->>'name' from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=statistic.player_id limit 1),'role_id',nullif(statistic.role_id,''),'role_name',coalesce((select attempt.role_name_snapshot from attempts attempt where attempt.role_id=statistic.role_id and attempt.role_version=statistic.role_version and attempt.role_name_snapshot<>'' limit 1),(select role->>'name' from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,roles}','[]'::jsonb)) role where role->>'id'=statistic.role_id limit 1)),'role_version',statistic.role_version,'source_type',statistic.source_type,'ability_source',statistic.source_type,'source_faction_id',nullif(statistic.source_faction_id,''),'cycle',statistic.cycle,'phase',statistic.phase,'attempts',statistic.attempts,'successful',statistic.successful,'failed',statistic.failed,'blocked',statistic.blocked,'cancelled',statistic.cancelled,'ineligible',statistic.ineligible,'redirected',statistic.redirected,'reflected',statistic.reflected,'uses_consumed',statistic.uses_consumed,'uses_refunded',statistic.uses_refunded,'passive_triggers',statistic.passive_triggers,'passive_successful',statistic.passive_successful,'passive_failed',statistic.passive_failed,'affected_players',statistic.affected_players,'faction_action_attempts',statistic.faction_action_attempts,'last_attempt_at',statistic.last_attempt_at) row
  from statistics statistic
  where coalesce($2->>'outcome','')='' or case upper($2->>'outcome') when 'SUCCESS' then statistic.successful when 'FAILURE' then statistic.failed when 'BLOCKED' then statistic.blocked when 'CANCELLED' then statistic.cancelled else statistic.attempts end>0
), history as (
  select jsonb_build_object('action_id',attempt.action_id,'session_id',attempt.session_id,'player_id',nullif(attempt.player_id,''),'player_name',(select player->>'name' from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=attempt.player_id limit 1),'role_id',nullif(attempt.role_id,''),'role_name',coalesce(nullif(attempt.role_name_snapshot,''),(select role->>'name' from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,roles}','[]'::jsonb)) role where role->>'id'=attempt.role_id limit 1)),'role_version',attempt.role_version,'ability_id',attempt.ability_id,'ability_name',attempt.ability_name,'source_type',attempt.source_type,'source_faction_id',nullif(attempt.source_faction_id,''),'cycle',attempt.cycle,'phase',attempt.phase,'submitted_at',attempt.submitted_at,'session_status',attempt.status,'events',coalesce((select jsonb_agg(event.outcome order by event.event_order) from events event where event.action_id=attempt.action_id),'[]'::jsonb)) item from attempts attempt
  where coalesce($2->>'player_id','') in ('',attempt.player_id) and coalesce($2->>'role_id','') in ('',attempt.role_id) and coalesce($2->>'ability_id','') in ('',attempt.ability_id) and upper(coalesce($2->>'source_type','')) in ('',attempt.source_type) and coalesce($2->>'faction_id','') in ('',attempt.source_faction_id) and coalesce($2->>'phase','') in ('',attempt.phase) and (coalesce($2->>'cycle','')='' or attempt.cycle=($2->>'cycle')::integer)
  union all
  select jsonb_build_object('action_id','passive:'||event.id::text,'session_id',event.session_id,'player_id',event.actor_player_id,'player_name',(select player->>'name' from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=event.actor_player_id limit 1),'role_id',event.role_id,'role_name',(select role->>'name' from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,roles}','[]'::jsonb)) role where role->>'id'=event.role_id limit 1),'role_version',coalesce(event.role_version,1),'ability_id',event.ability_id,'ability_name',(select ability->>'name' from permitted document_row cross join lateral jsonb_array_elements(coalesce(document_row.document#>'{data,abilities}','[]'::jsonb)) ability where ability->>'id'=event.ability_id limit 1),'source_type',coalesce(event.source_type,event.ability_source,'ROLE'),'source_faction_id',event.source_faction_id,'cycle',session.cycle,'phase',session.phase,'submitted_at',event.created_at,'session_status','FINALIZED','events',jsonb_build_array(event.outcome)) item
  from events event join public.resolution_sessions session on session.id=event.session_id
  where event.event_type in ('PASSIVE_TRIGGER','PASSIVE_PREVENTED') and not exists(select 1 from attempts attempt where attempt.action_id=event.action_id)
    and coalesce($2->>'player_id','') in ('',coalesce(event.actor_player_id,'')) and coalesce($2->>'role_id','') in ('',coalesce(event.role_id,'')) and coalesce($2->>'ability_id','') in ('',coalesce(event.ability_id,'')) and upper(coalesce($2->>'source_type','')) in ('',coalesce(event.source_type,event.ability_source,'ROLE')) and coalesce($2->>'faction_id','') in ('',coalesce(event.source_faction_id,'')) and coalesce($2->>'phase','') in ('',session.phase) and (coalesce($2->>'cycle','')='' or session.cycle=($2->>'cycle')::integer)
)
select case when exists(select 1 from permitted) then jsonb_build_object('rows',coalesce((select jsonb_agg(row order by row->>'player_name',row->>'role_name',row->>'ability_name',row->>'cycle',row->>'phase') from rows),'[]'::jsonb),'history',coalesce((select jsonb_agg(item order by item->>'submitted_at' desc) from history),'[]'::jsonb),'generated_at',now(),'filters',coalesce($2,'{}'::jsonb)) else jsonb_build_object('rows','[]'::jsonb,'history','[]'::jsonb) end
$$;

-- Keep the established compatibility RPC while switching its official rows to
-- the shared analytics model.
create or replace function public.get_ability_usage_statistics(target_game_id uuid)
returns jsonb language sql security invoker set search_path='' stable as $$
  select coalesce(public.get_resolution_usage_analytics(target_game_id,'{}'::jsonb)->'rows','[]'::jsonb)
$$;

revoke all on function private.start_resolution_session(uuid,integer),private.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean),public.get_resolution_usage_analytics(uuid,jsonb) from public,anon;
grant execute on function public.start_resolution_session(uuid,integer),public.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean),public.get_resolution_usage_analytics(uuid,jsonb),public.get_ability_usage_statistics(uuid) to authenticated;
