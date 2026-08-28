-- The first complete rebuild could only recover legacy placeholders for roles
-- that had not already been relinked. Restore the exact per-mode source text
-- for the three roles previously migrated in v11.7.

do $$
declare
  stored public.game_documents%rowtype;
  doc jsonb;
  roles jsonb;
  next_roles jsonb := '[]'::jsonb;
  role_item jsonb;
  mode_item jsonb;
  next_modes jsonb;
  next_mode jsonb;
begin
  select gd.* into stored
  from public.game_documents gd
  where exists (
    select 1 from jsonb_array_elements(coalesce(gd.document#>'{data,imports}','[]'::jsonb)) import_item
    where import_item->>'kind'='source-role-mode-rebuild-v11.7.1'
  )
  for update;
  if not found then raise exception 'Transformers source-role rebuild was not found'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(stored.document#>'{data,history}','[]'::jsonb)) item where item->>'entityId'='transformers-exact-mode-text-v11.7.1') then return; end if;

  doc:=stored.document;
  roles:=coalesce(doc#>'{data,roles}','[]'::jsonb);
  for role_item in select value from jsonb_array_elements(roles) loop
    if role_item->>'name' not in ('Den Blocker – Ironhide','Doc – Ratchet','Ultimate – Optimus') then
      next_roles:=next_roles||jsonb_build_array(role_item);
      continue;
    end if;
    next_modes:='[]'::jsonb;
    for mode_item in select value from jsonb_array_elements(role_item->'modes') loop
      next_mode:=mode_item;
      if role_item->>'name'='Den Blocker – Ironhide' and mode_item->>'name'='Robot Mode' then
        next_mode:=mode_item||jsonb_build_object('sourceText','Guards one player a night, reflects one action against them off them for the night back to that visitor(wheel spun), while in Robot Mode the first attack on him he will survive but it damages his plates, he needs 48 hours to fully heal before absorbing another hit','sourceLocation','Transformers — Den Blocker – Ironhide — Robot Mode');
      elsif role_item->>'name'='Den Blocker – Ironhide' and mode_item->>'name'='Alt Mode' then
        next_mode:=mode_item||jsonb_build_object('sourceText','Uses his barracades to block the den (1 time use), loses his protective plates while in alt mode','sourceLocation','Transformers — Den Blocker – Ironhide — Alt Mode');
      elsif role_item->>'name'='Doc – Ratchet' and mode_item->>'name'='Robot Mode' then
        next_mode:=mode_item||jsonb_build_object('sourceText','Has 2 saves, 1 heal','sourceLocation','Transformers — Doc – Ratchet — Robot Mode');
      elsif role_item->>'name'='Doc – Ratchet' and mode_item->>'name'='Alt Mode' then
        next_mode:=mode_item||jsonb_build_object('sourceText','Can choose a player to protect that night, lasts through hanging (24 hour cooldown)','sourceLocation','Transformers — Doc – Ratchet — Alt Mode');
      elsif role_item->>'name'='Ultimate – Optimus' and mode_item->>'name'='Robot Mode' then
        next_mode:=mode_item||jsonb_build_object('sourceText','Each night can choose a basic ask, protect(1 time), block(1 time), has 1 save while in robot mode, immune to night kills and conversion while in robot mode','sourceLocation','Transformers — Ultimate – Optimus — Robot Mode');
      elsif role_item->>'name'='Ultimate – Optimus' and mode_item->>'name'='Alt Mode' then
        next_mode:=mode_item||jsonb_build_object('sourceText','Has 1 standard instakill and 1 superkill, when in alt mode loses immunity to night kills, can not be converted','sourceLocation','Transformers — Ultimate – Optimus — Alt Mode');
      end if;
      next_modes:=next_modes||jsonb_build_array(next_mode);
    end loop;
    next_roles:=next_roles||jsonb_build_array(role_item||jsonb_build_object('modes',next_modes));
  end loop;

  doc:=jsonb_set(doc,'{data,roles}',next_roles,false);
  doc:=jsonb_set(doc,'{data,history}',coalesce(doc#>'{data,history}','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid()::text,'gameId',stored.game_id::text,'type','DOCUMENT_ROLE_REBUILD','entityId','transformers-exact-mode-text-v11.7.1',
    'message','Restored exact Robot/Alt source text for Ironhide, Ratchet, and Optimus after the complete role rebuild.','timestamp',now()
  )),true);
  update public.game_documents set document=doc,version=version+1,updated_at=now() where game_id=stored.game_id;
end$$;
