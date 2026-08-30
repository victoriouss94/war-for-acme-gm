-- Deterministic night engine persistence. This is additive: the historical AI
-- proposal, final ruling, approval transaction, events, and precedents remain.

alter table public.resolution_sessions
  add column if not exists engine_proposal jsonb not null default '{}'::jsonb,
  add column if not exists engine_trace jsonb not null default '[]'::jsonb,
  add column if not exists random_outcomes jsonb not null default '{}'::jsonb,
  add column if not exists ai_adjudications jsonb not null default '[]'::jsonb,
  add column if not exists engine_status text,
  add column if not exists engine_version text,
  add column if not exists simulation_version integer not null default 0,
  add column if not exists simulated_at timestamptz,
  add column if not exists simulated_by uuid references auth.users(id) on delete set null;

alter table public.resolution_sessions drop constraint if exists resolution_sessions_pre_resolution_state_check;
alter table public.resolution_sessions add constraint resolution_sessions_pre_resolution_state_check
  check (jsonb_typeof(pre_resolution_state)='object' and octet_length(pre_resolution_state::text)<=1500000);

alter table public.resolution_sessions drop constraint if exists resolution_sessions_engine_proposal_check;
alter table public.resolution_sessions add constraint resolution_sessions_engine_proposal_check
  check (jsonb_typeof(engine_proposal)='object' and octet_length(engine_proposal::text)<=900000);
alter table public.resolution_sessions drop constraint if exists resolution_sessions_engine_trace_check;
alter table public.resolution_sessions add constraint resolution_sessions_engine_trace_check
  check (jsonb_typeof(engine_trace)='array' and octet_length(engine_trace::text)<=500000);
alter table public.resolution_sessions drop constraint if exists resolution_sessions_random_outcomes_check;
alter table public.resolution_sessions add constraint resolution_sessions_random_outcomes_check
  check (jsonb_typeof(random_outcomes)='object' and octet_length(random_outcomes::text)<=200000);
alter table public.resolution_sessions drop constraint if exists resolution_sessions_ai_adjudications_check;
alter table public.resolution_sessions add constraint resolution_sessions_ai_adjudications_check
  check (jsonb_typeof(ai_adjudications)='array' and octet_length(ai_adjudications::text)<=300000);
alter table public.resolution_sessions drop constraint if exists resolution_sessions_engine_status_check;
alter table public.resolution_sessions add constraint resolution_sessions_engine_status_check
  check (engine_status is null or engine_status in ('RESOLVED','RESOLVED_WITH_AI_ASSISTANCE','GM_REVIEW_REQUIRED','RESOLUTION_ERROR'));

create index if not exists resolution_sessions_engine_status_idx
  on public.resolution_sessions(game_id,engine_status,simulated_at desc)
  where engine_status is not null;

-- Extend newly opened sessions with a complete immutable engine snapshot.
-- The previous session-opening function remains the source of phase/queue locks.
alter function private.start_resolution_session(uuid,integer) rename to start_resolution_session_v11_9;

create or replace function private.start_resolution_session(target_game_id uuid,expected_game_version integer)
returns public.resolution_sessions
language plpgsql security definer set search_path=''
as $$
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
    'modes',coalesce((select jsonb_agg(to_jsonb(mode_state) order by mode_state.player_id) from public.player_mode_states mode_state where mode_state.game_id=target_game_id),'[]'::jsonb),
    'temporary_mode_access',coalesce((select jsonb_agg(access.value||jsonb_build_object('player_id',mode_state.player_id)) from public.player_mode_states mode_state cross join lateral jsonb_array_elements(mode_state.temporary_mode_access) access(value) where mode_state.game_id=target_game_id and (nullif(access.value->>'expiresAt','') is null or (access.value->>'expiresAt')::timestamptz>now()) and (nullif(access.value->>'expiresCycle','') is null or (access.value->>'expiresCycle')::integer>=result.cycle) and not coalesce((nullif(access.value->>'expiresCycle','')::integer=result.cycle and nullif(access.value->>'expiresPhase','')=result.phase and coalesce((access.value->>'expireOnPhaseStart')::boolean,true)),false)),'[]'::jsonb),
    'precedents',coalesce((select jsonb_agg(jsonb_build_object('id',precedent.id,'title',precedent.title,'summary',precedent.summary,'scope',precedent.scope,'interaction_signature',precedent.interaction_signature,'final_outcome',precedent.final_outcome) order by precedent.updated_at desc) from public.gm_precedents precedent where precedent.game_id=target_game_id and precedent.status='ACTIVE'),'[]'::jsonb)
  );
  update public.resolution_sessions session
  set pre_resolution_state=complete_snapshot
  where session.id=result.id and session.status not in ('FINALIZED','REJECTED')
  returning * into result;
  return result;
end $$;

create or replace function private.save_deterministic_resolution(
  target_session_id uuid,
  expected_lock_version integer,
  target_engine_proposal jsonb
) returns public.resolution_sessions
language plpgsql security definer set search_path=''
as $$
declare
  actor uuid:=(select auth.uid());
  session_row public.resolution_sessions%rowtype;
  proposal jsonb:=coalesce(target_engine_proposal,'{}'::jsonb);
  proposal_status text:=upper(coalesce(proposal->>'resolution_status',''));
begin
  select * into session_row from public.resolution_sessions session where session.id=target_session_id for update;
  if not found then raise exception using errcode='P0002',message='RESOLUTION_SESSION_NOT_FOUND'; end if;
  if actor is null or not public.can_edit_game(session_row.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if session_row.status in ('FINALIZED','REJECTED') then raise exception using errcode='55000',message='RESOLUTION_ALREADY_FINALIZED'; end if;
  if session_row.lock_version is distinct from expected_lock_version then raise exception using errcode='40001',message='RESOLUTION_VERSION_CONFLICT'; end if;
  if jsonb_typeof(proposal)<>'object' or octet_length(proposal::text)>900000
    or coalesce(nullif(proposal->>'schema_version','')::integer,0)<>2
    or proposal_status not in ('RESOLVED','RESOLVED_WITH_AI_ASSISTANCE','GM_REVIEW_REQUIRED','RESOLUTION_ERROR')
    or jsonb_typeof(proposal->'action_results') is distinct from 'array'
    or jsonb_typeof(proposal->'engine_trace') is distinct from 'array'
    or jsonb_typeof(coalesce(proposal->'random_outcomes','{}'::jsonb))<>'object'
    or jsonb_typeof(coalesce(proposal->'ai_adjudications','[]'::jsonb))<>'array'
  then raise exception using errcode='22023',message='INVALID_ENGINE_PROPOSAL'; end if;
  if proposal_status<>'RESOLUTION_ERROR' and (
    jsonb_array_length(proposal->'action_results')<>jsonb_array_length(session_row.submitted_actions)
    or exists(select 1 from jsonb_array_elements(proposal->'action_results') result group by result->>'action_id' having count(*)<>1)
    or exists(select 1 from jsonb_array_elements(session_row.submitted_actions) queued where not exists(select 1 from jsonb_array_elements(proposal->'action_results') result where result->>'action_id'=queued->>'id'))
    or exists(select 1 from jsonb_array_elements(proposal->'action_results') result where not exists(select 1 from jsonb_array_elements(session_row.submitted_actions) queued where queued->>'id'=result->>'action_id'))
  ) then raise exception using errcode='22023',message='ENGINE_ACTION_SNAPSHOT_MISMATCH'; end if;
  update public.resolution_sessions session set
    engine_proposal=proposal,
    engine_trace=proposal->'engine_trace',
    random_outcomes=coalesce(proposal->'random_outcomes','{}'::jsonb),
    ai_adjudications=coalesce(proposal->'ai_adjudications','[]'::jsonb),
    engine_status=proposal_status,
    engine_version=left(coalesce(proposal->>'engine_version','unknown'),100),
    simulation_version=session.simulation_version+1,
    lock_version=session.lock_version+1,
    status=case when proposal_status='RESOLUTION_ERROR' then 'OPEN' else 'GM_REVIEW' end,
    simulated_at=now(),
    simulated_by=actor,
    updated_at=now()
  where session.id=target_session_id returning * into session_row;
  insert into public.resolution_session_events(session_id,game_id,event_order,event_type,outcome)
  values(session_row.id,session_row.game_id,coalesce((select max(event.event_order)+1 from public.resolution_session_events event where event.session_id=session_row.id),1),'OTHER',jsonb_build_object('event_type','DETERMINISTIC_SIMULATION_COMPLETED','engineStatus',proposal_status,'engineVersion',session_row.engine_version,'simulationVersion',session_row.simulation_version,'resolvedByEngine',coalesce(proposal#>>'{observability,engine_resolved_count}','0'),'aiAdjudications',coalesce(proposal#>>'{observability,ai_adjudication_count}','0'),'gmReviewCount',coalesce(proposal#>>'{observability,gm_review_count}','0')));
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(session_row.game_id,actor,'resolution_session',session_row.id::text,'Deterministic night simulation saved',jsonb_build_object('engineStatus',proposal_status,'engineVersion',session_row.engine_version,'simulationVersion',session_row.simulation_version,'startingSnapshotHash',proposal->>'starting_snapshot_hash'));
  return session_row;
end $$;

create or replace function public.save_deterministic_resolution(
  target_session_id uuid,
  expected_lock_version integer,
  target_engine_proposal jsonb
) returns public.resolution_sessions
language sql security definer set search_path=''
as $$ select private.save_deterministic_resolution(target_session_id,expected_lock_version,target_engine_proposal) $$;

revoke all on function private.start_resolution_session_v11_9(uuid,integer),private.start_resolution_session(uuid,integer),private.save_deterministic_resolution(uuid,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.save_deterministic_resolution(uuid,integer,jsonb) from public,anon;
grant execute on function public.save_deterministic_resolution(uuid,integer,jsonb) to authenticated;

comment on column public.resolution_sessions.engine_proposal is 'Deterministic proposed final state and complete structured night ruling; never live state.';
comment on column public.resolution_sessions.engine_trace is 'Expandable ordered stage trace for replay and GM review.';
comment on column public.resolution_sessions.random_outcomes is 'Trusted random results generated once and reused during recalculation.';
comment on function public.save_deterministic_resolution(uuid,integer,jsonb) is 'Persists a GM-visible deterministic simulation without applying live game state.';

-- Explicit role removal from a GM-approved conversion must survive the legacy
-- atomic approval path. Empty role IDs without a ROLE change remain unchanged.
do $conversion_fix$
declare definition text;
begin
  definition:=pg_get_functiondef('private.approve_and_apply_resolution_v11_5(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)'::regprocedure);
  if position($old$||case when coalesce(outcome.value->>'role_id','')<>'' then jsonb_build_object('roleId',outcome.value->>'role_id') else '{}'::jsonb end$old$ in definition)=0 then
    raise exception 'APPROVAL_ROLE_PATCH_PRECONDITION_FAILED';
  end if;
  execute replace(definition,$old$||case when coalesce(outcome.value->>'role_id','')<>'' then jsonb_build_object('roleId',outcome.value->>'role_id') else '{}'::jsonb end$old$,$new$||case when coalesce(outcome.value->>'role_id','')<>'' then jsonb_build_object('roleId',outcome.value->>'role_id') when outcome.value->>'role_id'='' and exists(select 1 from jsonb_array_elements(coalesce(outcome.value->'changes','[]'::jsonb)) role_change where role_change->>'type'='ROLE' and role_change->>'after'='') then jsonb_build_object('roleId','','currentModeId','','modeName','') else '{}'::jsonb end$new$);
end $conversion_fix$;
