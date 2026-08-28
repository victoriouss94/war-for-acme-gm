-- Ensure the two source modes with active control/mark actions expose a real
-- selectable encyclopedia action in addition to their passive protection.

do $$
declare
  stored public.game_documents%rowtype;
  doc jsonb;
  roles jsonb;
  abilities jsonb;
  next_roles jsonb := '[]'::jsonb;
  role_item jsonb;
  mode_item jsonb;
  next_modes jsonb;
  next_mode jsonb;
  mark_id text;
  roleblock_id text;
  bulletproof_id text;
  death_immunity_id text;
begin
  select gd.* into stored from public.game_documents gd
  where exists(select 1 from jsonb_array_elements(coalesce(gd.document#>'{data,imports}','[]'::jsonb)) item where item->>'kind'='source-role-mode-rebuild-v11.7.1')
  for update;
  if not found then raise exception 'Transformers source-role rebuild was not found'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,history}','[]'::jsonb)) item where item->>'entityId'='transformers-complete-active-modes-v11.7.1') then return; end if;
  doc:=stored.document;roles:=doc#>'{data,roles}';abilities:=doc#>'{data,abilities}';
  select value->>'id' into mark_id from jsonb_array_elements(abilities) where lower(value->>'name')='mark' limit 1;
  select value->>'id' into roleblock_id from jsonb_array_elements(abilities) where lower(value->>'name')='roleblock' limit 1;
  select value->>'id' into bulletproof_id from jsonb_array_elements(abilities) where lower(value->>'name')='bulletproof / passive immunity' limit 1;
  select value->>'id' into death_immunity_id from jsonb_array_elements(abilities) where lower(value->>'name')='death immunity' limit 1;
  if mark_id is null or roleblock_id is null or bulletproof_id is null or death_immunity_id is null then raise exception 'Required encyclopedia abilities are missing'; end if;

  for role_item in select value from jsonb_array_elements(roles) loop
    if role_item->>'name' not in ('Mark/Soul Bound – Bombshell','Lawyer – Bluestreak') then next_roles:=next_roles||jsonb_build_array(role_item);continue;end if;
    next_modes:='[]'::jsonb;
    for mode_item in select value from jsonb_array_elements(role_item->'modes') loop
      next_mode:=mode_item;
      if role_item->>'name'='Mark/Soul Bound – Bombshell' and mode_item->>'name'='Alt Mode' then
        next_mode:=mode_item||jsonb_build_object('abilityIds',jsonb_build_array(mark_id),'passiveAbilityIds',jsonb_build_array(death_immunity_id));
      elsif role_item->>'name'='Lawyer – Bluestreak' and mode_item->>'name'='Alt Mode' then
        next_mode:=mode_item||jsonb_build_object('abilityIds',jsonb_build_array(roleblock_id),'passiveAbilityIds',jsonb_build_array(bulletproof_id));
      end if;
      next_modes:=next_modes||jsonb_build_array(next_mode);
    end loop;
    if role_item->>'name'='Lawyer – Bluestreak' then
      role_item:=role_item||jsonb_build_object('tags',jsonb_build_array('Save','Roleblock','Bulletproof / Passive Immunity'));
    end if;
    next_roles:=next_roles||jsonb_build_array(role_item||jsonb_build_object('modes',next_modes));
  end loop;
  doc:=jsonb_set(doc,'{data,roles}',next_roles,false);
  doc:=jsonb_set(doc,'{data,history}',coalesce(doc#>'{data,history}','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid()::text,'gameId',stored.game_id::text,'type','DOCUMENT_ROLE_REBUILD','entityId','transformers-complete-active-modes-v11.7.1',
    'message','Completed Bombshell Alt Mark and Bluestreak Alt control action mappings while retaining their source-defined passives.','timestamp',now()
  )),true);
  update public.game_documents set document=doc,version=version+1,updated_at=now() where game_id=stored.game_id;
end$$;
