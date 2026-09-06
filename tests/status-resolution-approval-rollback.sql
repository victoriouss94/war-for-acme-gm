-- Substitute __AUDIT_OWNER_UUID__ with an authorized fixture account and
-- __ENGINE_FIXTURE_JSON__ with JSON from statusResolutionFixture(), SQL-escaped.
-- The generated engine ruling passes through the real editor normalization.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); fixture jsonb:='__ENGINE_FIXTURE_JSON__'::jsonb;
  ver integer; action jsonb; session_row public.resolution_sessions; approved public.resolution_sessions; phase_row public.game_phases;
begin
  fixture:=replace(fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,fixture->'document');
  select version into ver from public.game_documents where game_id=gid;
  perform public.start_game_phase(gid,ver,'NIGHT_0','Isolated status ruling audit');
  for action in select value from jsonb_array_elements(fixture->'actions') loop
    select version into ver from public.game_documents where game_id=gid;
    perform public.queue_player_action(gid,ver,action,null);
  end loop;
  select version into ver from public.game_documents where game_id=gid;
  session_row:=public.start_resolution_session(gid,ver);
  approved:=public.approve_and_apply_resolution(session_row.id,session_row.lock_version,fixture->'ruling','Isolated engine status approval test',false,'GAME_SPECIFIC','{}',gen_random_uuid(),false,false);
  if approved.status<>'FINALIZED' then raise exception 'Status ruling was not finalized'; end if;
  if (select count(*) from public.player_status_effects where game_id=gid and status_type in ('DRUNK','SOBER') and state='PENDING' and duration='Until Hanging' and expires_at_cycle is null and expires_at_phase is null and remaining_duration is null)<>2 then raise exception 'Pending event statuses did not persist intact'; end if;
  select version into ver from public.game_documents where game_id=gid;
  select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
  perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Advance approved status fixture');
  if (select count(*) from public.player_status_effects where game_id=gid and state='PENDING')<>2 then raise exception 'Advancing auto-resolved a hanging marker'; end if;
  perform set_config('audit.result',jsonb_build_object('game_id',gid,'status',approved.status,'checks','real engine and editor payload accepted; two pending event statuses retained across phase advance')::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
