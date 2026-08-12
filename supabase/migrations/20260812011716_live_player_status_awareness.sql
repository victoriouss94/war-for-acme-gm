-- Extensible live player status ledger, history, controlled reads, and GM-approved mutations.
create table public.player_status_effects (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id text not null check (char_length(player_id) between 1 and 100),
  subject_user_id uuid references auth.users(id) on delete set null,
  status_type text not null check (status_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  status_name text not null check (char_length(status_name) between 1 and 120),
  status_category text not null check (status_category in ('HARMFUL','PROTECTION','PASSIVE','TEMPORARY','PERMANENT','CUSTOM')),
  source_player_id text check (source_player_id is null or char_length(source_player_id) between 1 and 100),
  source_role_id text check (source_role_id is null or char_length(source_role_id) between 1 and 100),
  source_ability_id text check (source_ability_id is null or char_length(source_ability_id) between 1 and 100),
  description text not null default '' check (char_length(description) <= 4000),
  applied_at_cycle integer check (applied_at_cycle is null or applied_at_cycle between 0 and 9999),
  applied_at_phase text check (applied_at_phase is null or applied_at_phase in ('Day','Night','Any','Immediate')),
  duration text check (duration is null or char_length(duration) <= 200),
  expires_at_cycle integer check (expires_at_cycle is null or expires_at_cycle between 0 and 9999),
  expires_at_phase text check (expires_at_phase is null or expires_at_phase in ('Day','Night','Any','Immediate')),
  remaining_duration integer check (remaining_duration is null or remaining_duration between 0 and 9999),
  stack_count integer not null default 1 check (stack_count between 1 and 999),
  state text not null default 'ACTIVE' check (state in ('ACTIVE','PENDING','RESOLVED','EXPIRED','CONSUMED')),
  visibility text not null default 'GM_ONLY' check (visibility in ('GM_ONLY','OWNER_VISIBLE','FACTION_VISIBLE','PUBLIC')),
  dispellable boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create table public.player_status_history (
  id bigint generated always as identity primary key,
  status_id uuid not null references public.player_status_effects(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete cascade,
  player_id text not null check (char_length(player_id) between 1 and 100),
  status_action text not null check (status_action in ('APPLY','MODIFY','EXTEND','SHORTEN','REMOVE','RESOLVE','EXPIRE','TRIGGER','CONSUME')),
  previous_effect jsonb,
  next_effect jsonb,
  reason text not null default '' check (char_length(reason) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index player_status_effects_game_player_state_idx on public.player_status_effects(game_id,player_id,state);
create index player_status_effects_active_type_idx on public.player_status_effects(game_id,status_type,player_id) where state in ('ACTIVE','PENDING');
create index player_status_effects_expiration_idx on public.player_status_effects(game_id,expires_at_cycle,expires_at_phase) where state in ('ACTIVE','PENDING') and expires_at_cycle is not null;
create index player_status_effects_subject_user_idx on public.player_status_effects(subject_user_id) where subject_user_id is not null;
create index player_status_effects_created_by_idx on public.player_status_effects(created_by) where created_by is not null;
create index player_status_effects_updated_by_idx on public.player_status_effects(updated_by) where updated_by is not null;
create index player_status_history_game_player_created_idx on public.player_status_history(game_id,player_id,created_at desc);
create index player_status_history_status_created_idx on public.player_status_history(status_id,created_at desc);
create index player_status_history_created_by_idx on public.player_status_history(created_by) where created_by is not null;

alter table public.player_status_effects enable row level security;
alter table public.player_status_history enable row level security;

create policy player_status_effects_read_visible on public.player_status_effects
for select to authenticated using (
  (select public.can_edit_game(game_id))
  or ((select public.is_game_member(game_id)) and visibility = 'PUBLIC')
  or (subject_user_id = (select auth.uid()) and visibility = 'OWNER_VISIBLE')
);
create policy player_status_effects_insert_gm on public.player_status_effects
for insert to authenticated with check ((select public.can_edit_game(game_id)));
create policy player_status_effects_update_gm on public.player_status_effects
for update to authenticated using ((select public.can_edit_game(game_id))) with check ((select public.can_edit_game(game_id)));

create policy player_status_history_read_visible on public.player_status_history
for select to authenticated using ((select public.can_edit_game(game_id)));

grant select on public.player_status_effects,public.player_status_history to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.player_status_effects,public.player_status_history from authenticated,anon;

create schema if not exists private;
revoke all on schema private from public,anon,authenticated;

create or replace function private.capture_player_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_name text := upper(coalesce(nullif(current_setting('app.player_status_action',true),''),case when tg_op='INSERT' then 'APPLY' else 'MODIFY' end));
  action_reason text := left(coalesce(current_setting('app.player_status_reason',true),''),2000);
  actor_id uuid := (select auth.uid());
begin
  if action_name not in ('APPLY','MODIFY','EXTEND','SHORTEN','REMOVE','RESOLVE','EXPIRE','TRIGGER','CONSUME') then action_name := case when tg_op='INSERT' then 'APPLY' else 'MODIFY' end; end if;
  insert into public.player_status_history(status_id,game_id,player_id,status_action,previous_effect,next_effect,reason,created_by)
  values(new.id,new.game_id,new.player_id,action_name,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),action_reason,actor_id);
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data)
  values(new.game_id,actor_id,'player_status',new.id::text,'Player status '||action_name,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
  return new;
end $$;
revoke all on function private.capture_player_status_history() from public,anon,authenticated,service_role;

create trigger capture_player_status_history
after insert or update on public.player_status_effects
for each row execute function private.capture_player_status_history();

create or replace function public.mutate_player_status(target_game_id uuid,target_status_id uuid,target_operation text,target_payload jsonb)
returns public.player_status_effects
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation text := upper(btrim(coalesce(target_operation,'')));
  payload jsonb := coalesce(target_payload,'{}'::jsonb);
  existing public.player_status_effects%rowtype;
  result public.player_status_effects%rowtype;
  requested_player_id text;
  requested_status_type text;
  requested_status_name text;
  requested_category text;
  requested_state text;
  requested_visibility text;
  requested_reason text;
  duration_delta integer;
begin
  if (select auth.uid()) is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if jsonb_typeof(payload) <> 'object' or octet_length(payload::text) > 12000 then raise exception using errcode='22023',message='INVALID_STATUS_PAYLOAD'; end if;
  if operation not in ('APPLY','MODIFY','EDIT','EXTEND','SHORTEN','REMOVE','RESOLVE','EXPIRE','TRIGGER','CONSUME') then raise exception using errcode='22023',message='INVALID_STATUS_OPERATION'; end if;
  requested_reason := left(coalesce(payload->>'reason',''),2000);
  perform set_config('app.player_status_action',case when operation='EDIT' then 'MODIFY' else operation end,true);
  perform set_config('app.player_status_reason',requested_reason,true);

  if operation = 'APPLY' then
    requested_player_id := btrim(coalesce(payload->>'player_id',''));
    requested_status_type := upper(btrim(coalesce(payload->>'status_type','')));
    requested_status_name := btrim(coalesce(payload->>'status_name',''));
    requested_category := upper(btrim(coalesce(payload->>'status_category','TEMPORARY')));
    requested_state := upper(btrim(coalesce(payload->>'state','ACTIVE')));
    requested_visibility := upper(btrim(coalesce(payload->>'visibility','GM_ONLY')));
    if requested_player_id = '' or not exists(
      select 1 from public.game_documents document_row cross join lateral jsonb_array_elements(document_row.document#>'{data,players}') player
      where document_row.game_id=target_game_id and player->>'id'=requested_player_id
    ) then raise exception using errcode='23503',message='PLAYER_NOT_FOUND'; end if;
    if requested_status_type !~ '^[A-Z][A-Z0-9_]{1,63}$' or requested_status_name = '' or char_length(requested_status_name)>120
      or requested_category not in ('HARMFUL','PROTECTION','PASSIVE','TEMPORARY','PERMANENT','CUSTOM')
      or requested_state not in ('ACTIVE','PENDING')
      or requested_visibility not in ('GM_ONLY','OWNER_VISIBLE','FACTION_VISIBLE','PUBLIC')
      or char_length(coalesce(payload->>'description',''))>4000 or char_length(coalesce(payload->>'duration',''))>200
    then raise exception using errcode='22023',message='INVALID_STATUS_FIELDS'; end if;
    if payload ? 'applied_at_cycle' and payload->>'applied_at_cycle' is not null and payload->>'applied_at_cycle' !~ '^\d{1,4}$'
      or payload ? 'expires_at_cycle' and payload->>'expires_at_cycle' is not null and payload->>'expires_at_cycle' !~ '^\d{1,4}$'
      or payload ? 'remaining_duration' and payload->>'remaining_duration' is not null and payload->>'remaining_duration' !~ '^\d{1,4}$'
      or payload ? 'stack_count' and coalesce(payload->>'stack_count','') !~ '^\d{1,3}$'
    then raise exception using errcode='22023',message='INVALID_STATUS_TIMING'; end if;
    if nullif(payload->>'subject_user_id','') is not null and not exists(select 1 from public.game_members member where member.game_id=target_game_id and member.user_id=(payload->>'subject_user_id')::uuid)
    then raise exception using errcode='23503',message='STATUS_OWNER_NOT_GAME_MEMBER'; end if;
    if nullif(payload->>'source_player_id','') is not null and not exists(
      select 1 from public.game_documents document_row cross join lateral jsonb_array_elements(document_row.document#>'{data,players}') player
      where document_row.game_id=target_game_id and player->>'id'=payload->>'source_player_id'
    ) then raise exception using errcode='23503',message='STATUS_SOURCE_PLAYER_NOT_FOUND'; end if;
    if nullif(payload->>'source_role_id','') is not null and not exists(
      select 1 from public.game_documents document_row cross join lateral jsonb_array_elements(document_row.document#>'{data,roles}') role
      where document_row.game_id=target_game_id and role->>'id'=payload->>'source_role_id'
    ) then raise exception using errcode='23503',message='STATUS_SOURCE_ROLE_NOT_FOUND'; end if;
    if nullif(payload->>'source_ability_id','') is not null and not exists(
      select 1 from public.game_documents document_row cross join lateral jsonb_array_elements(document_row.document#>'{data,abilities}') ability
      where document_row.game_id=target_game_id and ability->>'id'=payload->>'source_ability_id'
    ) then raise exception using errcode='23503',message='STATUS_SOURCE_ABILITY_NOT_FOUND'; end if;
    insert into public.player_status_effects(
      id,game_id,player_id,subject_user_id,status_type,status_name,status_category,source_player_id,source_role_id,source_ability_id,description,
      applied_at_cycle,applied_at_phase,duration,expires_at_cycle,expires_at_phase,remaining_duration,stack_count,state,visibility,dispellable,metadata,created_by,updated_by
    ) values (
      coalesce(target_status_id,gen_random_uuid()),target_game_id,requested_player_id,nullif(payload->>'subject_user_id','')::uuid,requested_status_type,requested_status_name,requested_category,
      nullif(payload->>'source_player_id',''),nullif(payload->>'source_role_id',''),nullif(payload->>'source_ability_id',''),coalesce(payload->>'description',''),
      nullif(payload->>'applied_at_cycle','')::integer,nullif(payload->>'applied_at_phase',''),nullif(payload->>'duration',''),nullif(payload->>'expires_at_cycle','')::integer,nullif(payload->>'expires_at_phase',''),
      nullif(payload->>'remaining_duration','')::integer,greatest(1,coalesce(nullif(payload->>'stack_count','')::integer,1)),requested_state,requested_visibility,coalesce((payload->>'dispellable')::boolean,true),coalesce(payload->'metadata','{}'::jsonb),(select auth.uid()),(select auth.uid())
    ) returning * into result;
    return result;
  end if;

  if target_status_id is null then raise exception using errcode='22023',message='STATUS_ID_REQUIRED'; end if;
  select * into existing from public.player_status_effects effect where effect.id=target_status_id and effect.game_id=target_game_id for update;
  if not found then raise exception using errcode='P0002',message='STATUS_NOT_FOUND'; end if;
  if operation in ('REMOVE','RESOLVE','EXPIRE','CONSUME') then
    update public.player_status_effects effect set
      state=case when operation in ('REMOVE','RESOLVE') then 'RESOLVED' else operation||'D' end,
      updated_at=now(),updated_by=(select auth.uid())
    where effect.id=target_status_id returning * into result;
  elsif operation = 'TRIGGER' then
    update public.player_status_effects effect set metadata=effect.metadata||jsonb_build_object('triggeredAt',now()),updated_at=now(),updated_by=(select auth.uid())
    where effect.id=target_status_id returning * into result;
  elsif operation in ('EXTEND','SHORTEN') then
    if coalesce(payload->>'duration_delta','') !~ '^\d{1,4}$' then raise exception using errcode='22023',message='INVALID_DURATION_DELTA'; end if;
    duration_delta := greatest(1,(payload->>'duration_delta')::integer);
    update public.player_status_effects effect set
      remaining_duration=case when operation='EXTEND' then least(9999,coalesce(effect.remaining_duration,0)+duration_delta) else greatest(0,coalesce(effect.remaining_duration,0)-duration_delta) end,
      updated_at=now(),updated_by=(select auth.uid())
    where effect.id=target_status_id returning * into result;
  else
    requested_status_type := upper(btrim(coalesce(payload->>'status_type',existing.status_type)));
    requested_status_name := btrim(coalesce(payload->>'status_name',existing.status_name));
    requested_category := upper(btrim(coalesce(payload->>'status_category',existing.status_category)));
    requested_state := upper(btrim(coalesce(payload->>'state',existing.state)));
    requested_visibility := upper(btrim(coalesce(payload->>'visibility',existing.visibility)));
    if requested_status_type !~ '^[A-Z][A-Z0-9_]{1,63}$' or requested_status_name='' or char_length(requested_status_name)>120
      or requested_category not in ('HARMFUL','PROTECTION','PASSIVE','TEMPORARY','PERMANENT','CUSTOM')
      or requested_state not in ('ACTIVE','PENDING','RESOLVED','EXPIRED','CONSUMED') or requested_visibility not in ('GM_ONLY','OWNER_VISIBLE','FACTION_VISIBLE','PUBLIC')
      or char_length(coalesce(payload->>'description',existing.description))>4000 or char_length(coalesce(payload->>'duration',existing.duration,''))>200
    then raise exception using errcode='22023',message='INVALID_STATUS_FIELDS'; end if;
    if payload ? 'applied_at_cycle' and payload->>'applied_at_cycle' is not null and payload->>'applied_at_cycle' !~ '^\d{1,4}$'
      or payload ? 'expires_at_cycle' and payload->>'expires_at_cycle' is not null and payload->>'expires_at_cycle' !~ '^\d{1,4}$'
      or payload ? 'remaining_duration' and payload->>'remaining_duration' is not null and payload->>'remaining_duration' !~ '^\d{1,4}$'
      or payload ? 'stack_count' and payload->>'stack_count' is not null and payload->>'stack_count' !~ '^\d{1,3}$'
    then raise exception using errcode='22023',message='INVALID_STATUS_TIMING'; end if;
    if payload ? 'source_player_id' and nullif(payload->>'source_player_id','') is not null and not exists(
      select 1 from public.game_documents document_row cross join lateral jsonb_array_elements(document_row.document#>'{data,players}') player
      where document_row.game_id=target_game_id and player->>'id'=payload->>'source_player_id'
    ) then raise exception using errcode='23503',message='STATUS_SOURCE_PLAYER_NOT_FOUND'; end if;
    if payload ? 'source_role_id' and nullif(payload->>'source_role_id','') is not null and not exists(
      select 1 from public.game_documents document_row cross join lateral jsonb_array_elements(document_row.document#>'{data,roles}') role
      where document_row.game_id=target_game_id and role->>'id'=payload->>'source_role_id'
    ) then raise exception using errcode='23503',message='STATUS_SOURCE_ROLE_NOT_FOUND'; end if;
    if payload ? 'source_ability_id' and nullif(payload->>'source_ability_id','') is not null and not exists(
      select 1 from public.game_documents document_row cross join lateral jsonb_array_elements(document_row.document#>'{data,abilities}') ability
      where document_row.game_id=target_game_id and ability->>'id'=payload->>'source_ability_id'
    ) then raise exception using errcode='23503',message='STATUS_SOURCE_ABILITY_NOT_FOUND'; end if;
    update public.player_status_effects effect set
      status_type=requested_status_type,status_name=requested_status_name,status_category=requested_category,
      source_player_id=case when payload?'source_player_id' then nullif(payload->>'source_player_id','') else effect.source_player_id end,
      source_role_id=case when payload?'source_role_id' then nullif(payload->>'source_role_id','') else effect.source_role_id end,
      source_ability_id=case when payload?'source_ability_id' then nullif(payload->>'source_ability_id','') else effect.source_ability_id end,
      description=case when payload?'description' then coalesce(payload->>'description','') else effect.description end,
      applied_at_cycle=case when payload?'applied_at_cycle' then nullif(payload->>'applied_at_cycle','')::integer else effect.applied_at_cycle end,
      applied_at_phase=case when payload?'applied_at_phase' then nullif(payload->>'applied_at_phase','') else effect.applied_at_phase end,
      duration=case when payload?'duration' then nullif(payload->>'duration','') else effect.duration end,
      expires_at_cycle=case when payload?'expires_at_cycle' then nullif(payload->>'expires_at_cycle','')::integer else effect.expires_at_cycle end,
      expires_at_phase=case when payload?'expires_at_phase' then nullif(payload->>'expires_at_phase','') else effect.expires_at_phase end,
      remaining_duration=case when payload?'remaining_duration' then nullif(payload->>'remaining_duration','')::integer else effect.remaining_duration end,
      stack_count=case when payload?'stack_count' then greatest(1,nullif(payload->>'stack_count','')::integer) else effect.stack_count end,
      state=requested_state,visibility=requested_visibility,
      dispellable=case when payload?'dispellable' then (payload->>'dispellable')::boolean else effect.dispellable end,
      metadata=case when payload?'metadata' then payload->'metadata' else effect.metadata end,
      updated_at=now(),updated_by=(select auth.uid())
    where effect.id=target_status_id returning * into result;
  end if;
  return result;
end $$;

create or replace function public.apply_player_status_changes(target_game_id uuid,target_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare change jsonb; payload jsonb; result public.player_status_effects%rowtype; results jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if jsonb_typeof(target_changes)<>'array' or jsonb_array_length(target_changes) not between 1 and 50 then raise exception using errcode='22023',message='INVALID_STATUS_CHANGES'; end if;
  for change in select value from jsonb_array_elements(target_changes) loop
    if change->>'kind'='apply_status' then
      begin payload := case when jsonb_typeof(change->'value')='object' then change->'value' else (change->>'value')::jsonb end;
      exception when others then raise exception using errcode='22023',message='INVALID_STATUS_CHANGE_VALUE'; end;
      payload := payload||jsonb_build_object('player_id',change->>'target_id','reason',left(coalesce(change->>'reason','AI GM proposal approved.'),2000));
      result := public.mutate_player_status(target_game_id,null,'APPLY',payload);
    elsif change->>'kind'='resolve_status' then
      result := public.mutate_player_status(target_game_id,(change->>'target_id')::uuid,'RESOLVE',jsonb_build_object('reason',left(coalesce(change->>'reason','AI GM proposal approved.'),2000)));
    else raise exception using errcode='22023',message='UNSUPPORTED_STATUS_CHANGE';
    end if;
    results := results||jsonb_build_array(to_jsonb(result));
  end loop;
  return results;
end $$;

create or replace function public.get_active_effects(target_game_id uuid)
returns setof public.player_status_effects language sql stable security invoker set search_path = ''
as $$select effect.* from public.player_status_effects effect where effect.game_id=target_game_id and effect.state='ACTIVE' order by effect.player_id,effect.created_at$$;
create or replace function public.get_pending_effects(target_game_id uuid)
returns setof public.player_status_effects language sql stable security invoker set search_path = ''
as $$select effect.* from public.player_status_effects effect where effect.game_id=target_game_id and effect.state='PENDING' order by effect.player_id,effect.created_at$$;
create or replace function public.get_player_statuses(target_game_id uuid,target_player_id text)
returns setof public.player_status_effects language sql stable security invoker set search_path = ''
as $$select effect.* from public.player_status_effects effect where effect.game_id=target_game_id and effect.player_id=target_player_id order by effect.created_at desc$$;
create or replace function public.get_players_by_status(target_game_id uuid,target_status_type text)
returns setof public.player_status_effects language sql stable security invoker set search_path = ''
as $$select effect.* from public.player_status_effects effect where effect.game_id=target_game_id and effect.status_type=upper(target_status_type) and effect.state='ACTIVE' order by effect.player_id,effect.created_at$$;
create or replace function public.get_player_status_history(target_game_id uuid,target_player_id text default null,max_rows integer default 100)
returns setof public.player_status_history language sql stable security invoker set search_path = ''
as $$select history.* from public.player_status_history history where history.game_id=target_game_id and (target_player_id is null or history.player_id=target_player_id) order by history.created_at desc limit least(greatest(coalesce(max_rows,100),1),250)$$;

create or replace function public.get_player_state(target_game_id uuid,target_player_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare game_document jsonb; player jsonb; role jsonb; faction jsonb; effects jsonb; gm_access boolean;
begin
  if not public.is_game_member(target_game_id) then raise exception using errcode='42501',message='GAME_ACCESS_REQUIRED'; end if;
  select document into game_document from public.game_documents where game_id=target_game_id;
  select value into player from jsonb_array_elements(game_document#>'{data,players}') where value->>'id'=target_player_id limit 1;
  if player is null then raise exception using errcode='P0002',message='PLAYER_NOT_FOUND'; end if;
  gm_access := public.can_edit_game(target_game_id);
  select value into role from jsonb_array_elements(game_document#>'{data,roles}') where value->>'id'=coalesce(nullif(player->>'currentRoleId',''),player->>'roleId') limit 1;
  select value into faction from jsonb_array_elements(game_document#>'{data,factions}') where value->>'id'=coalesce(nullif(player->>'currentFactionId',''),nullif(player->>'factionId',''),role->>'factionId') limit 1;
  select coalesce(jsonb_agg(to_jsonb(effect) order by effect.created_at),'[]'::jsonb) into effects from public.player_status_effects effect where effect.game_id=target_game_id and effect.player_id=target_player_id;
  return jsonb_build_object(
    'authority','LIVE_GAME_DATABASE','playerId',target_player_id,'playerName',player->>'name','aliveStatus',case when coalesce((player->>'alive')::boolean,false) then 'ALIVE' else 'DEAD' end,
    'currentRole',case when gm_access then jsonb_build_object('id',role->>'id','name',role->>'name') else null end,
    'currentFaction',case when gm_access then jsonb_build_object('id',faction->>'id','name',faction->>'name','class',faction->>'class') else null end,
    'abilitiesOwned',case when gm_access then coalesce(role->'tags','[]'::jsonb) else '[]'::jsonb end,
    'activeEffects',(select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_category' not in ('PASSIVE','PERMANENT')),
    'passiveEffects',(select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_category'='PASSIVE'),
    'pendingEffects',(select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(effects) item where item->>'state'='PENDING'),
    'permanentStateChanges',(select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_category'='PERMANENT'),
    'resolvedEffects',(select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(effects) item where item->>'state' in ('RESOLVED','EXPIRED','CONSUMED')),
    'statusSummary',jsonb_build_object(
      'blocked',exists(select 1 from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_type'='ROLEBLOCK'),
      'marked',exists(select 1 from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_type'='MARK'),
      'poisoned',exists(select 1 from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_type'='POISON'),
      'protected',exists(select 1 from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_type'='PROTECT'),
      'superProtected',exists(select 1 from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_type'='SUPER_PROTECT'),
      'deathImmune',exists(select 1 from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_type' in ('DEATH_IMMUNITY','BULLETPROOF')),
      'guarded',exists(select 1 from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_type'='GUARDED'),
      'redirected',exists(select 1 from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_type'='REDIRECT'),
      'converted',exists(select 1 from jsonb_array_elements(effects) item where item->>'state'='ACTIVE' and item->>'status_type'='CONVERTED')
    )
  );
end $$;

revoke all on function public.mutate_player_status(uuid,uuid,text,jsonb) from public,anon;
revoke all on function public.apply_player_status_changes(uuid,jsonb) from public,anon;
revoke all on function public.get_active_effects(uuid) from public,anon;
revoke all on function public.get_pending_effects(uuid) from public,anon;
revoke all on function public.get_player_statuses(uuid,text) from public,anon;
revoke all on function public.get_players_by_status(uuid,text) from public,anon;
revoke all on function public.get_player_status_history(uuid,text,integer) from public,anon;
revoke all on function public.get_player_state(uuid,text) from public,anon;
grant execute on function public.mutate_player_status(uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.apply_player_status_changes(uuid,jsonb) to authenticated;
grant execute on function public.get_active_effects(uuid) to authenticated;
grant execute on function public.get_pending_effects(uuid) to authenticated;
grant execute on function public.get_player_statuses(uuid,text) to authenticated;
grant execute on function public.get_players_by_status(uuid,text) to authenticated;
grant execute on function public.get_player_status_history(uuid,text,integer) to authenticated;
grant execute on function public.get_player_state(uuid,text) to authenticated;

do $$ begin alter publication supabase_realtime add table public.player_status_effects; exception when duplicate_object then null; end $$;

-- Keep the standardized abilities but remove the retired Courtroom source label from the live UI.
update public.official_documents set title='Standard Ability Encyclopedia',updated_at=now()
where title=concat('Courtroom ',chr(8212),' Master Ability Encyclopedia');
update public.standard_ability_datasets set name='Standard Ability Encyclopedia'
where name=concat('Courtroom ',chr(8212),' Master Ability Encyclopedia');
update public.official_document_chunks set source_locator='Standard Ability Encyclopedia'
where source_locator=concat('Courtroom ',chr(8212),' Master Ability Encyclopedia');
