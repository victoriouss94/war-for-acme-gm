revoke execute on function public.rls_auto_enable() from public,anon,authenticated;

create function public.set_game_member_role(target_game_id uuid,target_user_id uuid,next_role text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_game_owner(target_game_id) then raise exception using errcode='42501',message='Only the owner can change member roles.'; end if;
  if next_role not in ('gm','viewer') then raise exception using errcode='22023',message='Member role must be gm or viewer.'; end if;
  update public.game_members set member_role=next_role where game_id=target_game_id and user_id=target_user_id and member_role<>'owner';
  if not found then raise exception using errcode='P0002',message='Editable member not found.'; end if;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(target_game_id,auth.uid(),'member',target_user_id::text,'Member permission changed',jsonb_build_object('member_role',next_role));
end$$;
revoke execute on function public.set_game_member_role(uuid,uuid,text) from public,anon;
grant execute on function public.set_game_member_role(uuid,uuid,text) to authenticated;
