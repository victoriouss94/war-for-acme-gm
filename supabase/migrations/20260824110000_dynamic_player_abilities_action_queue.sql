-- Extend the existing game-document Action Queue with player-specific ability grants.
-- Ability definitions remain in the existing game document / standardized encyclopedia.

create table public.player_ability_grants (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id text not null check (char_length(btrim(player_id)) between 1 and 100),
  ability_id text not null check (char_length(btrim(ability_id)) between 1 and 120),
  source_type text not null check (source_type in ('ROLE','FACTION','GM_GRANT','TEMPORARY_GRANT','PERMANENT_GRANT','MINIGAME_REWARD','EVENT_REWARD','STOLEN','COPIED','STATUS_EFFECT','ITEM','SPECIAL_MECHANIC','OTHER')),
  source_reference text not null default '' check (char_length(source_reference)<=300),
  reason text not null check (char_length(btrim(reason)) between 3 and 4000),
  uses_granted integer check (uses_granted is null or uses_granted between 1 and 999),
  uses_remaining integer check (uses_remaining is null or uses_remaining between 0 and 999),
  duration_type text not null default 'UNTIL_REMOVED' check (duration_type in ('ONE_USE','LIMITED_USES','UNTIL_USED','UNTIL_END_OF_PHASE','UNTIL_END_OF_DAY','UNTIL_END_OF_NIGHT','UNTIL_END_OF_CYCLE','UNTIL_SPECIFIC_CYCLE','UNTIL_REMOVED','PERMANENT_FOR_GAME')),
  granted_cycle integer check (granted_cycle is null or granted_cycle between 0 and 9999),
  granted_phase text not null default '' check (granted_phase in ('','Day','Night','Any','Immediate')),
  expires_at timestamptz,
  expires_cycle integer check (expires_cycle is null or expires_cycle between 0 and 9999),
  expires_phase text not null default '' check (expires_phase in ('','Day','Night','Any','Immediate')),
  phase_restrictions text[] not null default '{}',
  special_conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(special_conditions)='object' and octet_length(special_conditions::text)<=20000),
  survives_conversion boolean,
  stealable boolean not null default true,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CONSUMED','EXPIRED','REVOKED','SUPERSEDED')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=20000),
  version integer not null default 1 check (version>0),
  granted_by uuid not null references auth.users(id),
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((uses_granted is null and uses_remaining is null) or (uses_granted is not null and uses_remaining is not null and uses_remaining<=uses_granted)),
  check (duration_type not in ('ONE_USE','LIMITED_USES','UNTIL_USED') or uses_granted is not null)
);

create table public.player_ability_grant_events (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  grant_id uuid not null references public.player_ability_grants(id) on delete cascade,
  player_id text not null check (char_length(btrim(player_id)) between 1 and 100),
  ability_id text not null check (char_length(btrim(ability_id)) between 1 and 120),
  event_type text not null check (event_type in ('GRANTED','CONSUMED','EXPIRED','REVOKED','USES_CHANGED','SUPERSEDED')),
  previous_state jsonb,
  new_state jsonb,
  reason text not null default '' check (char_length(reason)<=4000),
  resolution_session_id uuid references public.resolution_sessions(id) on delete set null,
  action_id text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index player_ability_grants_game_player_status_idx on public.player_ability_grants(game_id,player_id,status);
create index player_ability_grants_game_ability_status_idx on public.player_ability_grants(game_id,ability_id,status);
create index player_ability_grants_granted_by_idx on public.player_ability_grants(granted_by);
create index player_ability_grants_revoked_by_idx on public.player_ability_grants(revoked_by) where revoked_by is not null;
create index player_ability_grant_events_game_created_idx on public.player_ability_grant_events(game_id,created_at desc);
create index player_ability_grant_events_grant_idx on public.player_ability_grant_events(grant_id,created_at desc);
create index player_ability_grant_events_resolution_idx on public.player_ability_grant_events(resolution_session_id) where resolution_session_id is not null;
create index player_ability_grant_events_actor_idx on public.player_ability_grant_events(actor_user_id) where actor_user_id is not null;

alter table public.player_ability_grants enable row level security;
alter table public.player_ability_grant_events enable row level security;
create policy player_ability_grants_gm_read on public.player_ability_grants for select to authenticated using (public.can_edit_game(game_id));
create policy player_ability_grant_events_gm_read on public.player_ability_grant_events for select to authenticated using (public.can_edit_game(game_id));
revoke all on table public.player_ability_grants,public.player_ability_grant_events from public,anon,authenticated;
grant select on table public.player_ability_grants,public.player_ability_grant_events to authenticated;

create or replace function private.player_ability_document_records(target_game_id uuid,target_player_id text,target_ability_id text)
returns table(document jsonb,document_version integer,player jsonb,role jsonb,ability jsonb)
language sql stable security definer set search_path='' as $$
  select stored.document,stored.version,player_record.value,role_record.value,ability_record.value
  from public.game_documents stored
  cross join lateral (select value from jsonb_array_elements(stored.document#>'{data,players}') where value->>'id'=target_player_id limit 1) player_record
  left join lateral (select value from jsonb_array_elements(stored.document#>'{data,roles}') where value->>'id'=player_record.value->>'roleId' limit 1) role_record on true
  cross join lateral (select value from jsonb_array_elements(stored.document#>'{data,abilities}') where value->>'id'=target_ability_id limit 1) ability_record
  where stored.game_id=target_game_id
$$;

create or replace function private.role_owns_ability(role_record jsonb,ability_record jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(role_record->>'roleType','STANDARD')<>'BASIC' and (
    nullif(role_record->>'activeAbilityId','')=ability_record->>'id'
    or nullif(role_record->>'passiveAbilityId','')=ability_record->>'id'
    or exists(select 1 from jsonb_array_elements_text(coalesce(role_record->'tags','[]'::jsonb)) tag where lower(regexp_replace(btrim(tag),'[^a-z0-9]+','','g'))=lower(regexp_replace(btrim(ability_record->>'name'),'[^a-z0-9]+','','g')))
  )
$$;

create or replace function private.grant_is_current(grant_record public.player_ability_grants,current_cycle integer,current_phase text)
returns boolean language sql stable set search_path='' as $$
  select grant_record.status='ACTIVE'
    and coalesce(grant_record.uses_remaining,1)>0
    and (grant_record.expires_at is null or grant_record.expires_at>now())
    and (grant_record.expires_cycle is null or current_cycle<=grant_record.expires_cycle)
    and not (grant_record.duration_type='UNTIL_END_OF_PHASE' and (current_cycle>coalesce(grant_record.granted_cycle,current_cycle) or (current_cycle=coalesce(grant_record.granted_cycle,current_cycle) and current_phase is distinct from grant_record.granted_phase)))
    and not (grant_record.duration_type='UNTIL_END_OF_DAY' and (current_cycle>coalesce(grant_record.granted_cycle,current_cycle) or (current_cycle=coalesce(grant_record.granted_cycle,current_cycle) and grant_record.granted_phase='Day' and current_phase='Night')))
    and not (grant_record.duration_type in ('UNTIL_END_OF_NIGHT','UNTIL_END_OF_CYCLE') and current_cycle>coalesce(grant_record.granted_cycle,current_cycle))
$$;

create or replace function private.grant_player_ability(
  target_game_id uuid,expected_game_version integer,target_player_id text,target_ability_id text,target_source_type text,
  target_source_reference text,target_reason text,target_uses integer,target_duration_type text,target_expires_at timestamptz,
  target_expires_cycle integer,target_expires_phase text,target_phase_restrictions text[],target_special_conditions jsonb,
  target_survives_conversion boolean,target_stealable boolean,target_metadata jsonb
) returns public.player_ability_grants
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());records record;source_value text:=upper(btrim(coalesce(target_source_type,'GM_GRANT')));duration_value text:=upper(btrim(coalesce(target_duration_type,'UNTIL_REMOVED')));result public.player_ability_grants%rowtype;current_cycle integer;current_phase text;uses_value integer:=target_uses;
begin
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select * into records from private.player_ability_document_records(target_game_id,target_player_id,target_ability_id);
  if not found then raise exception using errcode='23503',message='PLAYER_OR_ABILITY_NOT_FOUND'; end if;
  if records.document_version<>expected_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  if source_value not in ('GM_GRANT','TEMPORARY_GRANT','PERMANENT_GRANT','MINIGAME_REWARD','EVENT_REWARD','STOLEN','COPIED','STATUS_EFFECT','ITEM','SPECIAL_MECHANIC','OTHER') then raise exception using errcode='22023',message='INVALID_GRANT_SOURCE'; end if;
  if duration_value not in ('ONE_USE','LIMITED_USES','UNTIL_USED','UNTIL_END_OF_PHASE','UNTIL_END_OF_DAY','UNTIL_END_OF_NIGHT','UNTIL_END_OF_CYCLE','UNTIL_SPECIFIC_CYCLE','UNTIL_REMOVED','PERMANENT_FOR_GAME') then raise exception using errcode='22023',message='INVALID_GRANT_DURATION'; end if;
  if char_length(btrim(coalesce(target_reason,''))) not between 3 and 4000 then raise exception using errcode='22023',message='GRANT_REASON_REQUIRED'; end if;
  if duration_value='ONE_USE' then uses_value:=1; end if;
  if duration_value in ('ONE_USE','LIMITED_USES','UNTIL_USED') and (uses_value is null or uses_value not between 1 and 999) then raise exception using errcode='22023',message='GRANT_USES_REQUIRED'; end if;
  if uses_value is not null and uses_value not between 1 and 999 then raise exception using errcode='22023',message='INVALID_GRANT_USES'; end if;
  current_cycle:=greatest(0,coalesce(nullif(records.document#>>'{game,currentDay}','')::integer,0));current_phase:=coalesce(records.document#>>'{game,currentPhase}','Any');
  if duration_value in ('UNTIL_END_OF_PHASE','UNTIL_END_OF_DAY','UNTIL_END_OF_NIGHT','UNTIL_END_OF_CYCLE') and target_expires_cycle is null then target_expires_cycle:=current_cycle; end if;
  if duration_value='UNTIL_END_OF_PHASE' and coalesce(target_expires_phase,'')='' then target_expires_phase:=current_phase; end if;
  if duration_value='UNTIL_SPECIFIC_CYCLE' and target_expires_cycle is null then raise exception using errcode='22023',message='GRANT_EXPIRATION_CYCLE_REQUIRED'; end if;
  if target_expires_at is not null and target_expires_at<=now() then raise exception using errcode='22023',message='GRANT_EXPIRATION_MUST_BE_FUTURE'; end if;
  insert into public.player_ability_grants(game_id,player_id,ability_id,source_type,source_reference,reason,uses_granted,uses_remaining,duration_type,granted_cycle,granted_phase,expires_at,expires_cycle,expires_phase,phase_restrictions,special_conditions,survives_conversion,stealable,metadata,granted_by)
  values(target_game_id,target_player_id,target_ability_id,source_value,left(coalesce(target_source_reference,''),300),btrim(target_reason),uses_value,uses_value,duration_value,current_cycle,current_phase,target_expires_at,target_expires_cycle,coalesce(target_expires_phase,''),coalesce(target_phase_restrictions,'{}'),coalesce(target_special_conditions,'{}'::jsonb),target_survives_conversion,coalesce(target_stealable,true),coalesce(target_metadata,'{}'::jsonb),actor)
  returning * into result;
  insert into public.player_ability_grant_events(game_id,grant_id,player_id,ability_id,event_type,new_state,reason,actor_user_id) values(target_game_id,result.id,result.player_id,result.ability_id,'GRANTED',to_jsonb(result),result.reason,actor);
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(target_game_id,actor,'player_ability_grant',result.id::text,'Ability granted to player',jsonb_build_object('playerId',result.player_id,'abilityId',result.ability_id,'sourceType',result.source_type,'uses',result.uses_granted,'duration',result.duration_type,'reason',result.reason));
  return result;
end$$;

create or replace function public.grant_player_ability(
  target_game_id uuid,expected_game_version integer,target_player_id text,target_ability_id text,target_source_type text default 'GM_GRANT',
  target_source_reference text default '',target_reason text default '',target_uses integer default null,target_duration_type text default 'UNTIL_REMOVED',target_expires_at timestamptz default null,
  target_expires_cycle integer default null,target_expires_phase text default '',target_phase_restrictions text[] default '{}',target_special_conditions jsonb default '{}'::jsonb,
  target_survives_conversion boolean default null,target_stealable boolean default true,target_metadata jsonb default '{}'::jsonb
) returns public.player_ability_grants language sql security definer set search_path='' as $$
  select private.grant_player_ability(target_game_id,expected_game_version,target_player_id,target_ability_id,target_source_type,target_source_reference,target_reason,target_uses,target_duration_type,target_expires_at,target_expires_cycle,target_expires_phase,target_phase_restrictions,target_special_conditions,target_survives_conversion,target_stealable,target_metadata)
$$;

create or replace function public.bulk_grant_player_abilities(target_game_id uuid,expected_game_version integer,target_grants jsonb)
returns setof public.player_ability_grants language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
  if jsonb_typeof(target_grants)<>'array' or jsonb_array_length(target_grants) not between 1 and 100 then raise exception using errcode='22023',message='INVALID_BULK_GRANTS'; end if;
  for item in select value from jsonb_array_elements(target_grants) loop
    return next private.grant_player_ability(target_game_id,expected_game_version,item->>'playerId',item->>'abilityId',coalesce(item->>'sourceType','GM_GRANT'),coalesce(item->>'sourceReference',''),coalesce(item->>'reason',''),nullif(item->>'uses','')::integer,coalesce(item->>'durationType','UNTIL_REMOVED'),nullif(item->>'expiresAt','')::timestamptz,nullif(item->>'expiresCycle','')::integer,coalesce(item->>'expiresPhase',''),coalesce(array(select jsonb_array_elements_text(coalesce(item->'phaseRestrictions','[]'::jsonb))),'{}'),coalesce(item->'specialConditions','{}'::jsonb),nullif(item->>'survivesConversion','')::boolean,coalesce((item->>'stealable')::boolean,true),coalesce(item->'metadata','{}'::jsonb));
  end loop;
end$$;

create or replace function public.grant_random_player_ability(target_game_id uuid,expected_game_version integer,target_player_id text,target_ability_pool jsonb,target_source_reference text,target_reason text,target_uses integer default 1,target_duration_type text default 'UNTIL_USED')
returns public.player_ability_grants language plpgsql security definer set search_path='' as $$
declare selected_ability text;
begin
  if jsonb_typeof(target_ability_pool)<>'array' or jsonb_array_length(target_ability_pool) not between 1 and 100 then raise exception using errcode='22023',message='INVALID_REWARD_POOL'; end if;
  select value into selected_ability from (select distinct value from jsonb_array_elements_text(target_ability_pool)) pool order by gen_random_uuid() limit 1;
  return private.grant_player_ability(target_game_id,expected_game_version,target_player_id,selected_ability,'MINIGAME_REWARD',target_source_reference,target_reason,target_uses,target_duration_type,null,null,'','{}'::text[],'{}'::jsonb,null,true,jsonb_build_object('randomPool',target_ability_pool));
end$$;

create or replace function private.mutate_player_ability_grant(target_grant_id uuid,expected_version integer,target_operation text,target_reason text,target_uses_remaining integer default null)
returns public.player_ability_grants language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());current_row public.player_ability_grants%rowtype;result public.player_ability_grants%rowtype;operation text:=upper(btrim(coalesce(target_operation,'')));event_value text;
begin
  select * into current_row from public.player_ability_grants where id=target_grant_id for update;
  if not found then raise exception using errcode='P0002',message='GRANT_NOT_FOUND'; end if;
  if actor is null or not public.can_edit_game(current_row.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if current_row.version<>expected_version then raise exception using errcode='40001',message='GRANT_VERSION_CONFLICT'; end if;
  if char_length(btrim(coalesce(target_reason,''))) not between 3 and 4000 then raise exception using errcode='22023',message='GRANT_REASON_REQUIRED'; end if;
  if operation='REVOKE' then event_value:='REVOKED';update public.player_ability_grants set status='REVOKED',revoked_by=actor,revoked_at=now(),version=version+1,updated_at=now() where id=target_grant_id returning * into result;
  elsif operation='EXPIRE' then event_value:='EXPIRED';update public.player_ability_grants set status='EXPIRED',version=version+1,updated_at=now() where id=target_grant_id returning * into result;
  elsif operation='SET_USES' then
    if current_row.uses_granted is null or target_uses_remaining is null or target_uses_remaining not between 0 and current_row.uses_granted then raise exception using errcode='22023',message='INVALID_REMAINING_USES'; end if;
    event_value:='USES_CHANGED';update public.player_ability_grants set uses_remaining=target_uses_remaining,status=case when target_uses_remaining=0 then 'CONSUMED' else 'ACTIVE' end,version=version+1,updated_at=now() where id=target_grant_id returning * into result;
  else raise exception using errcode='22023',message='INVALID_GRANT_OPERATION'; end if;
  insert into public.player_ability_grant_events(game_id,grant_id,player_id,ability_id,event_type,previous_state,new_state,reason,actor_user_id) values(result.game_id,result.id,result.player_id,result.ability_id,event_value,to_jsonb(current_row),to_jsonb(result),btrim(target_reason),actor);
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(result.game_id,actor,'player_ability_grant',result.id::text,'Player ability grant '||lower(event_value),to_jsonb(current_row),to_jsonb(result));
  return result;
end$$;

create or replace function public.mutate_player_ability_grant(target_grant_id uuid,expected_version integer,target_operation text,target_reason text,target_uses_remaining integer default null)
returns public.player_ability_grants language sql security definer set search_path='' as $$select private.mutate_player_ability_grant(target_grant_id,expected_version,target_operation,target_reason,target_uses_remaining)$$;

create or replace function private.queue_player_action(target_game_id uuid,expected_game_version integer,target_action jsonb,target_replace_action_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());stored public.game_documents%rowtype;player_record jsonb;role_record jsonb;ability_record jsonb;effective_ability_record jsonb;grant_record public.player_ability_grants%rowtype;action_value jsonb;actions jsonb;source_type text;player_id text;ability_id text;effective_ability_id text;grant_id uuid;current_cycle integer;current_phase text;target_type text;target_ids text[];target_id text;target_record jsonb;override_reason text;ownership boolean:=false;uses_before integer;queued_count integer:=0;role_limit integer;role_consumed integer:=0;cooldown_cycles integer:=0;last_consumed_cycle integer;actor_faction_id text;target_faction_id text;warnings jsonb:='[]'::jsonb;saved record;
begin
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if jsonb_typeof(target_action)<>'object' or octet_length(target_action::text)>50000 then raise exception using errcode='22023',message='INVALID_ACTION'; end if;
  select * into stored from public.game_documents where game_id=target_game_id for update;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  if stored.version<>expected_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  source_type:=upper(coalesce(target_action->>'sourceType','PLAYER'));player_id:=coalesce(target_action->>'sourcePlayerId',target_action->>'actorId','');ability_id:=coalesce(target_action->>'abilityId','');effective_ability_id:=coalesce(nullif(target_action->>'effectiveAbilityId',''),ability_id);override_reason:=btrim(coalesce(target_action->>'overrideReason',''));
  if source_type not in ('PLAYER','FACTION','GM_MANUAL','SYSTEM') then raise exception using errcode='22023',message='INVALID_ACTION_SOURCE'; end if;
  if source_type='FACTION' and not exists(select 1 from jsonb_array_elements(stored.document#>'{data,factions}') faction where faction->>'id'=(target_action->>'sourceFactionId')) then raise exception using errcode='23503',message='SOURCE_FACTION_NOT_FOUND'; end if;
  select value into ability_record from jsonb_array_elements(stored.document#>'{data,abilities}') where value->>'id'=ability_id limit 1;
  if ability_record is null then raise exception using errcode='23503',message='ABILITY_NOT_FOUND'; end if;
  select value into effective_ability_record from jsonb_array_elements(stored.document#>'{data,abilities}') where value->>'id'=effective_ability_id limit 1;
  if effective_ability_record is null then raise exception using errcode='23503',message='EFFECTIVE_ABILITY_NOT_FOUND'; end if;
  current_cycle:=greatest(0,coalesce(nullif(stored.document#>>'{game,currentDay}','')::integer,0));current_phase:=coalesce(stored.document#>>'{game,currentPhase}','Any');
  if source_type='PLAYER' then
    select value into player_record from jsonb_array_elements(stored.document#>'{data,players}') where value->>'id'=player_id limit 1;
    if player_record is null then raise exception using errcode='23503',message='PLAYER_NOT_FOUND'; end if;
    select value into role_record from jsonb_array_elements(stored.document#>'{data,roles}') where value->>'id'=player_record->>'roleId' limit 1;
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
    if coalesce(ability_record->>'phase','Any')='Passive' and coalesce(nullif(ability_record#>>'{targeting,manuallyTriggerable}','')::boolean,false)=false and override_reason='' then raise exception using errcode='22023',message='PASSIVE_NOT_MANUALLY_SELECTABLE'; end if;
    if coalesce(ability_record->>'phase','Any') not in ('Any','Passive',current_phase) and override_reason='' then raise exception using errcode='22023',message='ABILITY_WRONG_PHASE'; end if;
    cooldown_cycles:=greatest(0,coalesce(nullif(ability_record->>'cooldownCycles','')::integer,0));
    if cooldown_cycles>0 then select max(session.cycle) into last_consumed_cycle from public.resolution_session_events event join public.resolution_sessions session on session.id=event.session_id where event.game_id=target_game_id and event.actor_player_id=player_id and event.ability_id=ability_id and event.event_type='ABILITY_CONSUMED';if last_consumed_cycle is not null and current_cycle<last_consumed_cycle+cooldown_cycles and override_reason='' then raise exception using errcode='22023',message='ABILITY_ON_COOLDOWN'; end if;end if;
    select coalesce(jsonb_agg(status_name),'[]'::jsonb) into warnings from (select effect.status_name from public.player_status_effects effect where effect.game_id=target_game_id and effect.player_id=player_id and effect.state='ACTIVE' and effect.status_type in ('ROLEBLOCK','MARK','POISON','DRUNK','SILENCED','ACTION_SUCCESS_GUARANTEE','ABILITY_AMPLIFY','ADDITIONAL_USES') order by effect.created_at) current_warnings;
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
    if target_type='SELF' and target_id<>player_id then raise exception using errcode='22023',message='SELF_TARGET_REQUIRED'; end if;
    if target_type='DEAD_PLAYER' and coalesce(nullif(target_record->>'alive','')::boolean,true) then raise exception using errcode='22023',message='DEAD_TARGET_REQUIRED'; end if;
    if coalesce(nullif(ability_record#>>'{targeting,deadOnly}','')::boolean,false) and coalesce(nullif(target_record->>'alive','')::boolean,true) then raise exception using errcode='22023',message='DEAD_TARGET_REQUIRED'; end if;
    if coalesce(nullif(ability_record#>>'{targeting,livingOnly}','')::boolean,false) and not coalesce(nullif(target_record->>'alive','')::boolean,true) then raise exception using errcode='22023',message='LIVING_TARGET_REQUIRED'; end if;
    if (coalesce(nullif(ability_record#>>'{targeting,selfProhibited}','')::boolean,false) or coalesce(nullif(ability_record#>>'{targeting,selfAllowed}','')::boolean,true)=false) and target_id=player_id then raise exception using errcode='22023',message='SELF_TARGET_PROHIBITED'; end if;
    actor_faction_id:=coalesce(nullif(player_record->>'currentFactionId',''),nullif(player_record->>'factionId',''),nullif(role_record->>'factionId',''));target_faction_id:=coalesce(nullif(target_record->>'currentFactionId',''),nullif(target_record->>'factionId',''),(select value->>'factionId' from jsonb_array_elements(stored.document#>'{data,roles}') where value->>'id'=target_record->>'roleId' limit 1));
    if coalesce(nullif(ability_record#>>'{targeting,factionMemberOnly}','')::boolean,false) and target_faction_id is distinct from actor_faction_id then raise exception using errcode='22023',message='FACTION_MEMBER_TARGET_REQUIRED'; end if;
    if coalesce(nullif(ability_record#>>'{targeting,nonFactionMemberOnly}','')::boolean,false) and target_faction_id is not distinct from actor_faction_id then raise exception using errcode='22023',message='NON_FACTION_TARGET_REQUIRED'; end if;
  end loop;
  action_value:=jsonb_strip_nulls(jsonb_build_object('id',coalesce(nullif(target_action->>'id',''),gen_random_uuid()::text),'gameId',target_game_id::text,'cycle',current_cycle,'phase',current_phase,'sourceType',source_type,'actorId',nullif(player_id,''),'sourcePlayerId',nullif(player_id,''),'sourceFactionId',nullif(target_action->>'sourceFactionId',''),'roleId',nullif(player_record->>'roleId',''),'abilityId',ability_id,'playerAbilityGrantId',case when grant_id is null then null else grant_id::text end,'grantVersion',case when grant_id is null then null else grant_record.version end,'abilitySource',coalesce(nullif(target_action->>'abilitySource',''),case when grant_id is null then case when source_type='PLAYER' then 'ROLE' else source_type end else grant_record.source_type end),'baseAbilityId',ability_id,'effectiveAbilityId',effective_ability_id,'name',coalesce(effective_ability_record->>'name',ability_record->>'name'),'category',coalesce(effective_ability_record->>'category',ability_record->>'category','Other'),'targetType',target_type,'targetId',target_ids[1],'targetIds',to_jsonb(target_ids),'parameters',coalesce(target_action->'parameters','{}'::jsonb),'submittedBy',actor,'submittedAt',now(),'validationState',case when override_reason='' then 'VALID' else 'GM_OVERRIDE' end,'status','ATTEMPTED','usesBefore',uses_before,'activeWarnings',warnings,'gmOverride',override_reason<>'','overrideReason',nullif(override_reason,'')));
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

create or replace function public.queue_player_action(target_game_id uuid,expected_game_version integer,target_action jsonb,target_replace_action_id text default null)
returns jsonb language sql security definer set search_path='' as $$select private.queue_player_action(target_game_id,expected_game_version,target_action,target_replace_action_id)$$;

create or replace function private.remove_queued_action(target_game_id uuid,expected_game_version integer,target_action_id text,target_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());stored public.game_documents%rowtype;actions jsonb;removed jsonb;saved record;
begin
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if char_length(btrim(coalesce(target_reason,'')))<3 then raise exception using errcode='22023',message='ACTION_REMOVAL_REASON_REQUIRED'; end if;
  select * into stored from public.game_documents where game_id=target_game_id for update;if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;if stored.version<>expected_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  select value into removed from jsonb_array_elements(stored.document#>'{data,actions}') where value->>'id'=target_action_id limit 1;if removed is null then raise exception using errcode='P0002',message='ACTION_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into actions from jsonb_array_elements(stored.document#>'{data,actions}') with ordinality queued(value,ordinality) where value->>'id'<>target_action_id;
  select * into saved from public.save_game_document(target_game_id,stored.version,jsonb_set(stored.document,'{data,actions}',actions,false),'Queued action removed: '||left(btrim(target_reason),90),'action',target_action_id) limit 1;
  return jsonb_build_object('removed',removed,'document',saved.document,'version',saved.version,'updated_at',saved.updated_at,'updated_by',saved.updated_by);
end$$;

create or replace function public.remove_queued_action(target_game_id uuid,expected_game_version integer,target_action_id text,target_reason text)
returns jsonb language sql security definer set search_path='' as $$select private.remove_queued_action(target_game_id,expected_game_version,target_action_id,target_reason)$$;

create or replace function private.finalize_resolution_with_grants(target_session_id uuid,expected_lock_version integer,target_decision text,target_manual_resolution jsonb,target_gm_explanation text,target_teach_ai boolean,target_teach_scope text,target_consumed_action_ids text[])
returns public.resolution_sessions language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());session_before public.resolution_sessions%rowtype;result public.resolution_sessions%rowtype;grant_group record;grant_row public.player_ability_grants%rowtype;previous jsonb;next_uses integer;
begin
  select * into session_before from public.resolution_sessions where id=target_session_id;
  if not found then raise exception using errcode='P0002',message='RESOLUTION_SESSION_NOT_FOUND'; end if;
  if actor is null or not public.can_edit_game(session_before.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if upper(btrim(coalesce(target_decision,'')))='REJECT' and cardinality(coalesce(target_consumed_action_ids,'{}'))>0 then raise exception using errcode='22023',message='REJECTED_RESOLUTION_CANNOT_CONSUME_GRANTS'; end if;
  if cardinality(coalesce(target_consumed_action_ids,'{}'))>1000 then raise exception using errcode='22023',message='TOO_MANY_CONSUMPTIONS'; end if;
  if exists(select 1 from unnest(coalesce(target_consumed_action_ids,'{}')) requested where not exists(select 1 from jsonb_array_elements(session_before.submitted_actions) action where action->>'id'=requested and nullif(action->>'playerAbilityGrantId','') is not null)) then raise exception using errcode='22023',message='INVALID_GRANT_CONSUMPTION_ACTION'; end if;
  result:=private.finalize_resolution_session(target_session_id,expected_lock_version,target_decision,target_manual_resolution,target_gm_explanation,target_teach_ai,target_teach_scope);
  for grant_group in
    select (action->>'playerAbilityGrantId')::uuid grant_id,count(*)::integer uses_count,min((action->>'grantVersion')::integer) grant_version,array_agg(action->>'id') action_ids
    from jsonb_array_elements(session_before.submitted_actions) action where action->>'id'=any(coalesce(target_consumed_action_ids,'{}')) group by action->>'playerAbilityGrantId'
  loop
    select * into grant_row from public.player_ability_grants where id=grant_group.grant_id for update;
    if not found or grant_row.game_id<>session_before.game_id or grant_row.status<>'ACTIVE' then raise exception using errcode='40001',message='GRANT_CONSUMPTION_CONFLICT'; end if;
    if grant_row.version<>grant_group.grant_version then raise exception using errcode='40001',message='GRANT_VERSION_CONFLICT'; end if;
    if grant_row.uses_remaining is null then continue; end if;
    if grant_row.uses_remaining<grant_group.uses_count then raise exception using errcode='22023',message='NOT_ENOUGH_GRANT_USES'; end if;
    previous:=to_jsonb(grant_row);next_uses:=grant_row.uses_remaining-grant_group.uses_count;
    update public.player_ability_grants set uses_remaining=next_uses,status=case when next_uses=0 then 'CONSUMED' else 'ACTIVE' end,version=version+1,updated_at=now() where id=grant_row.id returning * into grant_row;
    insert into public.player_ability_grant_events(game_id,grant_id,player_id,ability_id,event_type,previous_state,new_state,reason,resolution_session_id,action_id,actor_user_id) values(grant_row.game_id,grant_row.id,grant_row.player_id,grant_row.ability_id,'CONSUMED',previous,to_jsonb(grant_row),'Consumed by approved Resolution Session',target_session_id,array_to_string(grant_group.action_ids,','),actor);
    insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(grant_row.game_id,actor,'player_ability_grant',grant_row.id::text,'Granted ability use consumed by resolution',previous,to_jsonb(grant_row));
  end loop;
  return result;
end$$;

create or replace function public.finalize_resolution_with_grants(target_session_id uuid,expected_lock_version integer,target_decision text,target_manual_resolution jsonb,target_gm_explanation text,target_teach_ai boolean,target_teach_scope text default 'GLOBAL',target_consumed_action_ids text[] default '{}')
returns public.resolution_sessions language sql security definer set search_path='' as $$select private.finalize_resolution_with_grants(target_session_id,expected_lock_version,target_decision,target_manual_resolution,target_gm_explanation,target_teach_ai,target_teach_scope,target_consumed_action_ids)$$;

revoke all on function private.player_ability_document_records(uuid,text,text),private.role_owns_ability(jsonb,jsonb),private.grant_is_current(public.player_ability_grants,integer,text),private.grant_player_ability(uuid,integer,text,text,text,text,text,integer,text,timestamptz,integer,text,text[],jsonb,boolean,boolean,jsonb),private.mutate_player_ability_grant(uuid,integer,text,text,integer),private.queue_player_action(uuid,integer,jsonb,text),private.remove_queued_action(uuid,integer,text,text),private.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[]) from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
revoke all on function public.grant_player_ability(uuid,integer,text,text,text,text,text,integer,text,timestamptz,integer,text,text[],jsonb,boolean,boolean,jsonb),public.bulk_grant_player_abilities(uuid,integer,jsonb),public.grant_random_player_ability(uuid,integer,text,jsonb,text,text,integer,text),public.mutate_player_ability_grant(uuid,integer,text,text,integer),public.queue_player_action(uuid,integer,jsonb,text),public.remove_queued_action(uuid,integer,text,text),public.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[]) from public,anon;
grant execute on function public.grant_player_ability(uuid,integer,text,text,text,text,text,integer,text,timestamptz,integer,text,text[],jsonb,boolean,boolean,jsonb),public.bulk_grant_player_abilities(uuid,integer,jsonb),public.grant_random_player_ability(uuid,integer,text,jsonb,text,text,integer,text),public.mutate_player_ability_grant(uuid,integer,text,text,integer),public.queue_player_action(uuid,integer,jsonb,text),public.remove_queued_action(uuid,integer,text,text),public.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[]) to authenticated;

do $$ begin alter publication supabase_realtime add table public.player_ability_grants; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.player_ability_grant_events; exception when duplicate_object then null; end $$;
