-- Substitute __AUDIT_OWNER_UUID__ and __TEMPLATE_FIXTURE_JSON__ in memory.
-- Generate fixtures with templateFixture({basic:false/true}) in tests/helpers/role-template-fixture.mjs.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $audit$
declare fixtures jsonb:=$fixture$__TEMPLATE_FIXTURE_JSON__$fixture$::jsonb; fixture jsonb; gid uuid; initial_document jsonb; candidate jsonb;
  expected_role jsonb; saved record; before_row record; actual jsonb; ids jsonb:='[]';
begin
  for fixture in select value from jsonb_array_elements(fixtures) loop
    gid:=gen_random_uuid();
    initial_document:=jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback role template audit','status','SETUP','currentDay',0,'currentPhase','Night'),
      'data',jsonb_build_object('gameId',gid,'roles','[]'::jsonb,'abilities',fixture->'abilities','factions',fixture->'factions','players','[]'::jsonb,'actions','[]'::jsonb,'history','[]'::jsonb,'rules','[]'::jsonb));
    perform public.create_game(gid,initial_document);
    select gd.document,gd.version into before_row from public.game_documents gd where gd.game_id=gid;
    expected_role:=(fixture->'role')||jsonb_build_object('gameId',gid,'updatedBy',auth.uid());
    candidate:=jsonb_set(before_row.document,'{data,roles}',jsonb_build_array(expected_role));
    select * into saved from public.save_game_document(gid,before_row.version,candidate,'Add copied role template','role',expected_role->>'id');
    select gd.document#>'{data,roles,0}' into actual from public.game_documents gd where gd.game_id=gid;
    if actual<>expected_role or saved.version<>before_row.version+1 then raise exception 'Template changed during persistence'; end if;
    if actual->>'slotCount'<>'4' then raise exception 'Template slots lost'; end if;
    if actual->>'roleType'='BASIC' then
      if actual->>'abilityDataStatus'<>'INTENTIONALLY_NONE' or jsonb_array_length(actual->'tags')<>0 or jsonb_array_length(actual->'modes')<>0 then raise exception 'Basic template gained abilities'; end if;
    else
      if jsonb_array_length(actual->'modes')<>2 or actual->>'modeSelectionPolicy'<>'CHOOSE_BEFORE_ACTION'
        or actual->>'startingModeId'<>actual#>>'{modes,1,id}'
        or actual#>>'{modes,1,abilityUses,dest-guard}'<>'2'
        or actual#>>'{modes,1,investigationAppearance,basicAsk}'<>'Neutral'
        or jsonb_array_length(actual->'roleWidePassiveAbilityIds')<>2 then raise exception 'Standard template lost configuration'; end if;
    end if;
    ids:=ids||to_jsonb(gid::text);
  end loop;
  perform set_config('audit.template_ids',ids::text,true);
end $audit$;
select current_setting('audit.template_ids')::jsonb as fixture_ids,'Standard and Basic template cloud round trip passed' as result;
rollback;
