-- Application calls remain authenticated. Supply fixture JSON and existing owner in memory.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); fixture jsonb:='__ENGINE_FIXTURE_JSON__'::jsonb;
  ver integer; action jsonb; session_row public.resolution_sessions; grant_row public.player_ability_grants;
  phase_row public.game_phases; approved public.resolution_sessions; result jsonb; dead_ids jsonb;
begin
  fixture:=replace(fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,fixture->'document');
  select version into ver from public.game_documents where game_id=gid;
  perform public.start_game_phase(gid,ver,'NIGHT_0','Isolated complex night audit');
  select version into ver from public.game_documents where game_id=gid;
  grant_row:=public.grant_player_ability(target_game_id=>gid,expected_game_version=>ver,target_player_id=>'p32',target_ability_id=>'kill',target_reason=>'Isolated steal and blocked-use test',target_uses=>3,target_duration_type=>'PERMANENT_FOR_GAME',target_stealable=>true);
  fixture:=replace(fixture::text,'__AUDIT_GRANT_UUID__',grant_row.id::text)::jsonb;
  for action in select value from jsonb_array_elements(fixture->'actions') loop
    select version into ver from public.game_documents where game_id=gid;
    perform public.queue_player_action(gid,ver,action,null);
  end loop;
  select version into ver from public.game_documents where game_id=gid;
  session_row:=public.start_resolution_session(gid,ver);
  fixture:=replace(fixture::text,'__AUDIT_SESSION_UUID__',session_row.id::text)::jsonb;
  if jsonb_array_length(session_row.submitted_actions)<>35 then raise exception 'Queue lost original actions'; end if;
  result:=jsonb_build_object('game_id',gid,'grant_id',grant_row.id,'snapshot',session_row.pre_resolution_state,'actions',session_row.submitted_actions,'phase',session_row.phase,'cycle',session_row.cycle);
  if fixture ? 'proposal' then
    session_row:=public.save_deterministic_resolution(session_row.id,session_row.lock_version,fixture->'proposal');
    if exists(select 1 from public.game_documents d,jsonb_array_elements(d.document#>'{data,players}') p where d.game_id=gid and (p->>'alive')::boolean=false) then raise exception 'Preapproval death'; end if;
    approved:=public.approve_and_apply_resolution(session_row.id,session_row.lock_version,fixture->'ruling','Approve isolated complex night',false,'GAME_SPECIFIC','{}',gen_random_uuid(),false,false);
    select jsonb_agg(p->>'id' order by p->>'id') into dead_ids from public.game_documents d,jsonb_array_elements(d.document#>'{data,players}') p where d.game_id=gid and (p->>'alive')::boolean=false;
    if dead_ids is distinct from '["p12","p15","p17","p20","p26","p39","p40","p8"]'::jsonb then raise exception 'Complex deaths mismatch: %',dead_ids; end if;
    if not exists(select 1 from public.player_ability_grants where id=grant_row.id and uses_remaining=2) then raise exception 'Steal or blocked usage changed original grant incorrectly'; end if;
    if not exists(select 1 from public.player_ability_grants where game_id=gid and player_id='p31' and source_type='STOLEN' and uses_remaining=1 and status='ACTIVE') then raise exception 'Stolen player-specific use missing'; end if;
    if not exists(select 1 from public.player_ability_grants where game_id=gid and player_id='p32' and source_type='SPECIAL_MECHANIC' and uses_remaining=2 and status='ACTIVE') then raise exception 'Additional uses missing'; end if;
    if not exists(select 1 from public.game_documents d,jsonb_array_elements(d.document#>'{data,players}') p where d.game_id=gid and p->>'id'='p20' and p->>'roleId'='' and p->>'currentFactionId'='den') then raise exception 'Conversion did not clear the old role'; end if;
    if exists(select 1 from public.player_status_effects where game_id=gid and player_id='p18' and status_type='POISON' and state in ('ACTIVE','PENDING')) then raise exception 'Healed poison remained active'; end if;
    if (select count(*) from public.player_status_effects where game_id=gid and status_type='MARK' and player_id in ('p13','p40') and state='ACTIVE')<>2 then raise exception 'Reflected or triggering Mark missing'; end if;
    if approved.final_resolution->'lethal_attempts' is distinct from fixture#>'{ruling,lethal_attempts}' then raise exception 'Final ledger changed'; end if;
    select version into ver from public.game_documents where game_id=gid;
    select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
    perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Advance isolated complex night');
    if not exists(select 1 from public.game_phases where game_id=gid and status='CURRENT' and phase='Day' and cycle=1) then raise exception 'Did not reach Day 1'; end if;
    result:=result||jsonb_build_object('final_resolution',approved.final_resolution,'deaths',dead_ids,'document',(select document from public.game_documents where game_id=gid),'grants',(select jsonb_agg(to_jsonb(g)) from public.player_ability_grants g where g.game_id=gid));
  end if;
  perform set_config('audit.result',result::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
