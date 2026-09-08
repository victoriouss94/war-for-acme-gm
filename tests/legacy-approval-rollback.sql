-- Supply an existing owner and lethalResolutionFixture({grantId:'__AUDIT_GRANT_UUID__'}) in memory.
-- Every application call uses authenticated privileges. No fixture is committed.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare endpoint text; decision text; gid uuid; fixture jsonb; original_fixture jsonb:='__ENGINE_FIXTURE_JSON__';
  ver integer; session_row public.resolution_sessions; result jsonb:='[]'; approved public.resolution_sessions;
  grant_row public.player_ability_grants; consumed text[]; denied boolean; claims text:=current_setting('request.jwt.claims'); doc jsonb;
begin
foreach endpoint in array array['finalize_resolution_session','finalize_resolution_with_grants'] loop
foreach decision in array array['APPROVE','MODIFY','REJECT'] loop
  gid:=gen_random_uuid();fixture:=replace(original_fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,fixture->'document');
  select version into ver from public.game_documents where game_id=gid;
  perform public.start_game_phase(gid,ver,'NIGHT_0','Legacy approval regression');
  select version into ver from public.game_documents where game_id=gid;
  grant_row:=public.grant_player_ability(target_game_id=>gid,expected_game_version=>ver,target_player_id=>'audit-actor',target_ability_id=>'audit-kill',target_reason=>'Legacy approval finite-use fixture',target_uses=>1,target_duration_type=>'PERMANENT_FOR_GAME');
  fixture:=replace(fixture::text,'__AUDIT_GRANT_UUID__',grant_row.id::text)::jsonb;
  select version into ver from public.game_documents where game_id=gid;
  perform public.queue_player_action(gid,ver,fixture#>'{actions,0}',null);
  select version into ver from public.game_documents where game_id=gid;
  session_row:=public.start_resolution_session(gid,ver);
  session_row:=public.save_deterministic_resolution(session_row.id,session_row.lock_version,fixture->'proposal');
  consumed:=case when decision='REJECT' then '{}'::text[] else array['audit-lethal-action'] end;
  -- Removed/nonmember callers must not reach the underlying internal finalizer.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated','is_anonymous',false)::text,true);
  denied:=false;
  begin
    execute format('select * from public.%I($1,$2,$3,$4,$5,$6,$7)',endpoint) into approved using session_row.id,session_row.lock_version,'MODIFY',fixture->'ruling','Nonmember attempt',false,'GAME_SPECIFIC';
  exception when sqlstate '42501' or sqlstate 'P0002' then denied:=true; end;
  if not denied then raise exception 'Nonmember legacy approval accepted'; end if;
  perform set_config('request.jwt.claims',claims,true);
  denied:=false;
  begin perform private.finalize_resolution_session(session_row.id,session_row.lock_version,'MODIFY',fixture->'ruling','Direct internal attempt',false,'GAME_SPECIFIC');
  exception when sqlstate '42501' then denied:=true; end;
  if not denied then raise exception 'Internal finalizer remains client executable'; end if;
  denied:=false;
  begin
    execute format('select * from public.%I($1,$2,$3,$4,$5,$6,$7)',endpoint) into approved using session_row.id,session_row.lock_version,'MODIFY','{}'::jsonb,'Malformed ruling',false,'GAME_SPECIFIC';
  exception when sqlstate '22023' then denied:=true; end;
  if not denied then raise exception 'Malformed legacy ruling bypassed canonical validation'; end if;
  -- This inner rollback restores the synthetic game version after rejection.
  denied:=false;
  begin
    select version,document into ver,doc from public.game_documents where game_id=gid;
    perform public.save_game_document(gid,ver,doc,'Synthetic concurrent edit','audit','stale');
    execute format('select * from public.%I($1,$2,$3,$4,$5,$6,$7)',endpoint) into approved using session_row.id,session_row.lock_version,'MODIFY',fixture->'ruling','Stale legacy ruling',false,'GAME_SPECIFIC';
  exception when sqlstate 'PT422' then denied:=sqlerrm='SOURCE_GAME_VERSION_CONFLICT'; end;
  if not denied then raise exception 'Stale source game bypassed canonical validation'; end if;
  if endpoint='finalize_resolution_session' then
    approved:=public.finalize_resolution_session(session_row.id,session_row.lock_version,decision,fixture->'ruling','Legacy finite-use approval',false,'GAME_SPECIFIC');
  else
    approved:=public.finalize_resolution_with_grants(session_row.id,session_row.lock_version,decision,fixture->'ruling','Legacy finite-use approval',false,'GAME_SPECIFIC',consumed);
  end if;
  if decision='REJECT' then
    if approved.status<>'REJECTED' or (select document#>>'{data,players,1,alive}' from public.game_documents where game_id=gid)<>'true' or (select uses_remaining from public.player_ability_grants where id=grant_row.id)<>1 then raise exception 'Legacy rejection applied state or consumed use'; end if;
  else
    if approved.status<>'FINALIZED' or approved.applied_game_version is null or (select document#>>'{data,players,1,alive}' from public.game_documents where game_id=gid)<>'false' or (select uses_remaining from public.player_ability_grants where id=grant_row.id)<>0 then raise exception 'Legacy approval omitted death or finite consumption'; end if;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('endpoint',endpoint,'decision',decision,'game_id',gid,'checks','canonical validation; nonmember denied; private helper denied; stale source denied; exact life/use state'));
end loop;
end loop;
perform set_config('audit.result',result::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
