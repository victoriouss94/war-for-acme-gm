-- Replace __AUDIT_OWNER_UUID__ with an authorized test account before execution.
-- All fixture records are created through public RPCs and rolled back.
begin;
select set_config('audit.guest',(select id::text from auth.users where id<>'__AUDIT_OWNER_UUID__' and not coalesce(is_anonymous,false) limit 1),true);
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare audit_guest uuid:=nullif(current_setting('audit.guest',true),'')::uuid; access_kind text; statement text; statements text[]; denied_count integer:=0; inv record; phase_row public.game_phases; gid uuid:=gen_random_uuid(); doc jsonb; phase_result jsonb; queued jsonb; session_row public.resolution_sessions; approved public.resolution_sessions; ver integer; saved_version integer; event_count integer; denied boolean; ruling jsonb; action jsonb; result_json jsonb; idem uuid:=gen_random_uuid();
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

if audit_guest is null then raise exception 'Second fixture account unavailable'; end if;
select * into inv from public.generate_game_invite(gid,'viewer',86400,1);
select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
ruling:=jsonb_build_object('schema_version',2,'resolution_status','RESOLVED','master_ruling',jsonb_build_object('headline','Audit ruling','summary','Investigation completes.'),'final_ruling','Investigation completes.','action_results',jsonb_build_array(jsonb_build_object('action_id','audit-action','order',1,'resolution_category','INTEL','resolution_timing','ORDERED_STAGE','original_target_ids',jsonb_build_array('audit-target'),'final_target_ids',jsonb_build_array('audit-target'),'affected_player_ids',jsonb_build_array('audit-target'),'result','SUCCESS','reason','Investigation completes.','use_disposition','NOT_APPLICABLE','gm_override','{}'::jsonb)),'passive_results','[]'::jsonb,'status_effects','[]'::jsonb,'player_outcomes','[]'::jsonb,'grant_effects','[]'::jsonb,'other_effects',jsonb_build_array(jsonb_build_object('type','MODE_CHANGE','player_id','audit-target','target_id','alt','summary','Approved mode change')),'events','[]'::jsonb,'audit_padding',repeat('x',110000));
statements:=array[
format('select public.save_game_document(%L::uuid,%s,%L::jsonb)',gid,ver,doc),
format('select public.delete_game(%L::uuid)',gid),
format('select public.save_global_rule(%L::uuid,null,%L,%L,%L,%L)',gid,'AUDIT_RULE','Audit rule','Other','Audit only'),
format('select public.create_knowledge_document(%L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L,%L,1,%L)',gid,gen_random_uuid(),gen_random_uuid(),'audit-document','Audit document','CUSTOM','audit.txt','audit/no-upload.txt','text/plain'),
format('select public.change_player_mode(%L::uuid,%L,%L,%L,%L)',gid,'audit-target','alt','Audit only','GM_OVERRIDE'),
format('select public.grant_player_ability(%L::uuid,%s,%L,%L)',gid,ver,'audit-target','audit-ask'),
format('select public.queue_player_action(%L::uuid,%s,%L::jsonb,null)',gid,ver,action),
format('select public.remove_queued_action(%L::uuid,%s,%L,%L,%L::uuid,%s)',gid,ver,'audit-action','Audit only',phase_row.id,phase_row.queue_version),
format('select public.save_role_ability_modifier(%L::uuid,%L,%L,%L)',gid,'audit-role','audit-ask','Audit only'),
format('select public.set_game_phase_pause(%L::uuid,%s,%L::uuid,%s,true,%L)',gid,ver,phase_row.id,phase_row.queue_version,'Audit only'),
format('select public.save_deterministic_resolution(%L::uuid,%s,%L::jsonb)',session_row.id,session_row.lock_version,'{}'),
format('select public.start_new_ai_conversation(%L::uuid)',gid),
format('select public.create_role_assignment_preview(%L::uuid,%s)',gid,ver),
format('select public.finalize_resolution_with_grants(%L::uuid,%s,%L,%L::jsonb,%L,false)',session_row.id,session_row.lock_version,'MODIFY','{}','Audit only'),
format('select public.approve_and_apply_resolution(%L::uuid,%s,%L::jsonb,%L,false,%L,%L::text[],%L::uuid,false,false)',session_row.id,session_row.lock_version,ruling,'Audit only','GAME_SPECIFIC','{}',gen_random_uuid()),
format('select public.start_resolution_session(%L::uuid,%s)',gid,ver),
format('select public.mutate_player_status(%L::uuid,null,%L,%L::jsonb)',gid,'APPLY',jsonb_build_object('player_id','audit-target','status_type','AUDIT_MARK','status_name','Audit marker','reason','Audit only')),
format('select public.mutate_temporary_mode_access(%L::uuid,%L,%L,%L,%L)',gid,'audit-target','alt','GRANT','Audit only'),
format('select public.generate_game_invite(%L::uuid,%L,86400,1)',gid,'gm'),
format('select public.revoke_game_invite(%L::uuid)',inv.id),
format('select public.set_game_member_role(%L::uuid,%L::uuid,%L)',gid,audit_guest,'gm'),
format('select public.remove_game_member(%L::uuid,%L::uuid)',gid,'__AUDIT_OWNER_UUID__'),
format('select public.start_game_phase(%L::uuid,%s,%L,%L)',gid,ver,'NIGHT_0','Audit only'),
format('select public.advance_game_phase(%L::uuid,%s,%L::uuid,%s,false,%L)',gid,ver,phase_row.id,phase_row.queue_version,'Audit only')
];
foreach access_kind in array array['nonmember','viewer'] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',audit_guest,'role','authenticated','is_anonymous',false)::text,true);
  if access_kind='viewer' then perform public.redeem_game_invite(' '||lower(inv.code)||chr(9)||chr(10)); end if;
  if public.can_edit_game(gid) then raise exception '% unexpectedly has edit rights',access_kind; end if;
  if (exists(select 1 from public.game_documents where game_id=gid)) is distinct from (access_kind='viewer') then
    raise exception '% read visibility incorrect',access_kind;
  end if;
  foreach statement in array statements loop
    denied:=false;
    begin
      execute statement;
    exception when insufficient_privilege then denied:=true;
      when sqlstate 'P0002' then
        -- The legacy wrapper now reads with invoker RLS: unauthorized callers cannot
        -- distinguish a hidden session from a nonexistent session.
        if statement like 'select public.finalize_resolution_with_grants(%' then denied:=true;
        else raise exception 'Unexpected % missing-row error for %: %',access_kind,split_part(statement,'(',1),sqlerrm; end if;
      when others then raise exception 'Unexpected % error for %: [%] %',access_kind,split_part(statement,'(',1),sqlstate,sqlerrm;
    end;
    if not denied then raise exception '% mutation allowed: %',access_kind,split_part(statement,'(',1); end if;
    denied_count:=denied_count+1;
  end loop;
end loop;
perform set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
if (select version from public.game_documents where game_id=gid)<>ver then raise exception 'Denied mutations changed game version'; end if;
if (select status from public.resolution_sessions where id=session_row.id) in ('FINALIZED','REJECTED') then raise exception 'Denied mutations finalized session'; end if;
perform set_config('audit.result',jsonb_build_object('game_id',gid,'denied_mutations',denied_count,'checks','nonmember hidden; viewer readable; all mutations denied; game version and open session preserved')::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
