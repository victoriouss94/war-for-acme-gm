-- Replace __AUDIT_OWNER_UUID__ with an authorized test account before execution.
-- All fixture records are created through public RPCs and rolled back.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); doc jsonb; phase_result jsonb; queued jsonb; session_row public.resolution_sessions; approved public.resolution_sessions; phase_row public.game_phases; advanced jsonb; status_one public.player_status_effects; status_two public.player_status_effects; status_manual public.player_status_effects; grant_next_night public.player_ability_grants; grant_short public.player_ability_grants; grant_permanent public.player_ability_grants; ver integer; saved_version integer; event_count integer; denied boolean; ruling jsonb; action jsonb; result_json jsonb; idem uuid:=gen_random_uuid();
begin
doc:=jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback approval audit','status','SETUP','currentDay',0,'currentPhase','Night'),'data',jsonb_build_object('gameId',gid,'players',jsonb_build_array(jsonb_build_object('id','audit-actor','gameId',gid,'name','Audit Actor','alive',true,'roleId','audit-role','currentFactionId','audit-town'),jsonb_build_object('id','audit-target','gameId',gid,'name','Audit Target','alive',true,'roleId','audit-role','currentFactionId','audit-town')),'roles',jsonb_build_array(jsonb_build_object('id','audit-role','gameId',gid,'name','Audit Investigator','roleType','STANDARD','factionId','audit-town','tags',jsonb_build_array('Ask'),'enabled',true)),'abilities',jsonb_build_array(jsonb_build_object('id','audit-ask','gameId',gid,'name','Ask','phase','Night','definition','Investigate one player.','enabled',true)),'factions',jsonb_build_array(jsonb_build_object('id','audit-town','gameId',gid,'name','Audit Town','class','VILLAGER')),'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb));
doc:=jsonb_set(doc,'{data,roles}',doc#>'{data,roles}'||jsonb_build_array(jsonb_build_object('id','audit-multimode','gameId',gid,'name','Audit Modes','startingModeId','base','modes',jsonb_build_array(jsonb_build_object('id','base','name','Base'),jsonb_build_object('id','alt','name','Alt')))));
doc:=jsonb_set(doc,'{data,players,1,roleId}','"audit-multimode"');
perform public.create_game(gid,doc);
select version into ver from public.game_documents where game_id=gid;
phase_result:=public.start_game_phase(gid,ver,'NIGHT_0','Rollback audit fixture');
select version into ver from public.game_documents where game_id=gid;
status_one:=public.mutate_player_status(gid,null,'APPLY',jsonb_build_object('player_id','audit-target','status_type','AUDIT_MARK','status_name','One phase marker','remaining_duration',1,'reason','Rollback expiry audit'));
status_two:=public.mutate_player_status(gid,null,'APPLY',jsonb_build_object('player_id','audit-target','status_type','AUDIT_MARK','status_name','Two phase marker','remaining_duration',2,'reason','Rollback expiry audit'));
status_manual:=public.mutate_player_status(gid,null,'APPLY',jsonb_build_object('player_id','audit-target','status_type','AUDIT_MANUAL','status_name','Manual marker','reason','Rollback expiry audit'));
grant_short:=public.grant_player_ability(target_game_id=>gid,expected_game_version=>ver,target_player_id=>'audit-target',target_ability_id=>'audit-ask',target_reason=>'Rollback short grant',target_uses=>1,target_duration_type=>'UNTIL_END_OF_DAY');
grant_permanent:=public.grant_player_ability(target_game_id=>gid,expected_game_version=>ver,target_player_id=>'audit-target',target_ability_id=>'audit-ask',target_reason=>'Rollback permanent grant',target_uses=>2,target_duration_type=>'PERMANENT_FOR_GAME');
action:=jsonb_build_object('id','audit-action','gameId',gid,'name','Ask','sourceType','PLAYER','sourcePlayerId','audit-actor','abilityId','audit-ask','targetIds',jsonb_build_array('audit-target'),'targetType','PLAYER','status','QUEUED');
queued:=public.queue_player_action(gid,ver,action,null);
select version into ver from public.game_documents where game_id=gid;
select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
denied:=false;
begin
  perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Must reject unresolved audit');
exception when object_not_in_prerequisite_state then
  if sqlerrm<>'UNRESOLVED_ACTIONS_REQUIRE_APPROVAL' then raise; end if; denied:=true;
end;
if not denied then raise exception 'Unresolved phase advanced'; end if;
session_row:=public.start_resolution_session(gid,ver);
ruling:=jsonb_build_object('schema_version',2,'resolution_status','RESOLVED','master_ruling',jsonb_build_object('headline','Audit ruling','summary','Investigation completes.'),'final_ruling','Investigation completes.','action_results',jsonb_build_array(jsonb_build_object('action_id','audit-action','order',1,'resolution_category','INTEL','resolution_timing','ORDERED_STAGE','original_target_ids',jsonb_build_array('audit-target'),'final_target_ids',jsonb_build_array('audit-target'),'affected_player_ids',jsonb_build_array('audit-target'),'result','SUCCESS','reason','Investigation completes.','use_disposition','NOT_APPLICABLE','gm_override','{}'::jsonb)),'passive_results','[]'::jsonb,'status_effects','[]'::jsonb,'player_outcomes','[]'::jsonb,'grant_effects','[]'::jsonb,'other_effects','[]'::jsonb,'events','[]'::jsonb,'audit_padding',repeat('x',110000));
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
perform public.approve_and_apply_resolution(session_row.id,session_row.lock_version,jsonb_set(ruling,'{other_effects}',jsonb_build_array(jsonb_build_object('type','MODE_CHANGE','player_id','audit-target','target_id','alt','summary','Unapproved effect added to replay'))),'Changed-payload replay audit',false,'GAME_SPECIFIC','{}',idem,false,false);
if exists(select 1 from public.player_mode_states where game_id=gid and player_id='audit-target' and current_mode_id='alt') then raise exception 'Unapproved retry changed mode'; end if;
select version into ver from public.game_documents where game_id=gid;
select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
advanced:=public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Advance approved rollback fixture');
if not exists(select 1 from public.game_phases where game_id=gid and status='CURRENT' and cycle=1 and phase='Day' and action_queue='[]'::jsonb) then raise exception 'Next phase is not empty Day1'; end if;
if not exists(select 1 from public.game_phases where id=phase_row.id and status='COMPLETED' and jsonb_array_length(action_queue)=1) then raise exception 'Historical queue lost'; end if;
if (select document#>>'{game,currentPhase}' from public.game_documents where game_id=gid)<>'Day' then raise exception 'Document phase not synchronized'; end if;
denied:=false;
begin
  perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Duplicate advance audit');
exception when sqlstate 'PT422' then denied:=true;
end;
if not denied then raise exception 'Stale duplicate advance accepted'; end if;
if (select state from public.player_status_effects where id=status_one.id)<>'EXPIRED' then raise exception 'One-phase marker did not expire'; end if;
if not exists(select 1 from public.player_status_effects where id=status_two.id and state='ACTIVE' and remaining_duration=1) then raise exception 'Two-phase marker did not decrement once'; end if;
if not exists(select 1 from public.player_status_effects where id=status_manual.id and state='ACTIVE' and remaining_duration is null) then raise exception 'Manual marker incorrectly expired'; end if;
if (select status from public.player_ability_grants where id=grant_short.id)<>'ACTIVE' then raise exception 'End-of-day grant expired before Day1'; end if;
if not exists(select 1 from public.player_ability_grants where id=grant_permanent.id and status='ACTIVE' and uses_remaining=2) then raise exception 'Permanent grant changed'; end if;
perform set_config('audit.day_grant',to_jsonb(grant_short)::text,true);
select version into ver from public.game_documents where game_id=gid;
grant_next_night:=public.grant_player_ability(target_game_id=>gid,expected_game_version=>ver,target_player_id=>'audit-target',target_ability_id=>'audit-ask',target_reason=>'Day1 end-night boundary',target_uses=>1,target_duration_type=>'UNTIL_END_OF_NIGHT');
perform set_config('audit.night_grant',to_jsonb(grant_next_night)::text,true);
select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Test end of Day1');
if (select status from public.player_ability_grants where id=grant_short.id)<>'EXPIRED' then raise exception 'End-day grant survived Day1 end'; end if;
if (select status from public.player_ability_grants where id=grant_next_night.id)<>'ACTIVE' then raise exception 'End-night grant expired before Night1'; end if;
select version into ver from public.game_documents where game_id=gid;
select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Test end of Night1');
if (select status from public.player_ability_grants where id=grant_next_night.id)<>'EXPIRED' then raise exception 'End-night grant survived Night1 end'; end if;
result_json:=jsonb_build_object('game_id',gid,'session_id',approved.id,'unapproved_replay_changed_mode',exists(select 1 from public.player_mode_states where game_id=gid and player_id='audit-target' and current_mode_id='alt'),'advanced_phase','Day2','expiry_checks','end-day survives Night0 and expires Day1; end-night survives Day1 and expires Night1','status',approved.status,'checks','stale rejected; nonmember denied; RLS denied; duplicate stable; new key rejected; bounded history','ruling_bytes',octet_length(approved.final_resolution::text));
perform set_config('audit.result',result_json::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
reset role;
do $availability$
declare d public.player_ability_grants:=jsonb_populate_record(null::public.player_ability_grants,current_setting('audit.day_grant')::jsonb); n public.player_ability_grants:=jsonb_populate_record(null::public.player_ability_grants,current_setting('audit.night_grant')::jsonb);
begin
if not private.grant_is_current(d,1,'Day') or private.grant_is_current(d,1,'Night') then raise exception 'Database day availability mismatch'; end if;
if not private.grant_is_current(n,1,'Night') or private.grant_is_current(n,2,'Day') then raise exception 'Database night availability mismatch'; end if;
end $availability$;
select 'PASS: database availability matches phase boundaries' as availability;
rollback;
