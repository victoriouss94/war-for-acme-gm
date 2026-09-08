-- Substitute __AUDIT_OWNER_UUID__ and __CLONE_FIXTURE_JSON__ in memory.
-- Generate JSON via cloneFixture() from tests/helpers/clone-role-mode-fixture.mjs.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $audit$
declare gid uuid:=gen_random_uuid(); payload jsonb; persisted jsonb; copied_role jsonb; mode jsonb; ability_id text;
begin
  payload:=replace($fixture$__CLONE_FIXTURE_JSON__$fixture$,'"new-1"','"'||gid::text||'"')::jsonb;
  payload:=jsonb_set(payload,'{data,gameId}',to_jsonb(gid::text));
  perform public.create_game(gid,payload);
  select gd.document into persisted from public.game_documents gd where gd.game_id=gid;
  if persisted#>'{data,roles}'<>payload#>'{data,roles}' then raise exception 'Copied roles changed in storage'; end if;
  copied_role:=persisted#>'{data,roles,0}';
  for mode in select value from jsonb_array_elements(copied_role->'modes') loop
    for ability_id in select value from jsonb_array_elements_text((mode->'abilityIds')||(mode->'passiveAbilityIds')) loop
      if not exists(select 1 from jsonb_array_elements(persisted#>'{data,abilities}') a where a->>'id'=ability_id) then raise exception 'Orphan mode ability'; end if;
    end loop;
  end loop;
  for ability_id in select value from jsonb_array_elements_text((copied_role->'roleWideAbilityIds')||(copied_role->'roleWidePassiveAbilityIds')) loop
    if not exists(select 1 from jsonb_array_elements(persisted#>'{data,abilities}') a where a->>'id'=ability_id) then raise exception 'Orphan wide ability'; end if;
  end loop;
  if not exists(select 1 from jsonb_array_elements(copied_role->'modes') m where m->>'id'=copied_role->>'startingModeId') then raise exception 'Orphan starting mode'; end if;
  if jsonb_array_length(persisted#>'{data,players}')<>0 or jsonb_array_length(persisted#>'{data,actions}')<>0 then raise exception 'Clone retained player progress'; end if;
  perform set_config('audit.clone_fixture_id',gid::text,true);
end $audit$;
select current_setting('audit.clone_fixture_id') as fixture_id,'copied mode cloud round trip passed' as result;
rollback;
