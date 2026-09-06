-- Read the real policy predicates against synthetic object values. No Storage
-- metadata or file bytes are created, updated or deleted. All app rows rollback.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $fixture$
declare gid uuid:=gen_random_uuid();
begin
  perform public.create_game(gid,jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback storage policy audit','status','SETUP','currentDay',0,'currentPhase','Night'),'data',jsonb_build_object('gameId',gid,'players','[]'::jsonb,'roles','[]'::jsonb,'abilities','[]'::jsonb,'factions','[]'::jsonb,'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb)));
  perform set_config('audit.game_id',gid::text,true);
end $fixture$;
reset role;
do $metadata$
declare gid uuid:=current_setting('audit.game_id')::uuid; uploader uuid; iid uuid:=gen_random_uuid(); did uuid:=gen_random_uuid(); vid uuid:=gen_random_uuid(); ipath text; kpath text;
begin
  select id into uploader from auth.users where id<>'__AUDIT_OWNER_UUID__'::uuid and not coalesce(is_anonymous,false) order by created_at limit 1;
  if uploader is null then raise exception 'This rollback fixture needs an existing second account'; end if;
  ipath:=uploader::text||'/'||iid::text||'/audit.docx';
  kpath:=uploader::text||'/'||gid::text||'/'||vid::text||'/audit.txt';
  insert into public.game_members(game_id,user_id,member_role) values(gid,uploader,'gm');
  insert into public.game_imports(id,game_id,import_kind,source_file_name,storage_path,file_size,content_type,created_by)
    values(iid,gid,'reimport','audit.docx',ipath,10,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',uploader);
  insert into public.official_documents(id,document_key,game_id,title,document_type,created_by,scope,owner_id)
    values(did,'audit-'||did::text,gid,'Audit source','CUSTOM',uploader,'GAME_SPECIFIC','__AUDIT_OWNER_UUID__');
  insert into public.official_document_versions(id,document_id,version_number,status,requested_status,source_file_name,storage_path,content_type,file_size,created_by)
    values(vid,did,1,'PROCESSING','ACTIVE','audit.txt',kpath,'text/plain',10,uploader);
  perform set_config('audit.uploader',uploader::text,true);
  perform set_config('audit.import_path',ipath,true);
  perform set_config('audit.knowledge_path',kpath,true);
end $metadata$;
set local role authenticated;
select public.remove_game_member(current_setting('audit.game_id')::uuid,current_setting('audit.uploader')::uuid);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('audit.uploader'),'role','authenticated','is_anonymous',false)::text,true);
do $proof$
declare predicate text; allowed boolean; decisions jsonb:='{}'; policy_name text; object_bucket text; object_path text;
begin
  if exists(select 1 from public.game_imports where game_id=current_setting('audit.game_id')::uuid)
    or exists(select 1 from public.official_documents where game_id=current_setting('audit.game_id')::uuid)
    then raise exception 'Removed uploader still sees fixture registration metadata'; end if;
  foreach policy_name in array array['word_import_cleanup_unregistered','knowledge_cleanup_unregistered'] loop
    object_bucket:=case when policy_name like 'word%' then 'game-import-documents' else 'game-knowledge-documents' end;
    object_path:=current_setting(case when policy_name like 'word%' then 'audit.import_path' else 'audit.knowledge_path' end);
    select qual into predicate from pg_policies where schemaname='storage' and tablename='objects' and policyname=policy_name;
    execute 'select '||predicate||' from (select $1::text as bucket_id,$2::text as name,$3::text as owner_id) objects'
      into allowed using object_bucket,object_path,current_setting('audit.uploader');
    decisions:=decisions||jsonb_build_object(policy_name,allowed);
  end loop;
  if decisions<>'{"word_import_cleanup_unregistered":false,"knowledge_cleanup_unregistered":false}'::jsonb then raise exception 'Registered source became cleanup-eligible after uploader removal: %',decisions; end if;
  perform set_config('audit.result',jsonb_build_object('game_id',current_setting('audit.game_id'),'removed_uploader_cleanup_decisions',decisions)::text,true);
end $proof$;
do $matrix$
declare item record; predicate text; allowed boolean; checks integer:=0; uploader text:=current_setting('audit.uploader'); ipath text:=current_setting('audit.import_path'); kpath text:=current_setting('audit.knowledge_path');
begin
  for item in
    select * from (values
      ('word_import_cleanup_unregistered','game-import-documents',ipath,uploader,false),
      ('knowledge_cleanup_unregistered','game-knowledge-documents',kpath,uploader,false),
      ('word_import_cleanup_unregistered','game-import-documents',uploader||'/unregistered/audit.docx',uploader,true),
      ('knowledge_cleanup_unregistered','game-knowledge-documents',uploader||'/unregistered/audit.txt',uploader,true),
      ('knowledge_read_own_unregistered','game-knowledge-documents',uploader||'/unregistered/audit.txt',uploader,true),
      ('knowledge_read_own_unregistered','game-knowledge-documents',kpath,uploader,false),
      ('word_import_read_game_member','game-import-documents',ipath,uploader,true),
      ('knowledge_read_game_member','game-knowledge-documents',kpath,uploader,false),
      ('word_import_cleanup_unregistered','game-import-documents',uploader||'/unregistered/audit.docx','__AUDIT_OWNER_UUID__',false),
      ('knowledge_cleanup_unregistered','game-knowledge-documents',uploader||'/unregistered/audit.txt','__AUDIT_OWNER_UUID__',false),
      ('knowledge_read_own_unregistered','game-knowledge-documents',uploader||'/unregistered/audit.txt','__AUDIT_OWNER_UUID__',false),
      ('word_import_cleanup_unregistered','game-import-documents','__AUDIT_OWNER_UUID__/unregistered/audit.docx',uploader,false),
      ('knowledge_cleanup_unregistered','game-knowledge-documents','__AUDIT_OWNER_UUID__/unregistered/audit.txt',uploader,false),
      ('knowledge_read_own_unregistered','game-knowledge-documents','__AUDIT_OWNER_UUID__/unregistered/audit.txt',uploader,false)
    ) cases(policy_name,bucket,path,owner_id,expected)
  loop
    select qual into predicate from pg_policies where schemaname='storage' and tablename='objects' and policyname=item.policy_name;
    if predicate is null then raise exception 'Missing policy %',item.policy_name; end if;
    execute 'select '||predicate||' from (select $1::text as bucket_id,$2::text as name,$3::text as owner_id) objects'
      into allowed using item.bucket,item.path,item.owner_id;
    if allowed is distinct from item.expected then raise exception 'Unexpected policy result for % expected % received %',item.policy_name,item.expected,allowed; end if;
    checks:=checks+1;
  end loop;
  if private.can_cleanup_document_source('unknown',uploader||'/audit.txt',uploader)
    or private.can_cleanup_document_source('game-knowledge-documents',uploader||'/audit.txt',null)
    or private.can_cleanup_document_source('game-knowledge-documents',null,uploader)
    then raise exception 'Unknown bucket or missing ownership allowed cleanup'; end if;
  perform set_config('audit.result',(current_setting('audit.result')::jsonb||jsonb_build_object('policy_cases',checks,'checks','registered sources retained after membership removal; own unregistered cleanup/read allowed; foreign ownership/prefix denied; existing registered read behavior preserved'))::text,true);
end $matrix$;
reset role;
do $privileges$
begin
  if has_function_privilege('anon','private.can_cleanup_document_source(text,text,text)','EXECUTE')
    or not has_function_privilege('authenticated','private.can_cleanup_document_source(text,text,text)','EXECUTE')
    then raise exception 'Cleanup predicate role grants are incorrect'; end if;
end $privileges$;
select current_setting('audit.result')::jsonb as verification;
rollback;
