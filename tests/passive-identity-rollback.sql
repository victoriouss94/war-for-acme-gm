-- Existing owner UUID and SQL-escaped passiveIdentityFixture() JSON supplied in memory.
-- Authenticated public RPCs only; no live game changes or provider requests.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); fixture jsonb:='__ENGINE_FIXTURE_JSON__'::jsonb;
  ver integer; session_row public.resolution_sessions; approved public.resolution_sessions;
  expected jsonb; queued jsonb; analytics jsonb; event_count integer; approval_key uuid:=gen_random_uuid();
begin
  fixture:=replace(fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,fixture->'document');
  select version into ver from public.game_documents where game_id=gid;
  perform public.start_game_phase(gid,ver,'NIGHT_0','Passive source identity audit');
  for queued in select value from jsonb_array_elements(fixture->'actions') loop
    select version into ver from public.game_documents where game_id=gid;
    perform public.queue_player_action(gid,ver,queued,null);
  end loop;
  select version into ver from public.game_documents where game_id=gid;
  session_row:=public.start_resolution_session(gid,ver);
  for expected in select value from jsonb_array_elements(coalesce(fixture->'expectedStandardIds','[]'::jsonb)) loop
    if not exists(select 1 from jsonb_array_elements(session_row.pre_resolution_state->'abilities') a
      where a->>'id'=expected->>'id' and a->>'name'=expected->>'name'
        and a->>'standardAbilityId'=expected->>'standardAbilityId')
      then raise exception 'Renamed standard ability mapping missing from cloud snapshot: %',expected; end if;
  end loop;
  session_row:=public.save_deterministic_resolution(session_row.id,session_row.lock_version,fixture->'proposal');
  if (select document#>>'{data,players,1,alive}' from public.game_documents where game_id=gid)<>'true' then raise exception 'Player died before approval'; end if;
  approved:=public.approve_and_apply_resolution(session_row.id,session_row.lock_version,fixture->'ruling','Verify exact passive sources',false,'GAME_SPECIFIC','{}',approval_key,false,false);
  if approved.status<>'FINALIZED' then raise exception 'Passive identity fixture was not finalized'; end if;
  if fixture->'expectedActiveAction' is not null and fixture->'expectedActiveAction'<>'null'::jsonb then
    expected:=fixture->'expectedActiveAction';
    if not exists(select 1 from jsonb_array_elements(approved.final_resolution->'action_results') a
      where a->>'action_id'=expected->>'id' and a->>'ability_id'=expected->>'abilityId'
        and a->>'ability_name'=expected->>'name' and a->>'standardized_ability_type'=expected->>'standardizedType'
        and a->>'resolution_category'=expected->>'category')
      then raise exception 'Renamed active ability lost its mapped mechanic or local identity'; end if;
  end if;
  analytics:=public.get_resolution_usage_analytics(gid,'{"passive":true}');
  if jsonb_array_length(approved.final_resolution->'passive_results')<>jsonb_array_length(fixture->'expectedPassives')
    or jsonb_array_length(analytics->'rows')<>jsonb_array_length(fixture->'expectedPassives') then raise exception 'Wrong number of passive results or analytics rows'; end if;
  for expected in select value from jsonb_array_elements(fixture->'expectedPassives') loop
    if not exists(select 1 from jsonb_array_elements(approved.final_resolution->'passive_results') p
      where p->>'player_id'=expected->>'playerId' and p->>'ability_id'=expected->>'abilityId'
        and p->>'role_id'=expected->>'roleId' and (p->>'role_version')::integer=(expected->>'roleVersion')::integer)
      then raise exception 'Finalized passive has the wrong source: %',expected; end if;
    select count(*) into event_count from public.resolution_session_events e
      where e.session_id=approved.id and e.event_type='PASSIVE_TRIGGER'
        and e.actor_player_id=expected->>'playerId' and e.ability_id=expected->>'abilityId'
        and e.role_id=expected->>'roleId' and e.role_version=(expected->>'roleVersion')::integer;
    if event_count<>1 then raise exception 'Expected one official passive event for %, got %',expected,event_count; end if;
    if exists(select 1 from public.resolution_session_events e
      where e.session_id=approved.id and e.event_type='PASSIVE_TRIGGER'
        and e.actor_player_id=expected->>'playerId' and e.ability_id=expected->>'abilityId'
        and (to_jsonb(e.original_target_ids) is distinct from expected->'targetIds'
          or to_jsonb(e.final_target_ids) is distinct from expected->'targetIds'
          or e.outcome->'original_target_ids' is distinct from expected->'targetIds'
          or e.outcome->'final_target_ids' is distinct from expected->'targetIds'
          or e.outcome->'effective_target_ids' is distinct from expected->'targetIds'
          or e.outcome->>'submitted_attempt' is distinct from 'false'))
      then raise exception 'PASSIVE_TARGET_PROJECTION_MISMATCH'; end if;
    if not exists(select 1 from jsonb_array_elements(analytics->'rows') r where r->>'player_id'=expected->>'playerId'
      and r->>'ability_id'=expected->>'abilityId' and r->>'role_id'=expected->>'roleId'
      and (r->>'role_version')::integer=(expected->>'roleVersion')::integer and (r->>'passive_triggers')::integer=1 and (r->>'attempts')::integer=0)
      then raise exception 'Wrong passive analytics identity or trigger count'; end if;
  end loop;
  if exists(select 1 from public.resolution_session_events e where e.session_id=approved.id and e.ability_id like 'unrelated-%') then raise exception 'Unrelated catalog ability received official usage'; end if;
  if exists(select 1 from public.game_documents gd cross join lateral jsonb_array_elements(gd.document#>'{data,players}') p
    where gd.game_id=gid and (p->>'alive')::boolean is distinct from ((fixture->'expectedAlive') ? (p->>'id'))) then raise exception 'Passive identity repair changed lethal outcome'; end if;
  select count(*) into event_count from public.resolution_session_events e where e.session_id=approved.id;
  perform public.approve_and_apply_resolution(session_row.id,session_row.lock_version,fixture->'ruling','Identical retry',false,'GAME_SPECIFIC','{}',approval_key,false,false);
  if (select count(*) from public.resolution_session_events e where e.session_id=approved.id)<>event_count then raise exception 'Approval retry duplicated passive events'; end if;
  if exists(select 1 from public.resolution_session_events e where e.session_id=approved.id
    and e.event_type in ('PASSIVE_TRIGGER','PASSIVE_PREVENTED')
    and (e.outcome->'original_target_ids' is distinct from to_jsonb(e.original_target_ids)
      or e.outcome->'final_target_ids' is distinct from to_jsonb(e.final_target_ids)))
    then raise exception 'Approval retry corrupted passive targets'; end if;
  if exists(select 1 from public.game_documents gd cross join lateral jsonb_array_elements(gd.document#>'{data,players}') p
    join lateral jsonb_array_elements(fixture#>'{document,data,players}') original on original->>'id'=p->>'id'
    where gd.game_id=gid and p->>'roleId' is distinct from original->>'roleId') then raise exception 'Temporary passive context permanently changed player role'; end if;
  perform set_config('audit.result',jsonb_build_object('game_id',gid,'expected_passives',fixture->'expectedPassives','usage',public.get_resolution_usage_analytics(gid,'{"passive":true}'),'checks','exact owned ability/role/version in final result and expected official events; no unrelated usage; unchanged life outcomes; no preapproval death; idempotent approval')::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
