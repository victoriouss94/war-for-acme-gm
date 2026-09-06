-- Substitute owner UUID and SQL-escaped healResolutionFixture() JSON in memory.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); fixture jsonb:='__ENGINE_FIXTURE_JSON__'::jsonb;
  ver integer; session_row public.resolution_sessions; grant_row public.player_ability_grants; status_row public.player_status_effects;
begin
  fixture:=replace(fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,fixture->'document');
  select version into ver from public.game_documents where game_id=gid;
  perform public.start_game_phase(gid,ver,'NIGHT_0','Isolated Heal eligibility audit');
  status_row:=public.mutate_player_status(gid,null,'APPLY',jsonb_build_object('player_id','audit-target','status_type','POISON','status_name','Future poison','applied_at_cycle',1,'applied_at_phase','Night','reason','Future status fixture'));
  select version into ver from public.game_documents where game_id=gid;
  grant_row:=public.grant_player_ability(target_game_id=>gid,expected_game_version=>ver,target_player_id=>'audit-actor',target_ability_id=>'audit-heal',target_reason=>'Isolated Heal fixture',target_uses=>1,target_duration_type=>'PERMANENT_FOR_GAME');
  fixture:=replace(replace(fixture::text,'__AUDIT_GRANT_UUID__',grant_row.id::text),'__AUDIT_STATUS_UUID__',status_row.id::text)::jsonb;
  select version into ver from public.game_documents where game_id=gid;
  perform public.queue_player_action(gid,ver,fixture#>'{actions,0}',null);
  select version into ver from public.game_documents where game_id=gid;
  session_row:=public.start_resolution_session(gid,ver);
  perform public.approve_and_apply_resolution(session_row.id,session_row.lock_version,fixture->'ruling','Heal has no currently applicable effect',false,'GAME_SPECIFIC','{}',gen_random_uuid(),false,false);
  if not exists(select 1 from public.player_ability_grants where id=grant_row.id and uses_remaining=1 and status='ACTIVE') then raise exception 'Ineligible Heal consumed its grant'; end if;
  if not exists(select 1 from public.player_status_effects where id=status_row.id and state='ACTIVE' and applied_at_cycle=1 and applied_at_phase='Night') then raise exception 'Heal changed a future status'; end if;
  if exists(select 1 from public.resolution_session_events where session_id=session_row.id and event_type='ABILITY_CONSUMED') then raise exception 'Ineligible Heal emitted a consumption event'; end if;
  perform set_config('audit.result',jsonb_build_object('game_id',gid,'checks','real engine Heal ruling approved; future status preserved; finite Heal use and consumption history unchanged')::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
