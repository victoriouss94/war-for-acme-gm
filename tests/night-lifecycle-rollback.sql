-- Run with a SQL-escaped engine fixture and authorized test-owner UUID.
-- All temporary game records and any candidate migration are rolled back.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); fixture jsonb:='__ENGINE_FIXTURE_JSON__'; ver integer; saved_ver integer;
 s public.resolution_sessions; approved public.resolution_sessions; phase_row public.game_phases;
 action jsonb; failed boolean; idem uuid:=gen_random_uuid(); events_before integer; history_before integer; bad jsonb;
begin
 fixture:=replace(fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
 perform public.create_game(gid,fixture->'document');
 select version into ver from public.game_documents where game_id=gid;
 perform public.start_game_phase(gid,ver,'NIGHT_0','Isolated lifecycle audit');
 for action in select value from jsonb_array_elements(fixture->'actions') loop
  select version into ver from public.game_documents where game_id=gid;
  select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
  perform public.queue_player_action(gid,ver,action||jsonb_build_object('gameId',gid,'phaseId',phase_row.id,'phaseVersion',phase_row.queue_version),null);
 end loop;
 select version into ver from public.game_documents where game_id=gid;
 select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
 begin
  perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,true,'Must finalize first');
  raise exception 'Unfinalized night advanced';
 exception when sqlstate '55000' then if sqlerrm<>'FINALIZE_NIGHT_BEFORE_ADVANCE' then raise; end if; end;
 s:=public.start_resolution_session(gid,ver);
 s:=public.save_deterministic_resolution(s.id,s.lock_version,fixture->'proposal');
 if (select document#>>'{data,players,1,alive}' from public.game_documents where game_id=gid)<>'true' then raise exception 'Premature death'; end if;
 if (select document#>>'{data,players,0,currentFactionId}' from public.game_documents where game_id=gid)<>'audit-town' then raise exception 'Premature conversion'; end if;
 select count(*) into history_before from public.change_history where game_id=gid;
 -- Failure late in application: invalid mode must roll back prior player/status/history work.
 bad:=jsonb_set(fixture->'ruling','{other_effects}',jsonb_build_array(jsonb_build_object('type','MODE_CHANGE','player_id','audit-actor','target_id','missing-mode','summary','Forced rollback test')));
 failed:=false;
 begin perform public.approve_and_apply_resolution(s.id,s.lock_version,bad,'Forced rollback audit',false,'GAME_SPECIFIC','{}',gen_random_uuid(),false,false);
 exception when others then failed:=true; end;
 if not failed then raise exception 'Forced failure did not fail'; end if;
 if (select version from public.game_documents where game_id=gid)<>ver then raise exception 'Partial document commit'; end if;
 if (select status from public.resolution_sessions where id=s.id)='FINALIZED' then raise exception 'Partial finalized state'; end if;
 if (select count(*) from public.change_history where game_id=gid)<>history_before then raise exception 'Partial history'; end if;
 if exists(select 1 from public.player_status_effects where game_id=gid) then raise exception 'Partial status commit'; end if;
 approved:=public.approve_and_apply_resolution(s.id,s.lock_version,fixture->'ruling','Reviewed lifecycle ruling',false,'GAME_SPECIFIC','{}',idem,false,false);
 if approved.status<>'FINALIZED' then raise exception 'Not finalized'; end if;
 if (select resolution_summary->>'official' from public.game_phases where id=phase_row.id)<>'true' then raise exception 'Phase not official'; end if;
 if not (fixture->>'empty')::boolean then
  if (select count(*) from public.player_status_effects where game_id=gid and status_type in ('DRUNK','SOBER') and state='ACTIVE' and duration='Until Hanging')<>2 then raise exception 'Communication effects did not activate at finalization'; end if;
  if (select document#>>'{data,players,1,alive}' from public.game_documents where game_id=gid)<>'false' then raise exception 'Death not committed'; end if;
  if (select document#>>'{data,players,0,currentFactionId}' from public.game_documents where game_id=gid)<>'audit-den' then raise exception 'Conversion not committed'; end if;
 end if;
 select version into saved_ver from public.game_documents where game_id=gid;
 select count(*) into events_before from public.resolution_session_events where session_id=s.id;
 begin
  perform public.queue_player_action(gid,saved_ver,jsonb_build_object('phaseId',phase_row.id,'phaseVersion',phase_row.queue_version,'id','late','sourcePlayerId','audit-actor'),null);
  raise exception 'Finalized phase accepted an action';
 exception when sqlstate '55000' then if sqlerrm<>'NIGHT_FINALIZED_USE_ADMIN_CORRECTION' then raise; end if; end;
 begin
  perform public.remove_queued_action(gid,saved_ver,'audit-action-0','Late removal',phase_row.id,phase_row.queue_version);
  raise exception 'Finalized phase allowed action removal';
 exception when sqlstate '55000' then if sqlerrm<>'NIGHT_FINALIZED_USE_ADMIN_CORRECTION' then raise; end if; end;
 perform public.approve_and_apply_resolution(s.id,s.lock_version,fixture->'ruling','Duplicate click',false,'GAME_SPECIFIC','{}',idem,false,false);
 if (select version from public.game_documents where game_id=gid)<>saved_ver or (select count(*) from public.resolution_session_events where session_id=s.id)<>events_before then raise exception 'Duplicate application'; end if;
 begin perform public.approve_and_apply_resolution(s.id,s.lock_version,fixture->'ruling','Stale second GM review',false,'GAME_SPECIFIC','{}',gen_random_uuid(),false,false);raise exception 'Stale finalization accepted';
 exception when sqlstate 'PT422' then if sqlerrm<>'RESOLUTION_ALREADY_FINALIZED' then raise; end if; end;
 select * into phase_row from public.game_phases where id=phase_row.id;
 perform public.advance_game_phase(gid,saved_ver,phase_row.id,phase_row.queue_version,false,'Advance finalized audit');
 if not exists(select 1 from public.game_phases where game_id=gid and phase='Day' and cycle=1 and status='CURRENT' and action_queue='[]') then raise exception 'Wrong next phase'; end if;
 if not (fixture->>'empty')::boolean and (select count(*) from public.player_status_effects where game_id=gid and status_type in ('DRUNK','SOBER') and state='ACTIVE' and duration='Until Hanging')<>2 then raise exception 'Communication effects expired before hanging'; end if;
 begin perform public.advance_game_phase(gid,saved_ver,phase_row.id,phase_row.queue_version,false,'Duplicate advance');raise exception 'Duplicate advancement accepted';
 exception when sqlstate 'PT422' then null; end;
 if (select count(*) from public.game_phases where game_id=gid)<>2 then raise exception 'Skipped phase'; end if;
 if (select count(*) from public.resolution_session_events where session_id=s.id)<>events_before then raise exception 'Advance reapplied result'; end if;
 perform set_config('audit.lifecycle_result',jsonb_build_object('empty',fixture->'empty','finalized',approved.status,'actions',jsonb_array_length(fixture->'actions'),'rollback','PASS','duplicateFinalize','PASS','staleReview','PASS','advanceOnce','PASS','AIcalls',0)::text,true);
end $test$;
select current_setting('audit.lifecycle_result')::jsonb verification;
rollback;
