-- Substitute __AUDIT_OWNER_UUID__ and __LINKED_CLONE_JSON__ in memory.
-- Generate with cloneFixture(withLinkedMechanics), using the two helpers under tests/helpers/.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $audit$
declare gid uuid:=gen_random_uuid(); payload jsonb; persisted jsonb; role_row jsonb; ability_row jsonb; faction_row jsonb;
begin
  payload:=replace($fixture$__LINKED_CLONE_JSON__$fixture$,'"new-1"','"'||gid::text||'"')::jsonb;
  payload:=jsonb_set(payload,'{data,gameId}',to_jsonb(gid::text));
  perform public.create_game(gid,payload);
  select gd.document into persisted from public.game_documents gd where gd.game_id=gid;
  if persisted#>'{data,roles}'<>payload#>'{data,roles}' or persisted#>'{data,abilities}'<>payload#>'{data,abilities}' or persisted#>'{data,rules}'<>payload#>'{data,rules}' then raise exception 'Copy data changed in storage'; end if;
  role_row:=persisted#>'{data,roles,0}'; faction_row:=persisted#>'{data,factions,0}';
  select a into ability_row from jsonb_array_elements(persisted#>'{data,abilities}') a where a->>'name'='Ask';
  if ability_row#>>'{understanding,sourceFactionIds,0}'<>faction_row->>'id'
    or ability_row#>>'{understanding,targeting,targetRoleRestrictions,0}'<>role_row->>'id'
    or ability_row#>>'{understanding,mechanics,0,sourceRoleId}'<>role_row->>'id'
    or ability_row#>>'{understanding,mechanics,0,sourceAbilityId}'<>ability_row->>'id'
    or role_row#>>'{mechanicalStatements,0,source_role_id}'<>role_row->>'id'
    then raise exception 'Nested copy references not closed'; end if;
  if ability_row#>>'{understanding,mechanics,0,sourceDocumentId}'<>'source-document'
    or ability_row#>>'{understanding,mechanics,0,originalText}'<>'ask village audit-role'
    or ability_row#>>'{understanding,mechanics,0,baseStandardAbilityId}'<>'global:ask'
    then raise exception 'Source evidence or global standard changed'; end if;
  perform set_config('audit.linked_clone_id',gid::text,true);
  perform set_config('audit.linked_clone_document',persisted::text,true);
end $audit$;
select current_setting('audit.linked_clone_id') as fixture_id,current_setting('audit.linked_clone_document')::jsonb as document;
rollback;
