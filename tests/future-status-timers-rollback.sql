-- Replace __AUDIT_OWNER_UUID__ with an authorized test account before execution.
-- All fixture records are created through public RPCs and rolled back.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); doc jsonb; phase_result jsonb; phase_row public.game_phases;
  status_one public.player_status_effects; status_two public.player_status_effects; status_manual public.player_status_effects; ver integer;
begin
doc:=jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback approval audit','status','SETUP','currentDay',0,'currentPhase','Night'),'data',jsonb_build_object('gameId',gid,'players',jsonb_build_array(jsonb_build_object('id','audit-actor','gameId',gid,'name','Audit Actor','alive',true,'roleId','audit-role','currentFactionId','audit-town'),jsonb_build_object('id','audit-target','gameId',gid,'name','Audit Target','alive',true,'roleId','audit-role','currentFactionId','audit-town')),'roles',jsonb_build_array(jsonb_build_object('id','audit-role','gameId',gid,'name','Audit Investigator','roleType','STANDARD','factionId','audit-town','tags',jsonb_build_array('Ask'),'enabled',true)),'abilities',jsonb_build_array(jsonb_build_object('id','audit-ask','gameId',gid,'name','Ask','phase','Night','definition','Investigate one player.','enabled',true)),'factions',jsonb_build_array(jsonb_build_object('id','audit-town','gameId',gid,'name','Audit Town','class','VILLAGER')),'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb));
perform public.create_game(gid,doc);
select version into ver from public.game_documents where game_id=gid;
phase_result:=public.start_game_phase(gid,ver,'NIGHT_0','Rollback audit fixture');
select version into ver from public.game_documents where game_id=gid;

status_one:=public.mutate_player_status(gid,null,'APPLY',jsonb_build_object('player_id','audit-target','status_type','ABILITIES_DISABLED','status_name','Future night capture','applied_at_cycle',1,'applied_at_phase','Night','remaining_duration',1,'reason','Future timer audit'));
status_two:=public.mutate_player_status(gid,null,'APPLY',jsonb_build_object('player_id','audit-target','status_type','AUDIT_FUTURE','status_name','Future pending marker','state','PENDING','applied_at_cycle',2,'applied_at_phase','Day','remaining_duration',2,'reason','Future timer audit'));
status_manual:=public.mutate_player_status(gid,null,'APPLY',jsonb_build_object('player_id','audit-target','status_type','DRUNK','status_name','Pending hanging marker','state','PENDING','duration','Until Hanging','reason','Pending marker audit'));
select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
phase_result:=public.preview_game_phase_advance(gid,phase_row.id,phase_row.queue_version);
if exists(select 1 from jsonb_array_elements(phase_result->'expiring_statuses') e where e->>'id'=status_one.id::text) then raise exception 'Future Night1 status shown expiring at Night0'; end if;
if exists(select 1 from jsonb_array_elements(phase_result->'decrementing_statuses') e where e->>'id'=status_two.id::text) then raise exception 'Future Day2 timer shown decrementing at Night0'; end if;
perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Audit Night0 to Day1');
if not exists(select 1 from public.player_status_effects where id=status_one.id and state='ACTIVE' and remaining_duration=1) then raise exception 'Future Night1 status expired before Day1'; end if;
if not exists(select 1 from public.player_status_effects where id=status_two.id and state='PENDING' and remaining_duration=2) then raise exception 'Future pending timer decremented before Day1'; end if;
select version into ver from public.game_documents where game_id=gid;
select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Audit Day1 to Night1');
if (select state from public.player_status_effects where id=status_one.id)<>'ACTIVE' then raise exception 'Night1 status expired leaving preceding Day1'; end if;
select version into ver from public.game_documents where game_id=gid;
select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
phase_result:=public.preview_game_phase_advance(gid,phase_row.id,phase_row.queue_version);
if not exists(select 1 from jsonb_array_elements(phase_result->'expiring_statuses') e where e->>'id'=status_one.id::text) then raise exception 'Started one-phase status missing from expiry preview'; end if;
perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Audit Night1 to Day2');
if (select state from public.player_status_effects where id=status_one.id)<>'EXPIRED' then raise exception 'Night1 status survived its active night'; end if;
if not exists(select 1 from public.player_status_effects where id=status_two.id and state='PENDING' and remaining_duration=2) then raise exception 'Future pending timer changed before Day2'; end if;
select version into ver from public.game_documents where game_id=gid;
select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Audit Day2 to Night2');
if not exists(select 1 from public.player_status_effects where id=status_two.id and state='PENDING' and remaining_duration=1) then raise exception 'Started pending timer failed to decrement'; end if;
select version into ver from public.game_documents where game_id=gid;
select * into phase_row from public.game_phases where game_id=gid and status='CURRENT';
perform public.advance_game_phase(gid,ver,phase_row.id,phase_row.queue_version,false,'Audit Night2 to Day3');
if (select state from public.player_status_effects where id=status_two.id)<>'EXPIRED' then raise exception 'Started pending timer failed to expire'; end if;
if not exists(select 1 from public.player_status_effects where id=status_manual.id and state='PENDING' and remaining_duration is null) then raise exception 'Untimed hanging marker was auto-resolved'; end if;
perform set_config('audit.result',jsonb_build_object('game_id',gid,'checks','future Night1 status retained until that night ends; future Day2 timer starts at Day2; pending hanging marker preserved; preview agrees with transitions')::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
