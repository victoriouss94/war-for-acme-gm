-- Substitute only the existing audit owner and synthetic fixture in memory.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid();fixture jsonb:='__MODE_FIXTURE_JSON__'::jsonb;
  doc jsonb;ver integer;state_row public.player_mode_states;session_row public.resolution_sessions;
  action jsonb;queue_error text;operation text:='__MODE_OPERATION__';expect_repaired boolean:=__EXPECT_REPAIRED__;
begin
  fixture:=replace(fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,fixture->'document');
  select version into ver from public.game_documents where game_id=gid;
  perform public.start_game_phase(gid,ver,'NIGHT_0','Isolated role reassignment test');
  perform public.change_player_mode(gid,'audit-actor','old-calm','Initialize old role','GM_TRIGGERED');
  perform public.mutate_temporary_mode_access(gid,'audit-actor','shared-mode','GRANT','Old role temporary access',null,10,'Day');
  select document,version into doc,ver from public.game_documents where game_id=gid;
  doc:=jsonb_set(doc,'{data,players,0,roleId}','"audit-new"');
  perform public.save_game_document(gid,ver,doc,'Reassign synthetic role','player','audit-actor');
  if operation<>'NONE' then
    state_row:=public.mutate_temporary_mode_access(gid,'audit-actor','shared-mode',operation,'New role temporary access',null,10,'Day');
  else
    select * into state_row from public.player_mode_states where game_id=gid and player_id='audit-actor';
  end if;
  select version into ver from public.game_documents where game_id=gid;
  begin
    perform public.queue_player_action(gid,ver,fixture->'action',null);
  exception when insufficient_privilege then queue_error:=sqlerrm;
  end;
  -- A separate valid actor guarantees a snapshot even when the tested action is denied.
  perform public.change_player_mode(gid,'audit-target','shared-mode','Initialize control actor','GM_TRIGGERED');
  select version into ver from public.game_documents where game_id=gid;
  action:=(fixture->'action')||'{"id":"control-action","sourcePlayerId":"audit-target","targetIds":["audit-actor"]}'::jsonb;
  perform public.queue_player_action(gid,ver,action,null);
  select version into ver from public.game_documents where game_id=gid;
  session_row:=public.start_resolution_session(gid,ver);
  if expect_repaired then
    if operation<>'NONE' and (state_row.role_id<>'audit-new' or state_row.current_mode_id<>'new-calm') then raise exception 'Temporary mutation retained obsolete role state'; end if;
    if operation='GRANT' and queue_error is not null then raise exception 'Valid temporary mode action denied: %',queue_error; end if;
    if operation<>'GRANT' and queue_error is distinct from 'INACTIVE_MODE' then raise exception 'Inactive action was not denied'; end if;
    if exists(select 1 from jsonb_array_elements(session_row.pre_resolution_state->'modes') m where m->>'role_id'='audit-old') then raise exception 'Snapshot retained obsolete runtime'; end if;
    if operation<>'GRANT' and exists(select 1 from jsonb_array_elements(session_row.pre_resolution_state->'temporary_mode_access') a where a->>'player_id'='audit-actor') then raise exception 'Snapshot retained obsolete access'; end if;
    if operation='GRANT' and not exists(select 1 from public.player_mode_events where game_id=gid and player_id='audit-actor' and role_id='audit-new' and event_type='TEMPORARY_ACCESS_GRANTED') then raise exception 'Grant history has wrong role'; end if;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  begin
    perform public.mutate_temporary_mode_access(gid,'audit-actor','shared-mode','GRANT','Unauthorized audit attempt');
    raise exception 'Nonmember unexpectedly changed mode access';
  exception when insufficient_privilege then
    if sqlerrm<>'GM_ACCESS_REQUIRED' then raise; end if;
  end;
  perform set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
  perform set_config('audit.result',jsonb_build_object('game_id',gid,'operation',operation,'state',to_jsonb(state_row),'queue_error',queue_error,'snapshot',session_row.pre_resolution_state,'actions',session_row.submitted_actions)::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
