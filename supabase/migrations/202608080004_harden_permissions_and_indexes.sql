create or replace function public.audit_snapshot(candidate jsonb,kind text,record_id text) returns jsonb language sql immutable set search_path=public as $$
select case when kind='game' then candidate->'game' when kind in ('role','rule','player','faction','ability','action') then
 (select value from jsonb_array_elements(candidate#>array['data',kind||'s']) where value->>'id'=record_id limit 1) else null end$$;

revoke execute on function public.handle_new_user() from public,anon,authenticated;
revoke execute on function public.audit_snapshot(jsonb,text,text) from public,anon,authenticated;
revoke execute on function public.validate_game_document(uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.is_game_member(uuid) from public,anon;
revoke execute on function public.can_edit_game(uuid) from public,anon;
revoke execute on function public.is_game_owner(uuid) from public,anon;
revoke execute on function public.create_game(uuid,jsonb) from public,anon;
revoke execute on function public.save_game_document(uuid,integer,jsonb,text,text,text) from public,anon;
revoke execute on function public.join_game_by_code(text) from public,anon;
revoke execute on function public.delete_game(uuid) from public,anon;
grant execute on function public.is_game_member(uuid),public.can_edit_game(uuid),public.is_game_owner(uuid) to authenticated;
grant execute on function public.create_game(uuid,jsonb),public.save_game_document(uuid,integer,jsonb,text,text,text),public.join_game_by_code(text),public.delete_game(uuid) to authenticated;

drop policy profiles_read_shared on public.profiles;
drop policy profiles_update_self on public.profiles;
create policy profiles_read_shared on public.profiles for select to authenticated using(id=(select auth.uid()) or exists(select 1 from public.game_members mine join public.game_members theirs on theirs.game_id=mine.game_id where mine.user_id=(select auth.uid()) and theirs.user_id=profiles.id));
create policy profiles_update_self on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));

create index change_history_user_idx on public.change_history(user_id);
create index game_documents_updated_by_idx on public.game_documents(updated_by);
create index games_owner_idx on public.games(owner_id);
create index games_created_by_idx on public.games(created_by);
create index games_updated_by_idx on public.games(updated_by);
