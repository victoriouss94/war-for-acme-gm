-- Substitute __AUDIT_OWNER_UUID__ and __ROLE_EDITOR_FIXTURE_JSON__ in memory.
-- The JSON is generated through tests/helpers/role-editor-fixture.mjs (actual app form).
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $audit$
declare
  gid uuid:=gen_random_uuid(); fixture jsonb:=$fixture$__ROLE_EDITOR_FIXTURE_JSON__$fixture$::jsonb;
  initial_document jsonb; candidate jsonb; before_row record; saved record; reread record;
  denied boolean:=false;
begin
  initial_document:=jsonb_build_object(
    'game',jsonb_build_object('id',gid,'name','Rollback role editor audit','status','SETUP','currentDay',0,'currentPhase','Night'),
    'data',jsonb_build_object('gameId',gid,
      'roles',jsonb_build_array((fixture->'original')||jsonb_build_object('gameId',gid)),
      'abilities',fixture->'abilities','factions',jsonb_build_array(jsonb_build_object('id','village','gameId',gid,'name','Village')),
      'players',jsonb_build_array(jsonb_build_object('id','audit-player','gameId',gid,'name','Audit Player','roleId','audit-role','alive',true,'currentModeId','import:alt')),
      'actions','[]'::jsonb,'history','[]'::jsonb,'rules','[]'::jsonb));
  perform public.create_game(gid,initial_document);
  select gd.document,gd.version into before_row from public.game_documents gd where gd.game_id=gid;
  candidate:=jsonb_set(before_row.document,'{data,roles}',jsonb_build_array((fixture->'updated')||jsonb_build_object('gameId',gid)));
  select * into saved from public.save_game_document(gid,before_row.version,candidate,'Notes-only role edit','role','audit-role');
  select gd.document,gd.version into reread from public.game_documents gd where gd.game_id=gid;
  if saved.version<>before_row.version+1 or reread.version<>saved.version then raise exception 'Version mismatch'; end if;
  if reread.document#>'{data,roles}'<>candidate#>'{data,roles}' then raise exception 'Persisted role changed'; end if;
  if reread.document#>'{data,players}'<>before_row.document#>'{data,players}' then raise exception 'Player state changed'; end if;
  if reread.document#>>'{data,roles,0,modes,1,id}'<>'import:alt'
    or reread.document#>>'{data,roles,0,modes,1,abilityUses,guard}'<>'2'
    or reread.document#>>'{data,roles,0,modes,1,investigationAppearance,basicAsk}'<>'Neutral'
    or reread.document#>>'{data,players,0,currentModeId}'<>'import:alt'
    or jsonb_array_length(reread.document#>'{data,roles,0,roleWidePassiveAbilityIds}')<>2
    then raise exception 'Mode or passive metadata lost'; end if;
  begin perform public.save_game_document(gid,before_row.version,before_row.document,'Stale role edit','role','audit-role');
  exception when sqlstate 'PT422' then denied:=sqlerrm='VERSION_CONFLICT'; end;
  if not denied then raise exception 'Stale role save accepted'; end if;
  if (select gd.document from public.game_documents gd where gd.game_id=gid)<>reread.document then raise exception 'Stale save overwrote role'; end if;
  perform set_config('audit.role_fixture_id',gid::text,true);
end $audit$;
select current_setting('audit.role_fixture_id') as fixture_id,'role editor cloud round trip passed' as result;
rollback;
