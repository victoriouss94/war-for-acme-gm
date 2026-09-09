-- Supply the existing audit owner and SQL-escaped modeIntelFixture JSON in memory.
-- Public authenticated RPC workflow; all fixture data is rolled back.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); fixture jsonb:='__ENGINE_FIXTURE_JSON__'::jsonb;
  ver integer; queued jsonb; expected jsonb; session_row public.resolution_sessions; approved public.resolution_sessions;
  phase_row public.game_phases; approval_key uuid:=gen_random_uuid(); event_count integer;
begin
  fixture:=replace(fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,fixture->'document');
  select version into ver from public.game_documents where game_id=gid;
  perform public.start_game_phase(gid,ver,'NIGHT_0','Isolated mode Intel audit');
  for queued in select value from jsonb_array_elements(fixture->'actions') loop
    select version into ver from public.game_documents where game_id=gid;
    perform public.queue_player_action(gid,ver,queued,null);
  end loop;
  select version into ver from public.game_documents where game_id=gid;
  session_row:=public.start_resolution_session(gid,ver);
  if not exists(select 1 from jsonb_array_elements(session_row.pre_resolution_state->'roles') r
    where r->>'id'='audit-hidden' and r#>'{modes,0,investigationAppearance}'=fixture#>'{document,data,roles,1,modes,0,investigationAppearance}')
    then raise exception 'Current mode investigation appearance missing from cloud snapshot'; end if;
  session_row:=public.save_deterministic_resolution(session_row.id,session_row.lock_version,fixture->'proposal');
  approved:=public.approve_and_apply_resolution(session_row.id,session_row.lock_version,fixture->'ruling','Verify mode Intel answers',false,'GAME_SPECIFIC','{}',approval_key,false,false);
  if approved.status<>'FINALIZED' then raise exception 'Intel ruling not finalized'; end if;
  for expected in select value from jsonb_array_elements(fixture->'expected') loop
    if not exists(select 1 from jsonb_array_elements(approved.final_resolution->'action_results') a
      where a->>'action_id'=expected->>'actionId' and a->>'reason'=expected->>'reason' and a->>'result'='SUCCESS')
      then raise exception 'Final Intel answer did not preserve current appearance: %',expected; end if;
  end loop;
  select count(*) into event_count from public.resolution_session_events where session_id=approved.id;
  perform public.approve_and_apply_resolution(session_row.id,session_row.lock_version,fixture->'ruling','Same approval retry',false,'GAME_SPECIFIC','{}',approval_key,false,false);
  if (select count(*) from public.resolution_session_events where session_id=approved.id)<>event_count then raise exception 'Retry duplicated Intel events'; end if;
  select version into ver from public.game_documents where game_id=gid;
  select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
  perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Advance approved Intel fixture');
  if exists(select 1 from public.game_documents gd cross join lateral jsonb_array_elements(gd.document#>'{data,players}') p
    join lateral jsonb_array_elements(fixture#>'{document,data,players}') original on original->>'id'=p->>'id'
    where gd.game_id=gid and (p->>'roleId' is distinct from original->>'roleId' or p->>'alive'<>'true' or p->>'currentFactionId' is distinct from original->>'currentFactionId'))
    then raise exception 'Investigation appearance mutated real role, faction or life state'; end if;
  perform set_config('audit.result',jsonb_build_object('game_id',gid,'expected',fixture->'expected','checks','snapshot appearance preserved; final answers exact; replay idempotent; phase advanced; real role/faction/life unchanged')::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
