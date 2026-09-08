-- Existing account only; replace placeholders in memory. No live-game writes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $audit$
declare gid uuid:=gen_random_uuid();fixture jsonb:=$fixture$__MODE_RENAME_FIXTURE_JSON__$fixture$::jsonb;
  doc jsonb;candidate jsonb;ver integer;before_state jsonb;after_state jsonb;denied boolean:=false;
begin
  doc:=jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback configuration rename audit','status','SETUP','currentDay',0,'currentPhase','Night'),
    'data',jsonb_build_object('gameId',gid,'roles',jsonb_build_array(fixture->'original'),'abilities',fixture->'abilities',
      'factions','[{"id":"village","name":"Village","class":"VILLAGER"}]'::jsonb,
      'players','[{"id":"audit-player","name":"Audit Player","roleId":"audit-role","currentFactionId":"village","alive":true,"currentModeId":"import:alt"},{"id":"audit-target","name":"Audit Target","roleId":"audit-role","currentFactionId":"village","alive":true}]'::jsonb,
      'actions','[]'::jsonb,'history','[]'::jsonb,'rules','[]'::jsonb));
  perform public.create_game(gid,doc);
  select version into ver from public.game_documents where game_id=gid;
  perform public.start_game_phase(gid,ver,'NIGHT_0','Isolated rename audit');
  perform public.change_player_mode(gid,'audit-player','import:alt','Initialize original form','GM_TRIGGERED');
  perform public.mutate_temporary_mode_access(gid,'audit-player','import:robot','GRANT','Preserve access through rename');
  select to_jsonb(m) into before_state from public.player_mode_states m where m.game_id=gid and m.player_id='audit-player';
  select document,version into doc,ver from public.game_documents where game_id=gid;
  candidate:=jsonb_set(doc,'{data,roles}',jsonb_build_array(fixture->'updated'));
  perform public.save_game_document(gid,ver,candidate,'Rename configuration','role','audit-role');
  if (select document#>'{data,roles}' from public.game_documents where game_id=gid) is distinct from candidate#>'{data,roles}' then raise exception 'Role did not round trip'; end if;
  select to_jsonb(m) into after_state from public.player_mode_states m where m.game_id=gid and m.player_id='audit-player';
  if after_state is distinct from before_state then raise exception 'Rename changed runtime uses, cooldown, access or identity'; end if;
  if candidate#>>'{data,roles,0,modes,1,id}'<>'import:alt' or candidate#>>'{data,roles,0,modes,1,name}'<>'Guarded Form' or candidate#>>'{data,roles,0,startingModeId}'<>'import:alt' then raise exception 'Renamed mode identity or default lost'; end if;
  begin perform public.save_game_document(gid,ver,doc,'Stale rename','role','audit-role');
  exception when sqlstate 'PT422' then denied:=sqlerrm='VERSION_CONFLICT'; end;
  if not denied then raise exception 'Stale rename accepted'; end if;
  select version into ver from public.game_documents where game_id=gid;
  perform public.queue_player_action(gid,ver,'{"id":"rename-action","sourceType":"PLAYER","sourcePlayerId":"audit-player","abilityId":"guard","modeId":"import:alt","targetType":"PLAYER","targetIds":["audit-target"],"status":"QUEUED"}'::jsonb,null);
  if not exists(select 1 from public.game_documents d,jsonb_array_elements(d.document#>'{data,actions}') a where d.game_id=gid and a->>'id'='rename-action' and a->>'modeId'='import:alt' and a->>'modeName'='Guarded Form') then raise exception 'Queue lost renamed mode identity/name'; end if;
  perform set_config('audit.rename_result',jsonb_build_object('fixture_id',gid,'result','Configuration rename/save/runtime/queue passed')::text,true);
end $audit$;
select current_setting('audit.rename_result')::jsonb verification;
rollback;
