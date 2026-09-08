-- Existing account identities, synthetic game only; no AI/provider requests.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select set_config('audit.guest',(select id::text from auth.users where id<>'__AUDIT_OWNER_UUID__'::uuid and not coalesce(is_anonymous,false) order by created_at limit 1),true);
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $setup$
declare gid uuid:=gen_random_uuid();
begin
  perform public.create_game(gid,jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback atomic draft audit','status','SETUP','currentDay',0,'currentPhase','Night'),'data',jsonb_build_object('gameId',gid,'players','[]'::jsonb,'roles','[]'::jsonb,'abilities',jsonb_build_array(jsonb_build_object('id','ask','gameId',gid,'name','Ask','definition','Investigate')),'factions',jsonb_build_array(jsonb_build_object('id','village','gameId',gid,'name','Village')),'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb)));
  perform set_config('audit.game_id',gid::text,true);
end $setup$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $drafts$
declare key text; kind text; result public.ai_drafts; ids jsonb:='{}';
begin
  foreach key in array array['ROLE','ABILITY','FACTION','RULE','bad_role','duplicate','status','fault'] loop
    kind:=case key when 'bad_role' then 'ROLE' when 'duplicate' then 'FACTION' when 'status' then 'STATUS' when 'fault' then 'RULE' else key end;
    result:=public.create_ai_draft_internal(current_setting('audit.game_id')::uuid,kind,'Synthetic '||key,'Audit','{}',false,'','audit-model',gen_random_uuid(),'{}','__AUDIT_OWNER_UUID__');
    ids:=ids||jsonb_build_object(key,result.id);
  end loop;
  perform set_config('audit.draft_ids',ids::text,true);
end $drafts$;
reset role;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $positive$
declare kind text; collection_name text; gid uuid:=current_setting('audit.game_id')::uuid; ids jsonb:=current_setting('audit.draft_ids')::jsonb; entity jsonb; result record; before_version integer; prior jsonb; did uuid; denied boolean;
begin
  foreach kind in array array['ROLE','ABILITY','FACTION','RULE'] loop
    select gd.document,gd.version into prior,before_version from public.game_documents gd where gd.game_id=gid;
    collection_name:=case kind when 'ROLE' then 'roles' when 'ABILITY' then 'abilities' when 'FACTION' then 'factions' else 'rules' end;
    did:=(ids->>kind)::uuid;
    entity:=jsonb_build_object('id','new-'||lower(kind),'gameId',gid,'name','New '||kind,'title','New '||kind,'definition','Synthetic definition','description','Synthetic description','roleType','STANDARD','factionId','village','tags',jsonb_build_array('Ask'),'activeAbilityId','ask','passiveAbilityId','');
    select * into result from public.approve_and_add_ai_draft(did,before_version,entity);
    if result.version<>before_version+1 or result.updated_by<>'__AUDIT_OWNER_UUID__'::uuid then raise exception 'Saved metadata mismatch'; end if;
    if (result.document#>array['data',collection_name])<>(prior#>array['data',collection_name])||jsonb_build_array(entity) then raise exception 'Content append mismatch'; end if;
    if result.document#>'{data,players}'<>prior#>'{data,players}' or result.document#>'{data,actions}'<>prior#>'{data,actions}' then raise exception 'Unrelated player/action state changed'; end if;
    if not exists(select 1 from public.ai_drafts where id=did and status='APPROVED' and reviewed_by='__AUDIT_OWNER_UUID__'::uuid and reviewed_at is not null) then raise exception 'Draft not reviewed atomically'; end if;
    if jsonb_array_length(result.document#>'{data,history}')<>jsonb_array_length(prior#>'{data,history}')+1 then raise exception 'History entry missing'; end if;
    denied:=false;
    begin perform public.approve_and_add_ai_draft(did,result.version,entity);
    exception when sqlstate '55000' then denied:=sqlerrm='AI_DRAFT_ALREADY_REVIEWED'; end;
    if not denied then raise exception 'Replay accepted'; end if;
    if (select gd.version from public.game_documents gd where gd.game_id=gid)<>result.version then raise exception 'Replay changed version'; end if;
  end loop;
end $positive$;
do $invalid$
declare gid uuid:=current_setting('audit.game_id')::uuid; ids jsonb:=current_setting('audit.draft_ids')::jsonb; v integer; original jsonb; entity jsonb; denied boolean;
begin
  select gd.version,gd.document into v,original from public.game_documents gd where gd.game_id=gid;
  entity:=jsonb_build_object('id','duplicate-name','gameId',gid,'name',' New FACTION ');
  denied:=false;begin perform public.approve_and_add_ai_draft((ids->>'duplicate')::uuid,v-1,entity);
  exception when sqlstate 'PT422' then denied:=sqlerrm='VERSION_CONFLICT'; end;
  if not denied then raise exception 'Stale game version accepted'; end if;
  denied:=false;begin perform public.approve_and_add_ai_draft((ids->>'duplicate')::uuid,v,entity);
  exception when unique_violation then denied:=sqlerrm='DRAFT_ENTITY_ALREADY_EXISTS'; end;
  if not denied then raise exception 'Duplicate name accepted'; end if;
  denied:=false;begin perform public.approve_and_add_ai_draft((ids->>'duplicate')::uuid,v,entity||jsonb_build_object('gameId',gen_random_uuid()));
  exception when invalid_parameter_value then denied:=sqlerrm='INVALID_DRAFT_ENTITY'; end;
  if not denied then raise exception 'Cross-game entity accepted'; end if;
  denied:=false;begin perform public.approve_and_add_ai_draft((ids->>'status')::uuid,v,entity);
  exception when invalid_parameter_value then denied:=sqlerrm='DRAFT_REQUIRES_SEPARATE_WORKFLOW'; end;
  if not denied then raise exception 'Status draft silently applied to live state'; end if;
  entity:=jsonb_build_object('id','bad-role','gameId',gid,'name','Missing ability role','roleType','STANDARD','factionId','village','tags',jsonb_build_array('Missing ability'));
  denied:=false;begin perform public.approve_and_add_ai_draft((ids->>'bad_role')::uuid,v,entity);
  exception when foreign_key_violation then denied:=sqlerrm='ROLE_ENCYCLOPEDIA_ABILITY_REQUIRED'; end;
  if not denied then raise exception 'Role linked nonexistent ability'; end if;
  if (select gd.document from public.game_documents gd where gd.game_id=gid)<>original or (select gd.version from public.game_documents gd where gd.game_id=gid)<>v then raise exception 'Rejected request partially saved'; end if;
  if (select count(*) from public.ai_drafts where game_id=gid and status='DRAFT')<>4 then raise exception 'Rejected request marked a draft reviewed'; end if;
end $invalid$;
do $basic_role$
declare gid uuid:=current_setting('audit.game_id')::uuid; did uuid:=(current_setting('audit.draft_ids')::jsonb->>'bad_role')::uuid; entity jsonb; v integer; result record; denied boolean:=false;
begin
  select gd.version into v from public.game_documents gd where gd.game_id=gid;
  entity:=jsonb_build_object('id','basic-role','gameId',gid,'name','Basic Role','roleType','BASIC','factionId','village','tags',jsonb_build_array('Ask'),'activeAbilityId','ask','passiveAbilityId','');
  begin perform public.approve_and_add_ai_draft(did,v,entity);
  exception when invalid_parameter_value then denied:=sqlerrm='BASIC_ROLE_CANNOT_HAVE_ABILITIES'; end;
  if not denied then raise exception 'Basic Role accepted active abilities'; end if;
  entity:=entity||jsonb_build_object('tags','[]'::jsonb,'activeAbilityId','');
  select * into result from public.approve_and_add_ai_draft(did,v,entity);
  if result.version<>v+1 or not exists(select 1 from jsonb_array_elements(result.document#>'{data,roles}') r where r->>'id'='basic-role' and r->>'roleType'='BASIC' and r->'tags'='[]'::jsonb) then raise exception 'Valid Basic Role was not added'; end if;
end $basic_role$;
reset role;
-- Force a review failure after the delegated game save, proving transaction
-- rollback. This temporary trigger/function exists only until this ROLLBACK.
create function pg_temp.reject_audit_draft_review() returns trigger language plpgsql as $fault$
begin
  if new.id=(current_setting('audit.draft_ids')::jsonb->>'fault')::uuid and new.status='APPROVED' then raise exception 'AUDIT_REVIEW_FAILURE'; end if;
  return new;
end $fault$;
create trigger audit_atomic_draft_failure before update on public.ai_drafts for each row execute function pg_temp.reject_audit_draft_review();
set local role authenticated;
do $atomic_failure$
declare gid uuid:=current_setting('audit.game_id')::uuid; did uuid:=(current_setting('audit.draft_ids')::jsonb->>'fault')::uuid; original jsonb; v integer; history_count integer; denied boolean:=false;
begin
  select gd.document,gd.version into original,v from public.game_documents gd where gd.game_id=gid;
  select count(*) into history_count from public.change_history where game_id=gid;
  begin perform public.approve_and_add_ai_draft(did,v,jsonb_build_object('id','fault-rule','gameId',gid,'title','Fault rule','description','Test transactional rollback'));
  exception when raise_exception then denied:=sqlerrm='AUDIT_REVIEW_FAILURE'; end;
  if not denied then raise exception 'Review failure did not occur'; end if;
  if (select gd.document from public.game_documents gd where gd.game_id=gid)<>original or (select gd.version from public.game_documents gd where gd.game_id=gid)<>v then raise exception 'Failed review left saved content'; end if;
  if (select count(*) from public.change_history where game_id=gid)<>history_count or (select status from public.ai_drafts where id=did)<>'DRAFT' then raise exception 'Failed review left audit/status changes'; end if;
end $atomic_failure$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('audit.guest'),'role','authenticated','is_anonymous',false)::text,true);
set local role authenticated;
do $nonmember$
declare denied boolean:=false;
begin
  if nullif(current_setting('audit.guest'),'') is null then raise exception 'Second permanent account required'; end if;
  begin perform public.approve_and_add_ai_draft((current_setting('audit.draft_ids')::jsonb->>'duplicate')::uuid,1,'{}');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Nonmember approval accepted'; end if;
end $nonmember$;
reset role;
insert into public.game_members(game_id,user_id,member_role) values(current_setting('audit.game_id')::uuid,current_setting('audit.guest')::uuid,'viewer');
set local role authenticated;
do $viewer$
declare denied boolean:=false;
begin
  begin perform public.approve_and_add_ai_draft((current_setting('audit.draft_ids')::jsonb->>'duplicate')::uuid,1,'{}');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Viewer approval accepted'; end if;
end $viewer$;
reset role;
set local role anon;
do $anon$
declare denied boolean:=false;
begin
  begin perform public.approve_and_add_ai_draft(gen_random_uuid(),1,'{}');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Anonymous execution accepted'; end if;
end $anon$;
reset role;
select current_setting('audit.game_id') as fixture_game,'four content types; exact append/history/review; replay/stale/invalid/role mapping; forced post-save review rollback; viewer/nonmember/anon denials' as checks;
rollback;
