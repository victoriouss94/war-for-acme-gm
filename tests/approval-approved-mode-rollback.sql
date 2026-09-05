-- Replace __AUDIT_OWNER_UUID__ with an authorized test account before execution.
-- All fixture records are created through public RPCs and rolled back.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); doc jsonb; phase_result jsonb; queued jsonb; session_row public.resolution_sessions; approved public.resolution_sessions; ver integer; saved_version integer; event_count integer; denied boolean; ruling jsonb; action jsonb; result_json jsonb; idem uuid:=gen_random_uuid();
begin
doc:=jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback approval audit','status','SETUP','currentDay',0,'currentPhase','Night'),'data',jsonb_build_object('gameId',gid,'players',jsonb_build_array(jsonb_build_object('id','audit-actor','gameId',gid,'name','Audit Actor','alive',true,'roleId','audit-role','currentFactionId','audit-town'),jsonb_build_object('id','audit-target','gameId',gid,'name','Audit Target','alive',true,'roleId','audit-role','currentFactionId','audit-town')),'roles',jsonb_build_array(jsonb_build_object('id','audit-role','gameId',gid,'name','Audit Investigator','roleType','STANDARD','factionId','audit-town','tags',jsonb_build_array('Ask'),'enabled',true)),'abilities',jsonb_build_array(jsonb_build_object('id','audit-ask','gameId',gid,'name','Ask','phase','Night','definition','Investigate one player.','enabled',true)),'factions',jsonb_build_array(jsonb_build_object('id','audit-town','gameId',gid,'name','Audit Town','class','VILLAGER')),'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb));
doc:=jsonb_set(doc,'{data,roles}',doc#>'{data,roles}'||jsonb_build_array(jsonb_build_object('id','audit-multimode','gameId',gid,'name','Audit Modes','startingModeId','base','modes',jsonb_build_array(jsonb_build_object('id','base','name','Base'),jsonb_build_object('id','alt','name','Alt')))));
doc:=jsonb_set(doc,'{data,players,1,roleId}','"audit-multimode"');
perform public.create_game(gid,doc);
select version into ver from public.game_documents where game_id=gid;
phase_result:=public.start_game_phase(gid,ver,'NIGHT_0','Rollback audit fixture');
select version into ver from public.game_documents where game_id=gid;
action:=jsonb_build_object('id','audit-action','gameId',gid,'name','Ask','sourceType','PLAYER','sourcePlayerId','audit-actor','abilityId','audit-ask','targetIds',jsonb_build_array('audit-target'),'targetType','PLAYER','status','QUEUED');
queued:=public.queue_player_action(gid,ver,action,null);
select version into ver from public.game_documents where game_id=gid;
session_row:=public.start_resolution_session(gid,ver);
ruling:=jsonb_build_object('schema_version',2,'resolution_status','RESOLVED','master_ruling',jsonb_build_object('headline','Audit ruling','summary','Investigation completes.'),'final_ruling','Investigation completes.','action_results',jsonb_build_array(jsonb_build_object('action_id','audit-action','order',1,'resolution_category','INTEL','resolution_timing','ORDERED_STAGE','original_target_ids',jsonb_build_array('audit-target'),'final_target_ids',jsonb_build_array('audit-target'),'affected_player_ids',jsonb_build_array('audit-target'),'result','SUCCESS','reason','Investigation completes.','use_disposition','NOT_APPLICABLE','gm_override','{}'::jsonb)),'passive_results','[]'::jsonb,'status_effects','[]'::jsonb,'player_outcomes','[]'::jsonb,'grant_effects','[]'::jsonb,'other_effects',jsonb_build_array(jsonb_build_object('type','MODE_CHANGE','player_id','audit-target','target_id','alt','summary','Approved mode change')),'events','[]'::jsonb,'audit_padding',repeat('x',110000));
denied:=false;
begin
  perform public.approve_and_apply_resolution(session_row.id,session_row.lock_version+1,ruling,'Stale audit',false,'GAME_SPECIFIC','{}',gen_random_uuid(),false,false);
exception when sqlstate 'PT422' then
  if sqlerrm<>'RESOLUTION_VERSION_CONFLICT' then raise; end if; denied:=true;
end;
if not denied then raise exception 'Stale approval unexpectedly accepted'; end if;
perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated','is_anonymous',false)::text,true);
denied:=false;
begin
  perform public.approve_and_apply_resolution(session_row.id,session_row.lock_version,ruling,'Nonmember audit',false,'GAME_SPECIFIC','{}',gen_random_uuid(),false,false);
exception when insufficient_privilege then denied:=true;
end;
if not denied then raise exception 'Nonmember approval unexpectedly accepted'; end if;
if exists(select 1 from public.game_documents where game_id=gid) then raise exception 'Nonmember can read fixture game'; end if;
perform set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
approved:=public.approve_and_apply_resolution(session_row.id,session_row.lock_version,ruling,'Rollback-only audit; never teach.',false,'GAME_SPECIFIC','{}',idem,false,false);
if approved.status<>'FINALIZED' then raise exception 'Approval did not finalize'; end if;
if octet_length(approved.final_resolution::text)<100000 then raise exception 'Large ruling was lost'; end if;
select version into saved_version from public.game_documents where game_id=gid;
select count(*) into event_count from public.resolution_session_events where session_id=approved.id;
perform public.approve_and_apply_resolution(session_row.id,session_row.lock_version,ruling,'Duplicate audit',false,'GAME_SPECIFIC','{}',idem,false,false);
if (select version from public.game_documents where game_id=gid)<>saved_version then raise exception 'Duplicate changed document'; end if;
if (select count(*) from public.resolution_session_events where session_id=approved.id)<>event_count then raise exception 'Duplicate changed event count'; end if;
denied:=false;
begin
  perform public.approve_and_apply_resolution(session_row.id,approved.lock_version,ruling,'Different-key audit',false,'GAME_SPECIFIC','{}',gen_random_uuid(),false,false);
exception when sqlstate 'PT422' then
  if sqlerrm<>'RESOLUTION_ALREADY_FINALIZED' then raise; end if; denied:=true;
end;
if not denied then raise exception 'Finalized ruling accepted a new key'; end if;
if not exists(select 1 from public.game_phase_events where resolution_session_id=approved.id and payload->>'finalResolutionStoredIn'='resolution_sessions.final_resolution' and octet_length(payload::text)<100000) then raise exception 'Missing bounded ruling reference'; end if;
perform public.approve_and_apply_resolution(session_row.id,session_row.lock_version,jsonb_set(ruling,'{other_effects}',jsonb_build_array(jsonb_build_object('type','MODE_CHANGE','player_id','audit-target','target_id','base','summary','Unapproved effect added to replay'))),'Changed-payload replay audit',false,'GAME_SPECIFIC','{}',idem,false,false);
if (select current_mode_id from public.player_mode_states where game_id=gid and player_id='audit-target') is distinct from 'alt' then raise exception 'Approved mode effect missing or changed on retry'; end if;
if (select count(*) from public.player_mode_events where game_id=gid and player_id='audit-target')<>1 then raise exception 'Approved mode applied more than once'; end if;
result_json:=jsonb_build_object('game_id',gid,'session_id',approved.id,'approved_mode_applied_once',exists(select 1 from public.player_mode_states where game_id=gid and player_id='audit-target' and current_mode_id='alt'),'status',approved.status,'checks','stale rejected; nonmember denied; RLS denied; duplicate stable; new key rejected; bounded history','ruling_bytes',octet_length(approved.final_resolution::text));
perform set_config('audit.result',result_json::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
