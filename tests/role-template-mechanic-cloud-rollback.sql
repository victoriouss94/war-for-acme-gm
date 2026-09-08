-- Substitute __AUDIT_OWNER_UUID__ and __NESTED_TEMPLATE_JSON__ in memory.
-- Generate with linkedTemplate() from tests/helpers/role-template-linked-fixture.mjs.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $audit$
declare gid uuid:=gen_random_uuid(); fixture jsonb:=$fixture$__NESTED_TEMPLATE_JSON__$fixture$::jsonb; initial_document jsonb; candidate jsonb;
  before_row record; saved record; persisted jsonb; copied_role jsonb; expected_roles jsonb;
begin
  select jsonb_agg(role||jsonb_build_object('gameId',gid,'updatedBy',auth.uid())) into expected_roles from jsonb_array_elements(fixture->'roles') role;
  initial_document:=jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback nested role template audit','status','SETUP','currentDay',0,'currentPhase','Night'),
    'data',jsonb_build_object('gameId',gid,'roles',jsonb_build_array(expected_roles->0),'abilities',fixture->'abilities','factions',fixture->'factions','players','[]'::jsonb,'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb));
  perform public.create_game(gid,initial_document);
  select gd.document,gd.version into before_row from public.game_documents gd where gd.game_id=gid;
  candidate:=jsonb_set(before_row.document,'{data,roles}',expected_roles);
  select * into saved from public.save_game_document(gid,before_row.version,candidate,'Add linked role template','role','new-template-role');
  select gd.document into persisted from public.game_documents gd where gd.game_id=gid;
  if persisted#>'{data,roles}'<>expected_roles or saved.version<>before_row.version+1 then raise exception 'Template changed during persistence'; end if;
  copied_role:=persisted#>'{data,roles,1}';
  if copied_role#>>'{understanding,mechanics,0,sourceRoleId}'<>copied_role->>'id'
    or copied_role#>>'{understanding,mechanics,0,sourceAbilityId}'<>'dest-ask'
    or copied_role#>>'{understanding,mechanics,0,targeting,targetRoleRestrictions,0}'<>'dest-other-role'
    or copied_role#>>'{understanding,mechanics,0,targeting,targetFactionRestrictions,0}'<>'destination-faction'
    or copied_role#>>'{metadata,modeId}'<>copied_role#>>'{modes,1,id}' then raise exception 'Nested template references wrong'; end if;
  if copied_role#>>'{understanding,mechanics,0,sourceDocumentId}'<>'source-document'
    or copied_role#>>'{understanding,mechanics,0,baseStandardAbilityId}'<>'global:ask' then raise exception 'Source provenance changed'; end if;
  perform set_config('audit.nested_template_id',gid::text,true);
  perform set_config('audit.nested_template_document',persisted::text,true);
end $audit$;
select current_setting('audit.nested_template_id') as fixture_id,current_setting('audit.nested_template_document')::jsonb as document;
rollback;
