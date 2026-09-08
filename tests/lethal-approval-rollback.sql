-- Existing owner and SQL-escaped lethalResolutionFixture() JSON supplied in memory.
-- All application calls use authenticated privileges; no live game is touched.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); fixture jsonb:='__ENGINE_FIXTURE_JSON__'::jsonb;
  ver integer; session_row public.resolution_sessions; approved public.resolution_sessions; phase_row public.game_phases;
begin
  fixture:=replace(fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,fixture->'document');
  select version into ver from public.game_documents where game_id=gid;
  perform public.start_game_phase(gid,ver,'NIGHT_0','Isolated generated lethal attempt test');
  select version into ver from public.game_documents where game_id=gid;
  perform public.queue_player_action(gid,ver,fixture#>'{actions,0}',null);
  select version into ver from public.game_documents where game_id=gid;
  session_row:=public.start_resolution_session(gid,ver);
  session_row:=public.save_deterministic_resolution(session_row.id,session_row.lock_version,fixture->'proposal');
  if session_row.engine_proposal->'lethal_attempts' is distinct from fixture#>'{proposal,lethal_attempts}' then raise exception 'Saved proposal lost lethal attempts'; end if;
  if (select document#>>'{data,players,1,alive}' from public.game_documents where game_id=gid)<>'true' then raise exception 'Player died before approval'; end if;
  approved:=public.approve_and_apply_resolution(session_row.id,session_row.lock_version,fixture->'ruling','Approve isolated Counterattack outcome',false,'GAME_SPECIFIC','{}',gen_random_uuid(),false,false);
  select * into approved from public.resolution_sessions where id=approved.id;
  if approved.status<>'FINALIZED' or approved.final_resolution->'lethal_attempts' is distinct from fixture#>'{ruling,lethal_attempts}' then raise exception 'Approved ruling lost lethal attempts'; end if;
  if (select document#>>'{data,players,0,alive}' from public.game_documents where game_id=gid)<>'true' or (select document#>>'{data,players,1,alive}' from public.game_documents where game_id=gid)<>'false' then raise exception 'Wrong approved player state'; end if;
  select version into ver from public.game_documents where game_id=gid;
  select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
  perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Advance isolated lethal attempt test');
  perform set_config('audit.result',jsonb_build_object('game_id',gid,'final_resolution',approved.final_resolution,'checks','public queue/save/approve/readback/advance; proposal and ruling retain exact lethal attempts; no preapproval death; immune attacker alive; counter target dead')::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
