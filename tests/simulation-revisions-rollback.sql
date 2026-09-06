-- Substitute the authenticated owner and SQL-escaped poisonResolutionFixture()
-- JSON in memory. Only synthetic application rows are written; all roll back.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;

do $fixture$
declare gid uuid:=gen_random_uuid(); fixture jsonb:='__ENGINE_FIXTURE_JSON__'::jsonb;
  ver integer; saved public.resolution_sessions; original jsonb; replacement jsonb; denied boolean; command text;
begin
  fixture:=replace(fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,fixture->'document');
  select version into ver from public.game_documents where game_id=gid;
  perform public.start_game_phase(gid,ver,'NIGHT_0','Isolated simulation history test');
  select version into ver from public.game_documents where game_id=gid;
  perform public.queue_player_action(gid,ver,fixture#>'{actions,0}',null);
  select version into ver from public.game_documents where game_id=gid;
  saved:=public.start_resolution_session(gid,ver);
  original:=jsonb_set(fixture->'proposal','{summary}','"original-unique-audit-ruling"');
  saved:=public.save_deterministic_resolution(saved.id,saved.lock_version,original);
  replacement:=jsonb_set(original,'{summary}','"replacement-audit-ruling"');
  saved:=public.save_deterministic_resolution(saved.id,saved.lock_version,replacement);
  if (select count(*) from public.resolution_simulation_revisions where session_id=saved.id)<>2
    or not exists(select 1 from public.resolution_simulation_revisions where session_id=saved.id and simulation_version=1 and proposal=original and capture_kind='SAVED' and simulated_by=auth.uid())
    or not exists(select 1 from public.resolution_simulation_revisions where session_id=saved.id and simulation_version=2 and proposal=replacement and capture_kind='SAVED')
    or saved.engine_proposal<>replacement then raise exception 'Exact original/current proposals were not retained'; end if;
  denied:=false;
  begin perform public.save_deterministic_resolution(saved.id,saved.lock_version-1,original);
  exception when sqlstate 'PT422' then denied:=sqlerrm='RESOLUTION_VERSION_CONFLICT'; end;
  if not denied then raise exception 'Stale save was accepted'; end if;
  denied:=false;
  begin perform public.save_deterministic_resolution(saved.id,saved.lock_version,jsonb_set(original,'{action_results}','[]'));
  exception when sqlstate '22023' then denied:=sqlerrm='ENGINE_ACTION_SNAPSHOT_MISMATCH'; end;
  if not denied then raise exception 'Wrong action snapshot was accepted'; end if;
  denied:=false;
  begin perform public.save_deterministic_resolution(saved.id,saved.lock_version,jsonb_set(original,'{summary}',to_jsonb(repeat('x',900001))));
  exception when sqlstate '22023' then denied:=sqlerrm='INVALID_ENGINE_PROPOSAL'; end;
  if not denied then raise exception 'Oversized proposal was accepted'; end if;
  foreach command in array array[
    format('insert into public.resolution_simulation_revisions(session_id,simulation_version,game_id,proposal,capture_kind) values(%L,90,%L,''{}'',''SAVED'')',saved.id,gid),
    format('update public.resolution_simulation_revisions set proposal=''{}'' where session_id=%L',saved.id),
    format('delete from public.resolution_simulation_revisions where session_id=%L',saved.id)
  ] loop
    denied:=false;
    begin execute command; exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Browser owner can directly mutate revision history'; end if;
  end loop;
  if (select count(*) from public.resolution_simulation_revisions where session_id=saved.id)<>2
    or not exists(select 1 from public.resolution_sessions where id=saved.id and lock_version=saved.lock_version and engine_proposal=replacement)
    then raise exception 'Rejected save changed history or current proposal'; end if;
  perform set_config('audit.game_id',gid::text,true);
  perform set_config('audit.session_id',saved.id::text,true);
  perform set_config('audit.original',original::text,true);
end $fixture$;
reset role;

-- Emulate a session with a pre-migration current result at revision 4. Do not
-- invent missing revision 3 or change any live game's session.
do $legacy$
declare sid uuid:=current_setting('audit.session_id')::uuid; collaborator uuid;
begin
  update public.resolution_sessions set simulation_version=4,
    engine_proposal=jsonb_set(engine_proposal,'{summary}','"legacy-current-audit-ruling"') where id=sid;
  select id into collaborator from auth.users where id<>'__AUDIT_OWNER_UUID__'::uuid
    and not coalesce(is_anonymous,false) order by created_at limit 1;
  if collaborator is null then raise exception 'An existing second permanent account is needed for role tests'; end if;
  perform set_config('audit.collaborator',collaborator::text,true);
end $legacy$;
set local role authenticated;
do $legacy_save$
declare saved public.resolution_sessions;
begin
  select * into saved from public.resolution_sessions where id=current_setting('audit.session_id')::uuid;
  saved:=public.save_deterministic_resolution(saved.id,saved.lock_version,saved.engine_proposal);
  if (select array_agg(simulation_version order by simulation_version) from public.resolution_simulation_revisions where session_id=saved.id)<>array[1,2,4,5]
    or not exists(select 1 from public.resolution_simulation_revisions where session_id=saved.id and simulation_version=4 and capture_kind='LEGACY_CURRENT' and proposal->>'summary'='legacy-current-audit-ruling')
    or not exists(select 1 from public.resolution_simulation_revisions where session_id=saved.id and simulation_version=1 and capture_kind='SAVED' and proposal=current_setting('audit.original')::jsonb)
    then raise exception 'Legacy capture rewrote the original or invented missing history'; end if;
  perform set_config('audit.saved_session',to_jsonb(saved)::text,true);
end $legacy_save$;
reset role;

-- Inject a collision only in this synthetic session to prove that a failure
-- after the session UPDATE rolls the whole save back, including events.
insert into public.resolution_simulation_revisions(session_id,simulation_version,game_id,proposal,capture_kind)
values(current_setting('audit.session_id')::uuid,6,current_setting('audit.game_id')::uuid,'{}','SAVED');
set local role authenticated;
do $atomicity$
declare saved public.resolution_sessions; denied boolean:=false; event_count integer;
begin
  select * into saved from public.resolution_sessions where id=current_setting('audit.session_id')::uuid;
  select count(*) into event_count from public.resolution_session_events where session_id=saved.id;
  begin perform public.save_deterministic_resolution(saved.id,saved.lock_version,current_setting('audit.original')::jsonb);
  exception when unique_violation then denied:=true; end;
  if not denied or (select to_jsonb(s) from public.resolution_sessions s where s.id=saved.id)<>current_setting('audit.saved_session')::jsonb
    or (select count(*) from public.resolution_session_events where session_id=saved.id)<>event_count
    then raise exception 'Revision insertion failure partially saved a calculation'; end if;
end $atomicity$;
reset role;
delete from public.resolution_simulation_revisions where session_id=current_setting('audit.session_id')::uuid and simulation_version=6;

-- Nonmember and viewer cannot read or save; an authorized GM can do both.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('audit.collaborator'),'role','authenticated','is_anonymous',false)::text,true);
set local role authenticated;
do $nonmember$
declare denied boolean:=false;
begin
  if exists(select 1 from public.resolution_simulation_revisions where game_id=current_setting('audit.game_id')::uuid) then raise exception 'Nonmember can read GM revisions'; end if;
  begin perform public.save_deterministic_resolution(current_setting('audit.session_id')::uuid,1,'{}');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Nonmember can save'; end if;
end $nonmember$;
reset role;
insert into public.game_members(game_id,user_id,member_role) values(current_setting('audit.game_id')::uuid,current_setting('audit.collaborator')::uuid,'viewer');
set local role authenticated;
do $viewer$
declare denied boolean:=false;
begin
  if exists(select 1 from public.resolution_simulation_revisions where game_id=current_setting('audit.game_id')::uuid) then raise exception 'Viewer can read GM revisions'; end if;
  begin perform public.save_deterministic_resolution(current_setting('audit.session_id')::uuid,1,'{}');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Viewer can save'; end if;
end $viewer$;
reset role;
update public.game_members set member_role='gm' where game_id=current_setting('audit.game_id')::uuid and user_id=current_setting('audit.collaborator')::uuid;
set local role authenticated;
do $gm$
declare saved public.resolution_sessions;
begin
  if (select count(*) from public.resolution_simulation_revisions where game_id=current_setting('audit.game_id')::uuid)<>4 then raise exception 'Authorized GM cannot read revisions'; end if;
  select * into saved from public.resolution_sessions where id=current_setting('audit.session_id')::uuid;
  saved:=public.save_deterministic_resolution(saved.id,saved.lock_version,saved.engine_proposal);
  if not exists(select 1 from public.resolution_simulation_revisions where session_id=saved.id and simulation_version=6 and simulated_by=auth.uid() and capture_kind='SAVED') then raise exception 'GM save lost author attribution'; end if;
end $gm$;
reset role;
delete from public.game_members where game_id=current_setting('audit.game_id')::uuid and user_id=current_setting('audit.collaborator')::uuid;
set local role authenticated;
do $removed$
begin
  if exists(select 1 from public.resolution_simulation_revisions where game_id=current_setting('audit.game_id')::uuid) then raise exception 'Removed GM retains history access'; end if;
end $removed$;

select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $null_identity$
begin
  if exists(select 1 from public.resolution_simulation_revisions where game_id=current_setting('audit.game_id')::uuid) then raise exception 'Null identity retains history access'; end if;
end $null_identity$;
reset role;
set local role anon;
do $anonymous$
declare denied boolean:=false;
begin
  begin perform 1 from public.resolution_simulation_revisions limit 1;
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Anonymous role can select revisions'; end if;
end $anonymous$;
reset role;

do $catalog$
declare role_name text; privilege_name text;
begin
  if not (select relrowsecurity from pg_class where oid='public.resolution_simulation_revisions'::regclass) then raise exception 'Revision RLS is disabled'; end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach privilege_name in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(role_name,'public.resolution_simulation_revisions',privilege_name) then raise exception '% has unexpected % grant',role_name,privilege_name; end if;
    end loop;
  end loop;
  if has_function_privilege('authenticated','private.save_deterministic_resolution(uuid,integer,jsonb)','EXECUTE')
    or has_function_privilege('anon','private.save_deterministic_resolution(uuid,integer,jsonb)','EXECUTE') then raise exception 'Private save function exposed'; end if;
  perform set_config('audit.result',jsonb_build_object('game_id',current_setting('audit.game_id'),'revisions',5,
    'checks','exact original/current; stale/snapshot/size rejection; no browser direct writes; legacy latest without invented gaps; atomic insertion failure; owner and GM; viewer/nonmember/removed/null/anon denial; RLS and grants')::text,true);
end $catalog$;
select current_setting('audit.result')::jsonb as verification;
rollback;
