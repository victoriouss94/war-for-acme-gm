-- Metadata-only fixture, no Storage bytes or provider calls. All rows roll back.
-- Substitute an existing owner UUID in memory. Candidate DDL may be inserted
-- after BEGIN for pre-deployment transactional verification.
begin;
-- __CANDIDATE_DDL__
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $setup$
declare gid uuid:=gen_random_uuid();
begin
  perform public.create_game(gid,jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback ingestion claim audit','status','SETUP','currentDay',0,'currentPhase','Night'),'data',jsonb_build_object('gameId',gid,'players','[]'::jsonb,'roles','[]'::jsonb,'abilities','[]'::jsonb,'factions','[]'::jsonb,'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb)));
  perform set_config('audit.game_id',gid::text,true);
end $setup$;
reset role;
do $metadata$
declare gid uuid:=current_setting('audit.game_id')::uuid; did uuid:=gen_random_uuid(); vids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()]; vid uuid; ix integer:=0;
begin
  insert into public.official_documents(id,document_key,game_id,title,document_type,created_by,scope,owner_id)
    values(did,'claim-audit-'||did::text,gid,'Synthetic claim reference','CUSTOM','__AUDIT_OWNER_UUID__','GAME_SPECIFIC','__AUDIT_OWNER_UUID__');
  foreach vid in array vids loop
    ix:=ix+1;
    insert into public.official_document_versions(id,document_id,version_number,status,requested_status,source_file_name,storage_path,content_type,file_size,created_by)
      values(vid,did,ix,'PROCESSING','DRAFT','synthetic.txt','synthetic/no-file-'||vid::text,'text/plain',1,'__AUDIT_OWNER_UUID__');
  end loop;
  perform set_config('audit.version_ids',to_jsonb(vids)::text,true);
end $metadata$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $claims$
declare vids jsonb:=current_setting('audit.version_ids')::jsonb; v1 uuid:=(vids->>0)::uuid; v2 uuid:=(vids->>1)::uuid; v3 uuid:=(vids->>2)::uuid;
  owner_id uuid:='__AUDIT_OWNER_UUID__'; claim1 uuid:=gen_random_uuid(); claim2 uuid:=gen_random_uuid(); denied boolean; chunks jsonb;
begin
  chunks:=jsonb_build_array(jsonb_build_object('heading','Synthetic','source_locator','1','content','Synthetic rule','token_estimate',3,'embedding',to_jsonb(array_fill(0.01::float8,array[1536]))));
  denied:=false;
  begin perform public.claim_knowledge_ingestion_internal(v1,gen_random_uuid(),gen_random_uuid()); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Nonmember claimed document'; end if;
  if not public.claim_knowledge_ingestion_internal(v1,owner_id,claim1) then raise exception 'First worker did not claim'; end if;
  if public.claim_knowledge_ingestion_internal(v1,owner_id,gen_random_uuid()) or public.claim_knowledge_ingestion_internal(v1,owner_id,claim1) then raise exception 'Duplicate worker claimed'; end if;
  denied:=false;
  begin perform public.complete_claimed_knowledge_ingestion_internal(v1,'Synthetic','Summary',chunks,owner_id,gen_random_uuid()); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Wrong claim completed'; end if;
  denied:=false;
  begin perform public.fail_claimed_knowledge_ingestion_internal(v1,'Wrong worker',owner_id,gen_random_uuid()); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Wrong claim failed owner'; end if;
  denied:=false;
  begin perform public.fail_knowledge_ingestion_internal(v1,'Legacy worker',owner_id); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Legacy worker failed claimed version'; end if;
  denied:=false;
  begin perform public.complete_knowledge_ingestion_internal(v1,'Synthetic','Summary',chunks,owner_id); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Legacy worker completed claimed version'; end if;
  if (select status from public.official_document_versions where id=v1)<>'PROCESSING' then raise exception 'Rejected worker changed status'; end if;
  perform public.complete_claimed_knowledge_ingestion_internal(v1,'Synthetic','Summary',chunks,owner_id,claim1);
  if (select status from public.official_document_versions where id=v1)<>'DRAFT' or (select count(*) from public.official_document_chunks where document_version_id=v1)<>1 then raise exception 'Correct completion failed'; end if;
  perform public.fail_claimed_knowledge_ingestion_internal(v1,'Late catch after completed',owner_id,claim1);
  if (select status from public.official_document_versions where id=v1)<>'DRAFT' then raise exception 'Late failure corrupted completed version'; end if;
  denied:=false;
  begin perform public.complete_claimed_knowledge_ingestion_internal(v1,'Synthetic','Summary',chunks,owner_id,claim1); exception when invalid_parameter_value then denied:=true; end;
  if not denied or (select count(*) from public.official_document_chunks where document_version_id=v1)<>1 then raise exception 'Completion replay duplicated chunks'; end if;
  if not public.claim_knowledge_ingestion_internal(v2,owner_id,claim2) then raise exception 'Independent version could not claim'; end if;
  perform public.fail_claimed_knowledge_ingestion_internal(v2,'Synthetic failure',owner_id,claim2);
  if (select status from public.official_document_versions where id=v2)<>'FAILED' or public.claim_knowledge_ingestion_internal(v2,owner_id,gen_random_uuid()) then raise exception 'Failed attempt replayed'; end if;
  -- Pre-deployment compatibility: an unclaimed version can still finish once.
  perform public.complete_knowledge_ingestion_internal(v3,'Synthetic','Summary',chunks,owner_id);
  if (select status from public.official_document_versions where id=v3)<>'DRAFT' then raise exception 'Unclaimed legacy completion broke'; end if;
end $claims$;
reset role;
do $security$
declare signature text; signatures text[]:=array['public.claim_knowledge_ingestion_internal(uuid,uuid,uuid)','public.complete_claimed_knowledge_ingestion_internal(uuid,text,text,jsonb,uuid,uuid)','public.fail_claimed_knowledge_ingestion_internal(uuid,text,uuid,uuid)'];
begin
  foreach signature in array signatures loop
    if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE') or not has_function_privilege('service_role',signature,'EXECUTE') then raise exception 'Unsafe function ACL %',signature; end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid='private.knowledge_ingestion_claims'::regclass)
    or has_table_privilege('authenticated','private.knowledge_ingestion_claims','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role','private.knowledge_ingestion_claims','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Unsafe claim table access'; end if;
  if (select count(*) from private.knowledge_ingestion_claims where version_id in(select (value#>>'{}')::uuid from jsonb_array_elements(current_setting('audit.version_ids')::jsonb)))<>2 then raise exception 'Unexpected claim count'; end if;
end $security$;
select jsonb_build_object('game_id',current_setting('audit.game_id'),'version_ids',current_setting('audit.version_ids')::jsonb,'checks','exclusive durable claim; duplicate/same-token denied; current GM required; stale and legacy token fenced; one completion; late failure harmless; independent version; failed-version not replayed; legacy unclaimed compatibility; service-only ACL; private RLS') as verification;
rollback;
