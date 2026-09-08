-- Substitute an existing permanent owner UUID in memory; no provider calls.
-- Exercise real reservations and draft persistence only on rollback fixtures.
begin;
select set_config('audit.guest',(select id::text from auth.users where id<>'__AUDIT_OWNER_UUID__'::uuid and not coalesce(is_anonymous,false) order by created_at limit 1),true);
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $setup$
declare gid uuid:=gen_random_uuid();
begin
  perform public.create_game(gid,jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback AI draft persistence','status','SETUP'),'data',jsonb_build_object('gameId',gid,'players','[]'::jsonb,'roles','[]'::jsonb,'abilities','[]'::jsonb,'factions','[]'::jsonb,'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb)));
  perform public.set_ai_usage_limit(gid,null,120);
  perform set_config('audit.game_id',gid::text,true);
  perform set_config('audit.original_document',(select md5(document::text)||':'||version::text from public.game_documents where game_id=gid),true);
end $setup$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $drafts$
declare draft_type text; feature_name text; rid uuid; result public.ai_drafts; gid uuid:=current_setting('audit.game_id')::uuid; denied boolean;
begin
  foreach draft_type in array array['ROLE','ABILITY','FACTION','RULE','STATUS','DOCUMENT_IMPORT'] loop
    feature_name:=case when draft_type='DOCUMENT_IMPORT' then 'document_import' else 'create_'||lower(draft_type) end;
    rid:=gen_random_uuid();
    perform public.reserve_ai_usage_internal(gid,'__AUDIT_OWNER_UUID__',feature_name,'audit-model',rid,'{}');
    result:=public.create_ai_draft_internal(gid,draft_type,'Synthetic '||draft_type,'Synthetic audit request','{"name":"Synthetic draft"}',false,'','audit-model',rid,'{"gameVersion":1}','__AUDIT_OWNER_UUID__');
    if result.status<>'DRAFT' or result.draft_type<>draft_type or result.request_id<>rid or result.created_by<>'__AUDIT_OWNER_UUID__'::uuid or result.game_id<>gid or result.payload<>'{"name":"Synthetic draft"}'::jsonb then raise exception 'Draft metadata/payload mismatch for %',draft_type; end if;
    if not exists(select 1 from public.change_history where game_id=gid and entity_id=result.id::text and user_id='__AUDIT_OWNER_UUID__'::uuid) then raise exception 'Draft audit record missing'; end if;
  end loop;
  if (select count(*) from public.ai_drafts where game_id=gid)<>6 then raise exception 'Incorrect number of drafts'; end if;
  denied:=false;
  begin perform public.create_ai_draft_internal(gid,'UNKNOWN','Synthetic','', '{}',false,'','audit-model',gen_random_uuid(),'{}','__AUDIT_OWNER_UUID__');
  exception when invalid_parameter_value then denied:=sqlerrm='INVALID_DRAFT_TYPE'; end;
  if not denied then raise exception 'Unknown draft type accepted'; end if;
  denied:=false;
  begin perform public.create_ai_draft_internal(gid,'FACTION','Synthetic','', '[]',false,'','audit-model',gen_random_uuid(),'{}','__AUDIT_OWNER_UUID__');
  exception when invalid_parameter_value then denied:=sqlerrm='INVALID_DRAFT_PAYLOAD'; end;
  if not denied then raise exception 'Nonobject draft payload accepted'; end if;
  if nullif(current_setting('audit.guest'),'') is null then raise exception 'Second permanent account required'; end if;
  denied:=false;
  begin perform public.create_ai_draft_internal(gid,'FACTION','Synthetic','', '{}',false,'','audit-model',gen_random_uuid(),'{}',current_setting('audit.guest')::uuid);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Nonmember draft actor accepted'; end if;
end $drafts$;
reset role;
insert into public.game_members(game_id,user_id,member_role) values(current_setting('audit.game_id')::uuid,current_setting('audit.guest')::uuid,'viewer');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('audit.guest'),'role','authenticated','is_anonymous',false)::text,true);
set local role authenticated;
do $viewer$
declare denied boolean:=false;
begin
  if exists(select 1 from public.ai_drafts where game_id=current_setting('audit.game_id')::uuid) then raise exception 'Viewer can read GM drafts'; end if;
  begin perform public.create_ai_draft_internal(current_setting('audit.game_id')::uuid,'FACTION','Synthetic','', '{}',false,'','audit-model',gen_random_uuid(),'{}',auth.uid());
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Browser can invoke internal draft creation'; end if;
end $viewer$;
reset role;
update public.game_members set member_role='gm' where game_id=current_setting('audit.game_id')::uuid and user_id=current_setting('audit.guest')::uuid;
set local role authenticated;
do $gm$
declare changed integer;
begin
  if (select count(*) from public.ai_drafts where game_id=current_setting('audit.game_id')::uuid)<>6 then raise exception 'Collaborating GM cannot read drafts'; end if;
  begin
    update public.ai_drafts set status='APPROVED' where game_id=current_setting('audit.game_id')::uuid;
    get diagnostics changed=row_count;
    if changed<>0 then raise exception 'Direct draft approval bypassed review RPC'; end if;
  exception when insufficient_privilege then null; end;
end $gm$;
reset role;
do $unchanged$
begin
  if (select md5(document::text)||':'||version::text from public.game_documents where game_id=current_setting('audit.game_id')::uuid)<>current_setting('audit.original_document') then raise exception 'Creating a draft mutated the game document'; end if;
end $unchanged$;
select current_setting('audit.game_id') as fixture_game,'six current draft types saved with attribution/audit; nonmember/viewer/client denials; GM read; no direct approval; game unchanged' as checks;
rollback;
