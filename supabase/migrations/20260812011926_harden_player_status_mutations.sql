-- Run public player-status mutations as the caller under RLS and validate every write in a private trigger.
create or replace function private.validate_player_status_effect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception using errcode='28000',message='AUTHENTICATION_REQUIRED'; end if;
  if tg_op='UPDATE' and (new.id<>old.id or new.game_id<>old.game_id or new.player_id<>old.player_id or new.created_at<>old.created_at or new.created_by is distinct from old.created_by)
  then raise exception using errcode='22023',message='STATUS_IDENTITY_IMMUTABLE'; end if;
  if not exists(
    select 1 from public.game_documents document_row cross join lateral jsonb_array_elements(document_row.document#>'{data,players}') player
    where document_row.game_id=new.game_id and player->>'id'=new.player_id
  ) then raise exception using errcode='23503',message='PLAYER_NOT_FOUND'; end if;
  if new.subject_user_id is not null and not exists(select 1 from public.game_members member where member.game_id=new.game_id and member.user_id=new.subject_user_id)
  then raise exception using errcode='23503',message='STATUS_OWNER_NOT_GAME_MEMBER'; end if;
  if new.source_player_id is not null and not exists(
    select 1 from public.game_documents document_row cross join lateral jsonb_array_elements(document_row.document#>'{data,players}') player
    where document_row.game_id=new.game_id and player->>'id'=new.source_player_id
  ) then raise exception using errcode='23503',message='STATUS_SOURCE_PLAYER_NOT_FOUND'; end if;
  if new.source_role_id is not null and not exists(
    select 1 from public.game_documents document_row cross join lateral jsonb_array_elements(document_row.document#>'{data,roles}') role
    where document_row.game_id=new.game_id and role->>'id'=new.source_role_id
  ) then raise exception using errcode='23503',message='STATUS_SOURCE_ROLE_NOT_FOUND'; end if;
  if new.source_ability_id is not null and not exists(
    select 1 from public.game_documents document_row cross join lateral jsonb_array_elements(document_row.document#>'{data,abilities}') ability
    where document_row.game_id=new.game_id and ability->>'id'=new.source_ability_id
  ) then raise exception using errcode='23503',message='STATUS_SOURCE_ABILITY_NOT_FOUND'; end if;
  if tg_op='INSERT' then new.created_at:=now();new.created_by:=(select auth.uid()); end if;
  new.updated_at:=now();new.updated_by:=(select auth.uid());
  return new;
end $$;

revoke all on function private.validate_player_status_effect() from public,anon,authenticated,service_role;
create trigger validate_player_status_effect
before insert or update on public.player_status_effects
for each row execute function private.validate_player_status_effect();

alter function public.mutate_player_status(uuid,uuid,text,jsonb) security invoker;
alter function public.apply_player_status_changes(uuid,jsonb) security invoker;
grant select,insert,update on public.player_status_effects to authenticated;
revoke delete,truncate,references,trigger on public.player_status_effects from authenticated,anon;
