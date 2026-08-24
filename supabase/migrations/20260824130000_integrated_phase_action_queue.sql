-- v11.3: one authoritative game phase and one phase-scoped action queue.
-- The game document remains synchronized for backward-compatible readers, while
-- phase transitions and historical queues are owned by locked server records.

create table public.game_phases (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  phase_sequence integer not null check (phase_sequence between 1 and 20000),
  cycle integer not null check (cycle between 0 and 9999),
  phase text not null check (phase in ('Day','Night')),
  status text not null default 'CURRENT' check (status in ('CURRENT','COMPLETED')),
  queue_version integer not null default 1 check (queue_version > 0),
  action_queue jsonb not null default '[]'::jsonb check (jsonb_typeof(action_queue)='array' and octet_length(action_queue::text)<=300000),
  resolution_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(resolution_summary)='object' and octet_length(resolution_summary::text)<=300000),
  started_at timestamptz not null default now(),
  started_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  close_reason text not null default '' check (char_length(close_reason)<=4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(game_id,phase_sequence),
  unique(game_id,cycle,phase)
);

create unique index game_phases_one_current_per_game_idx on public.game_phases(game_id) where status='CURRENT';
create index game_phases_game_sequence_idx on public.game_phases(game_id,phase_sequence desc);

create table public.game_phase_events (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  phase_id uuid not null references public.game_phases(id) on delete cascade,
  event_type text not null check (event_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  action_id text,
  resolution_session_id uuid references public.resolution_sessions(id) on delete set null,
  summary text not null default '' check (char_length(summary)<=4000),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=100000),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index game_phase_events_phase_created_idx on public.game_phase_events(phase_id,created_at desc);
create index game_phase_events_game_created_idx on public.game_phase_events(game_id,created_at desc);

alter table public.resolution_sessions add column phase_id uuid references public.game_phases(id) on delete restrict;
alter table public.resolution_sessions add column source_phase_version integer check (source_phase_version is null or source_phase_version>0);
alter table public.resolution_session_events add column action_id text;
create index resolution_sessions_phase_created_idx on public.resolution_sessions(phase_id,created_at desc) where phase_id is not null;
create index resolution_session_events_action_idx on public.resolution_session_events(session_id,action_id) where action_id is not null;

alter table public.game_phases enable row level security;
alter table public.game_phase_events enable row level security;
create policy game_phases_gm_read on public.game_phases for select to authenticated using (public.can_edit_game(game_id));
create policy game_phase_events_gm_read on public.game_phase_events for select to authenticated using (public.can_edit_game(game_id));
revoke all on table public.game_phases,public.game_phase_events from public,anon,authenticated;
grant select on table public.game_phases,public.game_phase_events to authenticated;

-- Preserve phase labels from completed resolution history before opening the
-- current phase for active legacy games.
insert into public.game_phases(game_id,phase_sequence,cycle,phase,status,action_queue,resolution_summary,started_at,closed_at,close_reason)
select grouped.game_id,
       row_number() over(partition by grouped.game_id order by grouped.cycle,case grouped.phase when 'Day' then 1 else 2 end)::integer,
       grouped.cycle,grouped.phase,'COMPLETED',grouped.actions,
       jsonb_build_object('migratedSessionCount',grouped.session_count),grouped.started_at,grouped.closed_at,'Migrated resolution history'
from (
  select session.game_id,session.cycle,session.phase,
         coalesce((array_agg(session.submitted_actions order by session.created_at desc))[1],'[]'::jsonb) actions,
         count(*) session_count,min(session.created_at) started_at,max(coalesce(session.finalized_at,session.updated_at)) closed_at
  from public.resolution_sessions session
  where session.phase in ('Day','Night')
  group by session.game_id,session.cycle,session.phase
) grouped
on conflict(game_id,cycle,phase) do nothing;

insert into public.game_phases(game_id,phase_sequence,cycle,phase,status,action_queue,started_by)
select document_row.game_id,
       coalesce((select max(existing.phase_sequence)+1 from public.game_phases existing where existing.game_id=document_row.game_id),1),
       greatest(0,coalesce(nullif(document_row.document#>>'{game,currentDay}','')::integer,0)),
       case when document_row.document#>>'{game,currentPhase}'='Night' then 'Night' else 'Day' end,
       'CURRENT',coalesce(document_row.document#>'{data,actions}','[]'::jsonb),document_row.updated_by
from public.game_documents document_row
where document_row.document#>>'{game,status}' in ('ACTIVE','PAUSED')
on conflict(game_id,cycle,phase) do update set
  status='CURRENT',action_queue=excluded.action_queue,closed_at=null,closed_by=null,close_reason='',updated_at=now();

update public.resolution_sessions session set
  phase_id=phase_row.id,
  source_phase_version=phase_row.queue_version
from public.game_phases phase_row
where session.phase_id is null and phase_row.game_id=session.game_id and phase_row.cycle=session.cycle and phase_row.phase=session.phase;

create or replace function private.phase_next(current_cycle integer,current_phase text)
returns jsonb language sql immutable set search_path='' as $$
  select case when current_phase='Night'
    then jsonb_build_object('cycle',current_cycle+1,'phase','Day')
    else jsonb_build_object('cycle',current_cycle,'phase','Night') end
$$;

create or replace function private.phase_advance_preview(target_game_id uuid,target_phase_id uuid,target_phase_version integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare current_row public.game_phases%rowtype;next_value jsonb;action_count integer;unresolved_count integer;open_count integer;
begin
  select * into current_row from public.game_phases phase_row where phase_row.id=target_phase_id and phase_row.game_id=target_game_id;
  if not found or current_row.status<>'CURRENT' then raise exception using errcode='40001',message='PHASE_CHANGED'; end if;
  if current_row.queue_version<>target_phase_version then raise exception using errcode='40001',message='PHASE_VERSION_CONFLICT'; end if;
  action_count:=jsonb_array_length(current_row.action_queue);
  select count(*) into open_count from public.resolution_sessions session where session.phase_id=current_row.id and session.status not in ('FINALIZED','REJECTED');
  unresolved_count:=case when action_count=0 then 0 when exists(
    select 1 from public.resolution_sessions session where session.phase_id=current_row.id and session.source_phase_version=current_row.queue_version and session.status='FINALIZED'
  ) then 0 else action_count end;
  next_value:=private.phase_next(current_row.cycle,current_row.phase);
  return jsonb_build_object(
    'current_phase_id',current_row.id,'current_phase_version',current_row.queue_version,'next_phase',next_value,
    'action_count',action_count,'resolved_count',greatest(0,action_count-unresolved_count),'unresolved_count',unresolved_count,
    'unresolved_action_ids',case when unresolved_count=0 then '[]'::jsonb else coalesce((select jsonb_agg(item->>'id' order by ordinality) from jsonb_array_elements(current_row.action_queue) with ordinality queued(item,ordinality)),'[]'::jsonb) end,
    'open_session_count',open_count,
    'expiring_statuses',coalesce((select jsonb_agg(to_jsonb(effect) order by effect.created_at) from public.player_status_effects effect
      where effect.game_id=target_game_id and effect.state in ('ACTIVE','PENDING') and (
        (effect.expires_at_cycle=current_row.cycle and coalesce(effect.expires_at_phase,'Any') in ('Any',current_row.phase)) or effect.remaining_duration=1
      )),'[]'::jsonb),
    'decrementing_statuses',coalesce((select jsonb_agg(to_jsonb(effect) order by effect.created_at) from public.player_status_effects effect
      where effect.game_id=target_game_id and effect.state in ('ACTIVE','PENDING') and effect.remaining_duration>1),'[]'::jsonb),
    'expiring_grants',coalesce((select jsonb_agg(to_jsonb(grant_row) order by grant_row.created_at) from public.player_ability_grants grant_row
      where grant_row.game_id=target_game_id and grant_row.status='ACTIVE' and (
        grant_row.expires_at<=now()
        or (grant_row.expires_cycle=current_row.cycle and coalesce(nullif(grant_row.expires_phase,''),'Any') in ('Any',current_row.phase))
        or grant_row.duration_type='UNTIL_END_OF_PHASE'
        or (grant_row.duration_type='UNTIL_END_OF_DAY' and current_row.phase='Day')
        or (grant_row.duration_type in ('UNTIL_END_OF_NIGHT','UNTIL_END_OF_CYCLE') and current_row.phase='Night')
      )),'[]'::jsonb),
    'cooldown_updates',coalesce((select jsonb_agg(jsonb_build_object('playerId',event.actor_player_id,'abilityId',event.ability_id,'eventId',event.id) order by event.id)
      from public.resolution_session_events event join public.resolution_sessions session on session.id=event.session_id
      where session.phase_id=current_row.id and event.event_type='ABILITY_CONSUMED'),'[]'::jsonb),
    'ability_refreshes',coalesce((select jsonb_agg(to_jsonb(refresh_row) order by refresh_row.player_id,refresh_row.ability_id) from (
      select item->>'sourcePlayerId' player_id,item->>'abilityId' ability_id,count(*) uses_to_refresh
      from jsonb_array_elements(current_row.action_queue) item
      where nullif(item->>'sourcePlayerId','') is not null and nullif(item->>'abilityId','') is not null
      group by item->>'sourcePlayerId',item->>'abilityId'
    ) refresh_row),'[]'::jsonb),
    'pending_effects',coalesce((select jsonb_agg(to_jsonb(effect) order by effect.created_at) from public.player_status_effects effect where effect.game_id=target_game_id and effect.state='PENDING'),'[]'::jsonb),
    'timers',coalesce((select jsonb_agg(jsonb_build_object('statusId',effect.id,'playerId',effect.player_id,'remaining',effect.remaining_duration,'expiresCycle',effect.expires_at_cycle,'expiresPhase',effect.expires_at_phase) order by effect.created_at)
      from public.player_status_effects effect where effect.game_id=target_game_id and effect.state in ('ACTIVE','PENDING') and (effect.remaining_duration is not null or effect.expires_at_cycle is not null)),'[]'::jsonb)
  );
end$$;

create or replace function public.get_game_phase_context(target_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare current_row public.game_phases%rowtype;game_state text;preview_value jsonb;
begin
  if (select auth.uid()) is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select game.status into game_state from public.games game where game.id=target_game_id;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  select * into current_row from public.game_phases phase_row where phase_row.game_id=target_game_id and phase_row.status='CURRENT';
  if found then preview_value:=private.phase_advance_preview(target_game_id,current_row.id,current_row.queue_version); end if;
  return jsonb_build_object(
    'game_status',game_state,'current_phase_id',current_row.id,
    'phases',coalesce((select jsonb_agg(to_jsonb(phase_row) order by phase_row.phase_sequence desc) from public.game_phases phase_row where phase_row.game_id=target_game_id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(event_row) order by event_row.created_at desc) from (select * from public.game_phase_events event_source where event_source.game_id=target_game_id order by event_source.created_at desc limit 500) event_row),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(to_jsonb(session) order by session.created_at desc) from public.resolution_sessions session where session.game_id=target_game_id),'[]'::jsonb),
    'preview',preview_value
  );
end$$;

create or replace function public.preview_game_phase_advance(target_game_id uuid,target_phase_id uuid,target_phase_version integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  return private.phase_advance_preview(target_game_id,target_phase_id,target_phase_version);
end$$;

create or replace function public.start_game_phase(target_game_id uuid,expected_game_version integer,target_starting_phase text,target_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());stored public.game_documents%rowtype;start_value text:=upper(btrim(coalesce(target_starting_phase,'')));cycle_value integer;phase_value text;next_document jsonb;saved record;phase_row public.game_phases%rowtype;
begin
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if start_value not in ('NIGHT_0','DAY_1') then raise exception using errcode='22023',message='INVALID_STARTING_PHASE'; end if;
  if char_length(btrim(coalesce(target_reason,''))) not between 3 and 4000 then raise exception using errcode='22023',message='PHASE_REASON_REQUIRED'; end if;
  select * into stored from public.game_documents document_row where document_row.game_id=target_game_id for update;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  if stored.version<>expected_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  if exists(select 1 from public.game_phases current_phase where current_phase.game_id=target_game_id and current_phase.status='CURRENT') then raise exception using errcode='55000',message='GAME_ALREADY_STARTED'; end if;
  if stored.document#>>'{game,status}' not in ('SETUP','PAUSED') then raise exception using errcode='55000',message='GAME_CANNOT_START'; end if;
  cycle_value:=case when start_value='NIGHT_0' then 0 else 1 end;phase_value:=case when start_value='NIGHT_0' then 'Night' else 'Day' end;
  insert into public.game_phases(game_id,phase_sequence,cycle,phase,status,action_queue,started_by)
  values(target_game_id,coalesce((select max(existing.phase_sequence)+1 from public.game_phases existing where existing.game_id=target_game_id),1),cycle_value,phase_value,'CURRENT','[]'::jsonb,actor)
  returning * into phase_row;
  next_document:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(stored.document,'{game,status}','"ACTIVE"'::jsonb,false),'{game,currentDay}',to_jsonb(cycle_value),false),'{game,currentPhase}',to_jsonb(phase_value),false),'{data,actions}','[]'::jsonb,false);
  select * into saved from public.save_game_document(target_game_id,stored.version,next_document,'Game started at '||phase_value||' '||cycle_value,'game_phase',phase_row.id::text) limit 1;
  insert into public.game_phase_events(game_id,phase_id,event_type,summary,payload,actor_user_id) values(target_game_id,phase_row.id,'GAME_STARTED',left(btrim(target_reason),4000),jsonb_build_object('startingPhase',phase_value,'cycle',cycle_value),actor);
  return jsonb_build_object('phase',to_jsonb(phase_row),'document',saved.document,'version',saved.version,'updated_at',saved.updated_at,'updated_by',saved.updated_by);
end$$;

create or replace function public.set_game_phase_pause(target_game_id uuid,expected_game_version integer,target_phase_id uuid,target_phase_version integer,target_paused boolean,target_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());stored public.game_documents%rowtype;phase_row public.game_phases%rowtype;next_document jsonb;saved record;status_value text:=case when coalesce(target_paused,false) then 'PAUSED' else 'ACTIVE' end;
begin
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if char_length(btrim(coalesce(target_reason,''))) not between 3 and 4000 then raise exception using errcode='22023',message='PHASE_REASON_REQUIRED'; end if;
  select * into stored from public.game_documents document_row where document_row.game_id=target_game_id for update;
  if not found or stored.version<>expected_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  select * into phase_row from public.game_phases current_phase where current_phase.id=target_phase_id and current_phase.game_id=target_game_id and current_phase.status='CURRENT' for update;
  if not found or phase_row.queue_version<>target_phase_version then raise exception using errcode='40001',message='PHASE_VERSION_CONFLICT'; end if;
  next_document:=jsonb_set(stored.document,'{game,status}',to_jsonb(status_value),false);
  select * into saved from public.save_game_document(target_game_id,stored.version,next_document,case when target_paused then 'Game paused' else 'Game resumed' end,'game_phase',phase_row.id::text) limit 1;
  insert into public.game_phase_events(game_id,phase_id,event_type,summary,actor_user_id) values(target_game_id,phase_row.id,case when target_paused then 'GAME_PAUSED' else 'GAME_RESUMED' end,left(btrim(target_reason),4000),actor);
  return jsonb_build_object('phase',to_jsonb(phase_row),'document',saved.document,'version',saved.version,'updated_at',saved.updated_at,'updated_by',saved.updated_by);
end$$;

create or replace function public.advance_game_phase(target_game_id uuid,expected_game_version integer,target_phase_id uuid,target_phase_version integer,target_allow_unresolved boolean,target_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());stored public.game_documents%rowtype;current_row public.game_phases%rowtype;next_row public.game_phases%rowtype;preview_value jsonb;next_value jsonb;next_document jsonb;saved record;grant_row public.player_ability_grants%rowtype;previous_grant jsonb;consequence_count integer:=0;
begin
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if char_length(btrim(coalesce(target_reason,''))) not between 3 and 4000 then raise exception using errcode='22023',message='PHASE_REASON_REQUIRED'; end if;
  select * into stored from public.game_documents document_row where document_row.game_id=target_game_id for update;
  if not found or stored.version<>expected_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  if stored.document#>>'{game,status}'='PAUSED' then raise exception using errcode='55000',message='GAME_PAUSED'; end if;
  select * into current_row from public.game_phases phase_row where phase_row.id=target_phase_id and phase_row.game_id=target_game_id and phase_row.status='CURRENT' for update;
  if not found or current_row.queue_version<>target_phase_version then raise exception using errcode='40001',message='PHASE_VERSION_CONFLICT'; end if;
  preview_value:=private.phase_advance_preview(target_game_id,current_row.id,current_row.queue_version);
  if (preview_value->>'unresolved_count')::integer>0 and not coalesce(target_allow_unresolved,false) then raise exception using errcode='55000',message='UNRESOLVED_ACTIONS_REQUIRE_APPROVAL'; end if;
  perform set_config('app.player_status_action','EXPIRE',true);perform set_config('app.player_status_reason','Expired automatically while advancing from '||current_row.phase||' '||current_row.cycle||': '||left(btrim(target_reason),1800),true);
  update public.player_status_effects effect set state='EXPIRED',updated_at=now(),updated_by=actor
  where effect.game_id=target_game_id and effect.state in ('ACTIVE','PENDING') and ((effect.expires_at_cycle=current_row.cycle and coalesce(effect.expires_at_phase,'Any') in ('Any',current_row.phase)) or effect.remaining_duration=1);
  get diagnostics consequence_count=row_count;
  perform set_config('app.player_status_action','SHORTEN',true);perform set_config('app.player_status_reason','Duration decremented while advancing from '||current_row.phase||' '||current_row.cycle,true);
  update public.player_status_effects effect set remaining_duration=effect.remaining_duration-1,updated_at=now(),updated_by=actor
  where effect.game_id=target_game_id and effect.state in ('ACTIVE','PENDING') and effect.remaining_duration>1;
  for grant_row in select * from public.player_ability_grants grant_source where grant_source.game_id=target_game_id and grant_source.status='ACTIVE' and (
    grant_source.expires_at<=now()
    or (grant_source.expires_cycle=current_row.cycle and coalesce(nullif(grant_source.expires_phase,''),'Any') in ('Any',current_row.phase))
    or grant_source.duration_type='UNTIL_END_OF_PHASE'
    or (grant_source.duration_type='UNTIL_END_OF_DAY' and current_row.phase='Day')
    or (grant_source.duration_type in ('UNTIL_END_OF_NIGHT','UNTIL_END_OF_CYCLE') and current_row.phase='Night')
  ) for update loop
    previous_grant:=to_jsonb(grant_row);
    update public.player_ability_grants grant_target set status='EXPIRED',version=grant_target.version+1,updated_at=now() where grant_target.id=grant_row.id returning * into grant_row;
    insert into public.player_ability_grant_events(game_id,grant_id,player_id,ability_id,event_type,previous_state,new_state,reason,actor_user_id)
    values(target_game_id,grant_row.id,grant_row.player_id,grant_row.ability_id,'EXPIRED',previous_grant,to_jsonb(grant_row),'Expired automatically at the end of '||current_row.phase||' '||current_row.cycle||'. '||left(btrim(target_reason),3800),actor);
    consequence_count:=consequence_count+1;
  end loop;
  if jsonb_array_length(preview_value->'expiring_statuses')>0 then
    insert into public.game_phase_events(game_id,phase_id,event_type,summary,payload,actor_user_id) values(target_game_id,current_row.id,'STATUS_EXPIRED',jsonb_array_length(preview_value->'expiring_statuses')||' status effect(s) expired automatically.',jsonb_build_object('statuses',preview_value->'expiring_statuses'),actor);
  end if;
  if jsonb_array_length(preview_value->'decrementing_statuses')>0 then
    insert into public.game_phase_events(game_id,phase_id,event_type,summary,payload,actor_user_id) values(target_game_id,current_row.id,'STATUS_TIMER_UPDATED',jsonb_array_length(preview_value->'decrementing_statuses')||' status timer(s) decremented automatically.',jsonb_build_object('statuses',preview_value->'decrementing_statuses'),actor);
  end if;
  if jsonb_array_length(preview_value->'expiring_grants')>0 then
    insert into public.game_phase_events(game_id,phase_id,event_type,summary,payload,actor_user_id) values(target_game_id,current_row.id,'TEMPORARY_ABILITY_EXPIRED',jsonb_array_length(preview_value->'expiring_grants')||' temporary ability grant(s) expired automatically.',jsonb_build_object('grants',preview_value->'expiring_grants'),actor);
  end if;
  if jsonb_array_length(preview_value->'ability_refreshes')>0 then
    insert into public.game_phase_events(game_id,phase_id,event_type,summary,payload,actor_user_id) values(target_game_id,current_row.id,'ABILITY_USES_REFRESHED',jsonb_array_length(preview_value->'ability_refreshes')||' phase-scoped ability use counter(s) reset with the new queue.',jsonb_build_object('abilities',preview_value->'ability_refreshes'),actor);
  end if;
  if jsonb_array_length(preview_value->'cooldown_updates')>0 then
    insert into public.game_phase_events(game_id,phase_id,event_type,summary,payload,actor_user_id) values(target_game_id,current_row.id,'COOLDOWN_UPDATED',jsonb_array_length(preview_value->'cooldown_updates')||' cooldown record(s) moved into the next phase context.',jsonb_build_object('cooldowns',preview_value->'cooldown_updates'),actor);
  end if;
  if jsonb_array_length(preview_value->'pending_effects')>0 then
    insert into public.game_phase_events(game_id,phase_id,event_type,summary,payload,actor_user_id) values(target_game_id,current_row.id,'PENDING_EFFECTS_REVIEWED',jsonb_array_length(preview_value->'pending_effects')||' pending effect(s) were preserved for explicit resolution.',jsonb_build_object('effects',preview_value->'pending_effects'),actor);
  end if;
  next_value:=private.phase_next(current_row.cycle,current_row.phase);
  update public.game_phases phase_row set status='COMPLETED',closed_at=now(),closed_by=actor,close_reason=left(btrim(target_reason),4000),updated_at=now() where phase_row.id=current_row.id returning * into current_row;
  insert into public.game_phases(game_id,phase_sequence,cycle,phase,status,action_queue,started_by)
  values(target_game_id,current_row.phase_sequence+1,(next_value->>'cycle')::integer,next_value->>'phase','CURRENT','[]'::jsonb,actor) returning * into next_row;
  insert into public.game_phase_events(game_id,phase_id,event_type,summary,payload,actor_user_id)
  values(target_game_id,current_row.id,'PHASE_ADVANCED',left(btrim(target_reason),4000),preview_value||jsonb_build_object('nextPhaseId',next_row.id,'automaticConsequenceCount',consequence_count,'allowedUnresolved',coalesce(target_allow_unresolved,false)),actor);
  insert into public.game_phase_events(game_id,phase_id,event_type,summary,payload,actor_user_id)
  values(target_game_id,next_row.id,'PHASE_OPENED','Opened automatically after '||current_row.phase||' '||current_row.cycle||'.',jsonb_build_object('previousPhaseId',current_row.id),actor);
  next_document:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(stored.document,'{game,status}','"ACTIVE"'::jsonb,false),'{game,currentDay}',to_jsonb((next_value->>'cycle')::integer),false),'{game,currentPhase}',to_jsonb(next_value->>'phase'),false),'{data,actions}','[]'::jsonb,false);
  select * into saved from public.save_game_document(target_game_id,stored.version,next_document,'Advanced to '||(next_value->>'phase')||' '||(next_value->>'cycle'),'game_phase',current_row.id::text) limit 1;
  return jsonb_build_object('previous_phase',to_jsonb(current_row),'phase',to_jsonb(next_row),'preview',preview_value,'automatic_consequence_count',consequence_count,'document',saved.document,'version',saved.version,'updated_at',saved.updated_at,'updated_by',saved.updated_by);
end$$;

create or replace function public.admin_correct_phase_action(target_game_id uuid,target_phase_id uuid,expected_phase_version integer,target_operation text,target_action_id text,target_action jsonb,target_reason text)
returns public.game_phases language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());phase_row public.game_phases%rowtype;operation text:=upper(btrim(coalesce(target_operation,'')));actions jsonb;action_value jsonb:=coalesce(target_action,'{}'::jsonb);
begin
  if actor is null or not public.is_game_owner(target_game_id) then raise exception using errcode='42501',message='OWNER_ACCESS_REQUIRED'; end if;
  if operation not in ('UPSERT','REMOVE') then raise exception using errcode='22023',message='INVALID_CORRECTION_OPERATION'; end if;
  if char_length(btrim(coalesce(target_reason,''))) not between 3 and 4000 then raise exception using errcode='22023',message='CORRECTION_REASON_REQUIRED'; end if;
  select * into phase_row from public.game_phases source where source.id=target_phase_id and source.game_id=target_game_id for update;
  if not found then raise exception using errcode='P0002',message='PHASE_NOT_FOUND'; end if;
  if phase_row.status<>'COMPLETED' then raise exception using errcode='55000',message='CURRENT_PHASE_USES_ACTION_QUEUE'; end if;
  if phase_row.queue_version<>expected_phase_version then raise exception using errcode='40001',message='PHASE_VERSION_CONFLICT'; end if;
  if nullif(btrim(coalesce(target_action_id,'')),'') is null then raise exception using errcode='22023',message='ACTION_ID_REQUIRED'; end if;
  actions:=phase_row.action_queue;
  if operation='REMOVE' then
    if not exists(select 1 from jsonb_array_elements(actions) item where item->>'id'=target_action_id) then raise exception using errcode='P0002',message='ACTION_NOT_FOUND'; end if;
    select coalesce(jsonb_agg(item order by ordinality),'[]'::jsonb) into actions from jsonb_array_elements(actions) with ordinality queued(item,ordinality) where item->>'id'<>target_action_id;
  else
    if jsonb_typeof(action_value)<>'object' or coalesce(action_value->>'id','')<>target_action_id or octet_length(action_value::text)>50000 then raise exception using errcode='22023',message='INVALID_ACTION'; end if;
    if exists(select 1 from jsonb_array_elements(actions) item where item->>'id'=target_action_id) then
      select jsonb_agg(case when item->>'id'=target_action_id then action_value else item end order by ordinality) into actions from jsonb_array_elements(actions) with ordinality queued(item,ordinality);
    else actions:=actions||jsonb_build_array(action_value); end if;
  end if;
  update public.game_phases target set action_queue=actions,queue_version=target.queue_version+1,updated_at=now() where target.id=phase_row.id returning * into phase_row;
  insert into public.game_phase_events(game_id,phase_id,event_type,action_id,summary,payload,actor_user_id) values(target_game_id,phase_row.id,'ADMIN_CORRECTION',target_action_id,left(btrim(target_reason),4000),jsonb_build_object('operation',operation,'phaseVersion',phase_row.queue_version),actor);
  return phase_row;
end$$;

-- Wrap the proven v11.2 action validator instead of duplicating it. The outer
-- function binds every accepted mutation to the locked current phase.
alter function private.queue_player_action(uuid,integer,jsonb,text) rename to queue_player_action_document_v11_2;
create or replace function private.queue_player_action(target_game_id uuid,expected_game_version integer,target_action jsonb,target_replace_action_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row public.game_phases%rowtype;updated_row public.game_phases%rowtype;result jsonb;phase_actions jsonb;requested_phase_id uuid;requested_phase_version integer;
begin
  if (select auth.uid()) is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  begin requested_phase_id:=(target_action->>'phaseId')::uuid;requested_phase_version:=(target_action->>'phaseVersion')::integer;exception when others then raise exception using errcode='22023',message='PHASE_CONTEXT_REQUIRED'; end;
  select * into current_row from public.game_phases phase_row where phase_row.game_id=target_game_id and phase_row.status='CURRENT' for update;
  if not found or current_row.id<>requested_phase_id then raise exception using errcode='40001',message='PHASE_CHANGED'; end if;
  if current_row.queue_version<>requested_phase_version then raise exception using errcode='40001',message='PHASE_VERSION_CONFLICT'; end if;
  if (select game.status from public.games game where game.id=target_game_id)<>'ACTIVE' then raise exception using errcode='55000',message='GAME_NOT_ACTIVE'; end if;
  result:=private.queue_player_action_document_v11_2(target_game_id,expected_game_version,target_action,target_replace_action_id);
  select coalesce(jsonb_agg(item||jsonb_build_object('phaseId',current_row.id,'phaseVersion',current_row.queue_version+1) order by ordinality),'[]'::jsonb) into phase_actions
  from jsonb_array_elements(coalesce(result#>'{document,data,actions}','[]'::jsonb)) with ordinality queued(item,ordinality);
  update public.game_phases phase_row set action_queue=phase_actions,queue_version=phase_row.queue_version+1,updated_at=now() where phase_row.id=current_row.id returning * into updated_row;
  insert into public.game_phase_events(game_id,phase_id,event_type,action_id,summary,payload,actor_user_id) values(target_game_id,current_row.id,case when target_replace_action_id is null then 'ACTION_QUEUED' else 'ACTION_EDITED' end,result#>>'{action,id}',coalesce(result#>>'{action,name}','Structured action')||case when target_replace_action_id is null then ' queued.' else ' edited.' end,jsonb_build_object('phaseVersion',updated_row.queue_version,'action',result->'action'),auth.uid());
  return result||jsonb_build_object('phase',to_jsonb(updated_row),'document',jsonb_set(result->'document','{data,actions}',phase_actions,false));
end$$;

create or replace function public.queue_player_action(target_game_id uuid,expected_game_version integer,target_action jsonb,target_replace_action_id text default null)
returns jsonb language sql security definer set search_path='' as $$select private.queue_player_action(target_game_id,expected_game_version,target_action,target_replace_action_id)$$;

alter function private.remove_queued_action(uuid,integer,text,text) rename to remove_queued_action_document_v11_2;
create or replace function private.remove_queued_action(target_game_id uuid,expected_game_version integer,target_action_id text,target_reason text,target_phase_id uuid,target_phase_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row public.game_phases%rowtype;updated_row public.game_phases%rowtype;result jsonb;phase_actions jsonb;
begin
  if (select auth.uid()) is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select * into current_row from public.game_phases phase_row where phase_row.id=target_phase_id and phase_row.game_id=target_game_id and phase_row.status='CURRENT' for update;
  if not found or current_row.queue_version<>target_phase_version then raise exception using errcode='40001',message='PHASE_VERSION_CONFLICT'; end if;
  if (select game.status from public.games game where game.id=target_game_id)<>'ACTIVE' then raise exception using errcode='55000',message='GAME_NOT_ACTIVE'; end if;
  result:=private.remove_queued_action_document_v11_2(target_game_id,expected_game_version,target_action_id,target_reason);
  select coalesce(jsonb_agg(item||jsonb_build_object('phaseId',current_row.id,'phaseVersion',current_row.queue_version+1) order by ordinality),'[]'::jsonb) into phase_actions
  from jsonb_array_elements(coalesce(result#>'{document,data,actions}','[]'::jsonb)) with ordinality queued(item,ordinality);
  update public.game_phases phase_row set action_queue=phase_actions,queue_version=phase_row.queue_version+1,updated_at=now() where phase_row.id=current_row.id returning * into updated_row;
  insert into public.game_phase_events(game_id,phase_id,event_type,action_id,summary,payload,actor_user_id) values(target_game_id,current_row.id,'ACTION_REMOVED',target_action_id,left(btrim(target_reason),4000),jsonb_build_object('phaseVersion',updated_row.queue_version),auth.uid());
  return result||jsonb_build_object('phase',to_jsonb(updated_row),'document',jsonb_set(result->'document','{data,actions}',phase_actions,false));
end$$;

drop function public.remove_queued_action(uuid,integer,text,text);
create function public.remove_queued_action(target_game_id uuid,expected_game_version integer,target_action_id text,target_reason text,target_phase_id uuid,target_phase_version integer)
returns jsonb language sql security definer set search_path='' as $$select private.remove_queued_action(target_game_id,expected_game_version,target_action_id,target_reason,target_phase_id,target_phase_version)$$;

alter function private.start_resolution_session(uuid,integer) rename to start_resolution_session_document_v11_2;
create or replace function private.start_resolution_session(target_game_id uuid,expected_game_version integer)
returns public.resolution_sessions language plpgsql security definer set search_path='' as $$
declare current_row public.game_phases%rowtype;existing public.resolution_sessions%rowtype;result public.resolution_sessions%rowtype;
begin
  if (select auth.uid()) is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select * into current_row from public.game_phases phase_row where phase_row.game_id=target_game_id and phase_row.status='CURRENT' for update;
  if not found then raise exception using errcode='55000',message='GAME_NOT_STARTED'; end if;
  if jsonb_array_length(current_row.action_queue)=0 then raise exception using errcode='22023',message='ACTION_QUEUE_EMPTY'; end if;
  select * into existing from public.resolution_sessions session where session.phase_id=current_row.id and session.source_phase_version=current_row.queue_version order by session.created_at desc limit 1;
  if found then return existing; end if;
  result:=private.start_resolution_session_document_v11_2(target_game_id,expected_game_version);
  update public.resolution_sessions session set phase_id=current_row.id,source_phase_version=current_row.queue_version,submitted_actions=current_row.action_queue where session.id=result.id returning * into result;
  insert into public.game_phase_events(game_id,phase_id,event_type,resolution_session_id,summary,payload,actor_user_id) values(target_game_id,current_row.id,'RESOLUTION_SESSION_OPENED',result.id,'Resolution Session opened for the current phase queue.',jsonb_build_object('phaseVersion',current_row.queue_version,'actionCount',jsonb_array_length(current_row.action_queue)),auth.uid());
  return result;
end$$;

create or replace function public.start_resolution_session(target_game_id uuid,expected_game_version integer)
returns public.resolution_sessions language sql security definer set search_path='' as $$select private.start_resolution_session(target_game_id,expected_game_version)$$;

alter function private.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[]) rename to finalize_resolution_with_grants_v11_2;
create or replace function private.finalize_resolution_with_grants(target_session_id uuid,expected_lock_version integer,target_decision text,target_manual_resolution jsonb,target_gm_explanation text,target_teach_ai boolean,target_teach_scope text,target_consumed_action_ids text[])
returns public.resolution_sessions language plpgsql security definer set search_path='' as $$
declare result public.resolution_sessions%rowtype;
begin
  result:=private.finalize_resolution_with_grants_v11_2(target_session_id,expected_lock_version,target_decision,target_manual_resolution,target_gm_explanation,target_teach_ai,target_teach_scope,target_consumed_action_ids);
  if result.phase_id is not null then
    update public.game_phases phase_row set resolution_summary=jsonb_build_object('sessionId',result.id,'status',result.status,'decision',result.gm_decision,'finalResolution',result.final_resolution,'finalizedAt',result.finalized_at),updated_at=now() where phase_row.id=result.phase_id;
    insert into public.game_phase_events(game_id,phase_id,event_type,resolution_session_id,summary,payload,actor_user_id) values(result.game_id,result.phase_id,'RESOLUTION_FINALIZED',result.id,coalesce(nullif(result.gm_explanation,''),'Resolution finalized by a GM.'),jsonb_build_object('status',result.status,'decision',result.gm_decision,'finalResolution',result.final_resolution),auth.uid());
  end if;
  return result;
end$$;

create or replace function public.finalize_resolution_with_grants(target_session_id uuid,expected_lock_version integer,target_decision text,target_manual_resolution jsonb,target_gm_explanation text,target_teach_ai boolean,target_teach_scope text default 'GLOBAL',target_consumed_action_ids text[] default '{}')
returns public.resolution_sessions language sql security definer set search_path='' as $$select private.finalize_resolution_with_grants(target_session_id,expected_lock_version,target_decision,target_manual_resolution,target_gm_explanation,target_teach_ai,target_teach_scope,target_consumed_action_ids)$$;

create or replace function private.capture_resolution_action_id()
returns trigger language plpgsql set search_path='' as $$
begin
  new.action_id:=coalesce(new.action_id,nullif(new.outcome->>'action_id',''),nullif(new.outcome->>'actionId',''));
  return new;
end$$;
create trigger capture_resolution_action_id before insert or update on public.resolution_session_events for each row execute function private.capture_resolution_action_id();

revoke all on function private.phase_next(integer,text),private.phase_advance_preview(uuid,uuid,integer),private.queue_player_action_document_v11_2(uuid,integer,jsonb,text),private.queue_player_action(uuid,integer,jsonb,text),private.remove_queued_action_document_v11_2(uuid,integer,text,text),private.remove_queued_action(uuid,integer,text,text,uuid,integer),private.start_resolution_session_document_v11_2(uuid,integer),private.start_resolution_session(uuid,integer),private.finalize_resolution_with_grants_v11_2(uuid,integer,text,jsonb,text,boolean,text,text[]),private.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[]),private.capture_resolution_action_id() from public,anon,authenticated,service_role;
revoke all on function public.get_game_phase_context(uuid),public.preview_game_phase_advance(uuid,uuid,integer),public.start_game_phase(uuid,integer,text,text),public.set_game_phase_pause(uuid,integer,uuid,integer,boolean,text),public.advance_game_phase(uuid,integer,uuid,integer,boolean,text),public.admin_correct_phase_action(uuid,uuid,integer,text,text,jsonb,text),public.queue_player_action(uuid,integer,jsonb,text),public.remove_queued_action(uuid,integer,text,text,uuid,integer),public.start_resolution_session(uuid,integer),public.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[]) from public,anon;
grant execute on function public.get_game_phase_context(uuid),public.preview_game_phase_advance(uuid,uuid,integer),public.start_game_phase(uuid,integer,text,text),public.set_game_phase_pause(uuid,integer,uuid,integer,boolean,text),public.advance_game_phase(uuid,integer,uuid,integer,boolean,text),public.admin_correct_phase_action(uuid,uuid,integer,text,text,jsonb,text),public.queue_player_action(uuid,integer,jsonb,text),public.remove_queued_action(uuid,integer,text,text,uuid,integer),public.start_resolution_session(uuid,integer),public.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[]) to authenticated;

do $$ begin alter publication supabase_realtime add table public.game_phases; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.game_phase_events; exception when duplicate_object then null; end $$;
