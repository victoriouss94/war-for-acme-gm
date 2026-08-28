-- v11.8: global role configurations/forms/states with authoritative runtime
-- state, audited transitions, temporary access, and queue-time enforcement.

create table if not exists public.player_mode_states (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id text not null,
  role_id text not null,
  current_mode_id text not null,
  starting_mode_id text not null,
  previous_mode_id text,
  mode_changed_at timestamptz not null default now(),
  mode_change_reason text not null default '',
  mode_change_source text not null default 'MIGRATION',
  mode_locked boolean not null default false,
  locked_mode_id text,
  temporary_mode_access jsonb not null default '[]'::jsonb check (jsonb_typeof(temporary_mode_access)='array'),
  mode_cooldowns jsonb not null default '{}'::jsonb check (jsonb_typeof(mode_cooldowns)='object'),
  version integer not null default 1 check (version>0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key(game_id,player_id),
  check (not mode_locked or locked_mode_id is not null)
);

create table if not exists public.player_mode_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id text not null,
  role_id text not null,
  previous_mode_id text,
  new_mode_id text,
  event_type text not null check (event_type in ('INITIALIZED','MODE_CHANGED','MODE_LOCKED','MODE_UNLOCKED','TEMPORARY_ACCESS_GRANTED','TEMPORARY_ACCESS_REVOKED','COOLDOWN_CHANGED')),
  reason text not null,
  source_type text not null,
  cycle integer,
  phase text,
  temporary boolean not null default false,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists player_mode_states_game_idx on public.player_mode_states(game_id);
create index if not exists player_mode_events_game_player_created_idx on public.player_mode_events(game_id,player_id,created_at desc);

alter table public.player_mode_states enable row level security;
alter table public.player_mode_events enable row level security;
drop policy if exists player_mode_states_gm_read on public.player_mode_states;
create policy player_mode_states_gm_read on public.player_mode_states for select to authenticated using ((select public.can_edit_game(game_id)));
drop policy if exists player_mode_events_gm_read on public.player_mode_events;
create policy player_mode_events_gm_read on public.player_mode_events for select to authenticated using ((select public.can_edit_game(game_id)));
revoke all on table public.player_mode_states,public.player_mode_events from public,anon,authenticated;
grant select on table public.player_mode_states,public.player_mode_events to authenticated;

insert into public.player_mode_states(game_id,player_id,role_id,current_mode_id,starting_mode_id,previous_mode_id,mode_changed_at,mode_change_reason,mode_change_source,mode_locked,locked_mode_id,temporary_mode_access,mode_cooldowns,updated_by)
select stored.game_id,player.value->>'id',role.value->>'id',coalesce(nullif(player.value->>'currentModeId',''),nullif(role.value->>'startingModeId',''),role.value#>>'{modes,0,id}'),coalesce(nullif(player.value->>'startingModeId',''),nullif(role.value->>'startingModeId',''),role.value#>>'{modes,0,id}'),nullif(player.value->>'previousModeId',''),coalesce(nullif(player.value->>'modeChangedAt','')::timestamptz,stored.updated_at),coalesce(player.value->>'modeChangeReason','Imported existing live configuration.'),coalesce(player.value->>'modeChangeSource','MIGRATION'),coalesce((player.value->>'modeLocked')::boolean,false),nullif(player.value->>'lockedModeId',''),coalesce(player.value->'temporaryModeAccess','[]'::jsonb),coalesce(player.value->'modeCooldowns','{}'::jsonb),stored.updated_by
from public.game_documents stored
cross join lateral jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) player(value)
cross join lateral jsonb_array_elements(coalesce(stored.document#>'{data,roles}','[]'::jsonb)) role(value)
where role.value->>'id'=player.value->>'roleId'
  and jsonb_array_length(coalesce(role.value->'modes','[]'::jsonb))>0
  and coalesce(nullif(player.value->>'currentModeId',''),nullif(role.value->>'startingModeId',''),role.value#>>'{modes,0,id}') is not null
on conflict(game_id,player_id) do nothing;

insert into public.player_mode_events(game_id,player_id,role_id,new_mode_id,event_type,reason,source_type,cycle,phase,payload,actor_user_id)
select state.game_id,state.player_id,state.role_id,state.current_mode_id,'INITIALIZED','Initialized from the existing game document.','MIGRATION',nullif(document.document#>>'{game,currentDay}','')::integer,document.document#>>'{game,currentPhase}',jsonb_build_object('startingModeId',state.starting_mode_id),state.updated_by
from public.player_mode_states state join public.game_documents document on document.game_id=state.game_id
where not exists(select 1 from public.player_mode_events event where event.game_id=state.game_id and event.player_id=state.player_id);

create or replace function private.change_player_mode_state(target_game_id uuid,target_player_id text,target_mode_id text,target_reason text,target_source_type text default 'GM_TRIGGERED',target_temporary boolean default false)
returns public.player_mode_states language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=(select auth.uid());stored public.game_documents%rowtype;player_record jsonb;role_record jsonb;mode_record jsonb;current_state public.player_mode_states%rowtype;result public.player_mode_states%rowtype;previous_mode_id text;starting_mode_id text;current_cycle integer;current_phase text;cooldown_record jsonb;next_cooldowns jsonb;lock_transition boolean:=false;same_role boolean:=false;switch_cooldown_cycles integer;
begin
  if actor_id is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if length(btrim(coalesce(target_reason,'')))<3 then raise exception using errcode='22023',message='MODE_CHANGE_REASON_REQUIRED'; end if;
  select * into stored from public.game_documents document_row where document_row.game_id=target_game_id for update;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  select value into player_record from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) player(value) where player.value->>'id'=target_player_id limit 1;
  if player_record is null then raise exception using errcode='23503',message='PLAYER_NOT_FOUND'; end if;
  select value into role_record from jsonb_array_elements(coalesce(stored.document#>'{data,roles}','[]'::jsonb)) role(value) where role.value->>'id'=player_record->>'roleId' limit 1;
  select value into mode_record from jsonb_array_elements(coalesce(role_record->'modes','[]'::jsonb)) mode(value) where mode.value->>'id'=target_mode_id limit 1;
  if mode_record is null then raise exception using errcode='23503',message='MODE_NOT_FOUND'; end if;
  current_cycle:=coalesce(nullif(stored.document#>>'{game,currentDay}','')::integer,0);current_phase:=coalesce(stored.document#>>'{game,currentPhase}','');
  select * into current_state from public.player_mode_states state_row where state_row.game_id=target_game_id and state_row.player_id=target_player_id for update;
  same_role:=current_state.game_id is not null and current_state.role_id=role_record->>'id';
  starting_mode_id:=coalesce(case when same_role then nullif(current_state.starting_mode_id,'') end,nullif(player_record->>'startingModeId',''),nullif(role_record->>'startingModeId',''),role_record#>>'{modes,0,id}',target_mode_id);
  previous_mode_id:=coalesce(case when same_role then nullif(current_state.current_mode_id,'') end,nullif(player_record->>'currentModeId',''),starting_mode_id);
  if same_role and current_state.mode_locked and current_state.locked_mode_id<>target_mode_id then raise exception using errcode='55000',message='MODE_LOCKED'; end if;
  cooldown_record:=case when same_role then coalesce(current_state.mode_cooldowns->target_mode_id,'{}'::jsonb) else '{}'::jsonb end;
  if nullif(cooldown_record->>'until','')::timestamptz>now() or coalesce(nullif(cooldown_record->>'untilCycle','')::integer,-1)>current_cycle then raise exception using errcode='55000',message='MODE_SWITCH_COOLDOWN'; end if;
  lock_transition:=not target_temporary and (coalesce((mode_record#>>'{switchRules,oneWay}')::boolean,false) or coalesce((mode_record#>>'{switchRules,permanent}')::boolean,false));
  switch_cooldown_cycles:=coalesce(nullif(mode_record#>>'{switchRules,cooldownCycles}','')::integer,0);next_cooldowns:=case when same_role then coalesce(current_state.mode_cooldowns,'{}'::jsonb) else '{}'::jsonb end;
  if switch_cooldown_cycles>0 then next_cooldowns:=jsonb_set(next_cooldowns,array[target_mode_id],jsonb_build_object('untilCycle',current_cycle+switch_cooldown_cycles,'reason','Configuration switch cooldown'),true); end if;
  insert into public.player_mode_states(game_id,player_id,role_id,current_mode_id,starting_mode_id,previous_mode_id,mode_changed_at,mode_change_reason,mode_change_source,mode_locked,locked_mode_id,temporary_mode_access,mode_cooldowns,version,updated_at,updated_by)
  values(target_game_id,target_player_id,role_record->>'id',target_mode_id,starting_mode_id,previous_mode_id,now(),btrim(target_reason),upper(btrim(coalesce(target_source_type,'GM_TRIGGERED'))),lock_transition,case when lock_transition then target_mode_id else null end,case when same_role then coalesce(current_state.temporary_mode_access,'[]'::jsonb) else '[]'::jsonb end,next_cooldowns,coalesce(current_state.version,0)+1,now(),actor_id)
  on conflict(game_id,player_id) do update set role_id=excluded.role_id,current_mode_id=excluded.current_mode_id,starting_mode_id=excluded.starting_mode_id,previous_mode_id=excluded.previous_mode_id,mode_changed_at=excluded.mode_changed_at,mode_change_reason=excluded.mode_change_reason,mode_change_source=excluded.mode_change_source,mode_locked=case when player_mode_states.role_id<>excluded.role_id then excluded.mode_locked else player_mode_states.mode_locked or excluded.mode_locked end,locked_mode_id=case when player_mode_states.role_id<>excluded.role_id then excluded.locked_mode_id else coalesce(player_mode_states.locked_mode_id,excluded.locked_mode_id) end,temporary_mode_access=excluded.temporary_mode_access,mode_cooldowns=excluded.mode_cooldowns,version=player_mode_states.version+1,updated_at=now(),updated_by=actor_id returning * into result;
  insert into public.player_mode_events(game_id,player_id,role_id,previous_mode_id,new_mode_id,event_type,reason,source_type,cycle,phase,temporary,payload,actor_user_id) values(target_game_id,target_player_id,result.role_id,previous_mode_id,target_mode_id,case when result.mode_locked and not current_state.mode_locked then 'MODE_LOCKED' else 'MODE_CHANGED' end,btrim(target_reason),result.mode_change_source,current_cycle,current_phase,target_temporary,jsonb_build_object('previousModeName',(select value->>'name' from jsonb_array_elements(coalesce(role_record->'modes','[]'::jsonb)) where value->>'id'=previous_mode_id limit 1),'newModeName',mode_record->>'name','modeLocked',result.mode_locked),actor_id);
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(target_game_id,actor_id,'player_mode',target_player_id,'Player configuration changed: '||coalesce((select value->>'name' from jsonb_array_elements(coalesce(role_record->'modes','[]'::jsonb)) where value->>'id'=previous_mode_id limit 1),'Unknown')||' → '||coalesce(mode_record->>'name','Unknown'),case when current_state.game_id is null then null else to_jsonb(current_state) end,to_jsonb(result));
  return result;
end$$;

create or replace function public.change_player_mode(target_game_id uuid,target_player_id text,target_mode_id text,target_reason text,target_source_type text default 'GM_TRIGGERED')
returns public.player_mode_states language sql security definer set search_path='' as $$select private.change_player_mode_state(target_game_id,target_player_id,target_mode_id,target_reason,target_source_type,false)$$;

create or replace function public.mutate_temporary_mode_access(target_game_id uuid,target_player_id text,target_mode_id text,target_operation text,target_reason text,target_expires_at timestamptz default null,target_expires_cycle integer default null,target_expires_phase text default '')
returns public.player_mode_states language plpgsql security definer set search_path='' as $$
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
  if not found then current_state:=private.change_player_mode_state(target_game_id,target_player_id,coalesce(nullif(player_record->>'currentModeId',''),nullif(role_record->>'startingModeId',''),role_record#>>'{modes,0,id}'),'Initialized before temporary configuration access.','SYSTEM',false); end if;
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into next_access from jsonb_array_elements(coalesce(current_state.temporary_mode_access,'[]'::jsonb)) with ordinality access(value,ordinality) where value->>'modeId'<>target_mode_id;
  if operation='GRANT' then next_access:=next_access||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('modeId',target_mode_id,'modeName',mode_record->>'name','grantedAt',now(),'expiresAt',target_expires_at,'expiresCycle',target_expires_cycle,'expiresPhase',nullif(btrim(target_expires_phase),''),'reason',btrim(target_reason)))); end if;
  update public.player_mode_states state_row set temporary_mode_access=next_access,version=state_row.version+1,updated_at=now(),updated_by=actor_id where state_row.game_id=target_game_id and state_row.player_id=target_player_id returning * into result;
  current_cycle:=coalesce(nullif(stored.document#>>'{game,currentDay}','')::integer,0);current_phase:=coalesce(stored.document#>>'{game,currentPhase}','');
  insert into public.player_mode_events(game_id,player_id,role_id,previous_mode_id,new_mode_id,event_type,reason,source_type,cycle,phase,temporary,payload,actor_user_id) values(target_game_id,target_player_id,result.role_id,result.current_mode_id,target_mode_id,case when operation='GRANT' then 'TEMPORARY_ACCESS_GRANTED' else 'TEMPORARY_ACCESS_REVOKED' end,btrim(target_reason),'GM_TRIGGERED',current_cycle,current_phase,true,jsonb_build_object('modeName',mode_record->>'name','expiresAt',target_expires_at,'expiresCycle',target_expires_cycle,'expiresPhase',nullif(btrim(target_expires_phase),'')),actor_id);
  return result;
end$$;

create or replace function private.validate_player_action_mode_context(target_game_id uuid,target_action jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
  select exists(select 1 from jsonb_array_elements(case when mode_state.role_id=role_record->>'id' then coalesce(mode_state.temporary_mode_access,'[]'::jsonb) else '[]'::jsonb end) access(value) where value->>'modeId'=action_mode_id and (nullif(value->>'expiresAt','') is null or (value->>'expiresAt')::timestamptz>now()) and (nullif(value->>'expiresCycle','') is null or (value->>'expiresCycle')::integer>=current_cycle) and not (nullif(value->>'expiresCycle','')::integer=current_cycle and nullif(value->>'expiresPhase','')=current_phase and coalesce((value->>'expireOnPhaseStart')::boolean,true))) into state_access;
  mode_access:=current_mode_id=action_mode_id or state_access;
  if not mode_access then
    select exists(select 1 from public.player_status_effects effect cross join lateral jsonb_array_elements_text(coalesce(effect.metadata->'modeIds',effect.metadata->'mode_ids',effect.metadata->'modeAccessIds',effect.metadata->'mode_access_ids','[]'::jsonb)) allowed(value) where effect.game_id=target_game_id and effect.player_id=action_player_id and effect.state='ACTIVE' and allowed.value=action_mode_id union all select 1 from public.player_ability_grants grant_source cross join lateral jsonb_array_elements_text(coalesce(grant_source.special_conditions->'modeIds',grant_source.special_conditions->'mode_ids',grant_source.metadata->'modeIds',grant_source.metadata->'mode_ids','[]'::jsonb)) allowed(value) where grant_source.game_id=target_game_id and grant_source.player_id=action_player_id and grant_source.status='ACTIVE' and allowed.value=action_mode_id) into mode_access;
  end if;
  if not mode_access and upper(coalesce(role_record->>'modeSelectionPolicy','CURRENT_ONLY'))<>'CHOOSE_BEFORE_ACTION' and override_reason='' then raise exception using errcode='42501',message='INACTIVE_MODE'; end if;
  if mode_state.role_id=role_record->>'id' and mode_state.mode_locked and mode_state.locked_mode_id<>action_mode_id and override_reason='' then raise exception using errcode='55000',message='MODE_LOCKED'; end if;
  return jsonb_build_object('modeId',action_mode_id,'modeName',mode_record->>'name','currentModeId',nullif(current_mode_id,''),'temporaryAccess',state_access,'requiresSwitch',not mode_access,'modeLocked',coalesce(mode_state.mode_locked,false));
end$$;

create or replace function private.queue_player_action(target_game_id uuid,expected_game_version integer,target_action jsonb,target_replace_action_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row public.game_phases%rowtype;updated_row public.game_phases%rowtype;result jsonb;phase_actions jsonb;requested_phase_id uuid;requested_phase_version integer;mode_context jsonb;patched_document jsonb;patched_actions jsonb;saved record;switched_state public.player_mode_states%rowtype;
begin
  if (select auth.uid()) is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  begin requested_phase_id:=(target_action->>'phaseId')::uuid;requested_phase_version:=(target_action->>'phaseVersion')::integer;exception when others then raise exception using errcode='22023',message='PHASE_CONTEXT_REQUIRED'; end;
  select * into current_row from public.game_phases phase_row where phase_row.game_id=target_game_id and phase_row.status='CURRENT' for update;if not found or current_row.id<>requested_phase_id then raise exception using errcode='40001',message='PHASE_CHANGED'; end if;if current_row.queue_version<>requested_phase_version then raise exception using errcode='40001',message='PHASE_VERSION_CONFLICT'; end if;if (select game.status from public.games game where game.id=target_game_id)<>'ACTIVE' then raise exception using errcode='55000',message='GAME_NOT_ACTIVE'; end if;
  mode_context:=private.validate_player_action_mode_context(target_game_id,target_action);
  if coalesce((mode_context->>'requiresSwitch')::boolean,false) then switched_state:=private.change_player_mode_state(target_game_id,coalesce(target_action->>'sourcePlayerId',target_action->>'actorId'),mode_context->>'modeId','Switched to '||coalesce(mode_context->>'modeName','configuration')||' before queued action.','PLAYER_SELECTED',false);mode_context:=mode_context||jsonb_build_object('currentModeId',switched_state.current_mode_id,'requiresSwitch',false,'switchedBeforeAction',true);end if;
  result:=private.queue_player_action_document_v11_2(target_game_id,expected_game_version,target_action,target_replace_action_id);
  if mode_context<>'{}'::jsonb then result:=jsonb_set(result,'{action}',(result->'action')||jsonb_build_object('modeId',mode_context->>'modeId','modeName',mode_context->>'modeName','modeContext',mode_context),false);select coalesce(jsonb_agg(case when item->>'id'=result#>>'{action,id}' then item||jsonb_build_object('modeId',mode_context->>'modeId','modeName',mode_context->>'modeName','modeContext',mode_context) else item end order by ordinality),'[]'::jsonb) into patched_actions from jsonb_array_elements(coalesce(result#>'{document,data,actions}','[]'::jsonb)) with ordinality queued(item,ordinality);patched_document:=jsonb_set(result->'document','{data,actions}',patched_actions,false);select * into saved from public.save_game_document(target_game_id,(result->>'version')::integer,patched_document,'Configuration context attached to queued ability','action',result#>>'{action,id}') limit 1;result:=result||jsonb_build_object('document',saved.document,'version',saved.version,'updated_at',saved.updated_at,'updated_by',saved.updated_by);end if;
  select coalesce(jsonb_agg(item||jsonb_build_object('phaseId',current_row.id,'phaseVersion',current_row.queue_version+1) order by ordinality),'[]'::jsonb) into phase_actions from jsonb_array_elements(coalesce(result#>'{document,data,actions}','[]'::jsonb)) with ordinality queued(item,ordinality);update public.game_phases phase_row set action_queue=phase_actions,queue_version=phase_row.queue_version+1,updated_at=now() where phase_row.id=current_row.id returning * into updated_row;insert into public.game_phase_events(game_id,phase_id,event_type,action_id,summary,payload,actor_user_id) values(target_game_id,current_row.id,case when target_replace_action_id is null then 'ACTION_QUEUED' else 'ACTION_EDITED' end,result#>>'{action,id}',coalesce(result#>>'{action,name}','Structured action')||case when target_replace_action_id is null then ' queued.' else ' edited.' end,jsonb_build_object('phaseVersion',updated_row.queue_version,'action',result->'action'),auth.uid());return result||jsonb_build_object('phase',to_jsonb(updated_row),'document',jsonb_set(result->'document','{data,actions}',phase_actions,false));
end$$;

-- Extend the existing human-approved resolution transaction. A MODE_CHANGE is
-- an editable other_effect with player_id, target_id=configuration ID, and a
-- summary reason. Idempotency tags prevent a retried approval applying twice.
create or replace function public.approve_and_apply_resolution(
  target_session_id uuid,expected_lock_version integer,target_final_resolution jsonb,target_gm_explanation text,
  target_teach_ai boolean,target_teach_scope text default 'GLOBAL',target_consumed_action_ids text[] default '{}',
  target_idempotency_key uuid default gen_random_uuid(),target_override_warnings boolean default false,target_reject boolean default false
) returns public.resolution_sessions language plpgsql security definer set search_path='' as $$
declare result public.resolution_sessions%rowtype;effect_record record;mode_result public.player_mode_states%rowtype;event_id uuid;reason text;
begin
  result:=private.approve_and_apply_resolution(target_session_id,expected_lock_version,target_final_resolution,target_gm_explanation,target_teach_ai,target_teach_scope,target_consumed_action_ids,target_idempotency_key,target_override_warnings,target_reject);
  if coalesce(target_reject,false) then return result; end if;
  for effect_record in select value,ordinality from jsonb_array_elements(coalesce(target_final_resolution->'other_effects','[]'::jsonb)) with ordinality effect(value,ordinality) where upper(coalesce(value->>'type',''))='MODE_CHANGE' loop
    if exists(select 1 from public.player_mode_events existing where existing.payload->>'resolutionSessionId'=target_session_id::text and existing.payload->>'resolutionEffectIndex'=effect_record.ordinality::text) then continue; end if;
    reason:=coalesce(nullif(btrim(effect_record.value->>'summary'),''),'Approved resolution changed configuration.');
    mode_result:=private.change_player_mode_state(result.game_id,effect_record.value->>'player_id',effect_record.value->>'target_id',reason,'RESOLUTION',false);
    select event.id into event_id from public.player_mode_events event where event.game_id=result.game_id and event.player_id=mode_result.player_id and event.new_mode_id=mode_result.current_mode_id and event.created_at=mode_result.mode_changed_at order by event.created_at desc limit 1;
    update public.player_mode_events set payload=payload||jsonb_build_object('resolutionSessionId',target_session_id,'resolutionEffectIndex',effect_record.ordinality) where id=event_id;
  end loop;
  return result;
end$$;

revoke all on function private.change_player_mode_state(uuid,text,text,text,text,boolean),private.validate_player_action_mode_context(uuid,jsonb),private.queue_player_action(uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.change_player_mode(uuid,text,text,text,text),public.mutate_temporary_mode_access(uuid,text,text,text,text,timestamptz,integer,text) from public,anon;
grant execute on function public.change_player_mode(uuid,text,text,text,text),public.mutate_temporary_mode_access(uuid,text,text,text,text,timestamptz,integer,text) to authenticated;

do $$ begin alter publication supabase_realtime add table public.player_mode_states; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.player_mode_events; exception when duplicate_object then null; end $$;

comment on table public.player_mode_states is 'Authoritative current configuration/form/state for each multi-configuration player.';
comment on table public.player_mode_events is 'Readable, immutable audit history for configuration changes and temporary access.';
