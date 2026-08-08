-- GM Command Center shared persistence, authorization, audit, and realtime.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.games (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  name text not null check (char_length(name) between 1 and 100),
  theme text not null default '' check (char_length(theme)<=120),
  description text not null default '' check (char_length(description)<=2000),
  status text not null default 'SETUP' check (status in ('SETUP','ACTIVE','PAUSED','COMPLETED','ARCHIVED')),
  share_code text not null unique default upper(substr(encode(gen_random_bytes(8),'hex'),1,10)),
  created_at timestamptz not null default now(), created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(), updated_by uuid not null references auth.users(id)
);
create table public.game_members (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null check (member_role in ('owner','gm','viewer')),
  created_at timestamptz not null default now(), primary key(game_id,user_id)
);
create table public.game_documents (
  game_id uuid primary key references public.games(id) on delete cascade,
  document jsonb not null, version integer not null default 1 check(version>0),
  updated_at timestamptz not null default now(), updated_by uuid not null references auth.users(id)
);
create table public.change_history (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  entity_type text not null check(char_length(entity_type) between 1 and 40), entity_id text,
  action text not null check(char_length(action) between 1 and 120),
  previous_data jsonb, new_data jsonb, created_at timestamptz not null default now()
);
create index game_members_user_idx on public.game_members(user_id);
create index change_history_game_created_idx on public.change_history(game_id,created_at desc);

create function public.is_game_member(target_game_id uuid) returns boolean language sql stable security definer set search_path=public
as $$select exists(select 1 from public.game_members where game_id=target_game_id and user_id=auth.uid())$$;
create function public.can_edit_game(target_game_id uuid) returns boolean language sql stable security definer set search_path=public
as $$select exists(select 1 from public.game_members where game_id=target_game_id and user_id=auth.uid() and member_role in ('owner','gm'))$$;
create function public.is_game_owner(target_game_id uuid) returns boolean language sql stable security definer set search_path=public
as $$select exists(select 1 from public.game_members where game_id=target_game_id and user_id=auth.uid() and member_role='owner')$$;

create function public.validate_game_document(target_game_id uuid,candidate jsonb) returns void language plpgsql set search_path=public as $$
declare section_name text; row_data jsonb;
begin
  if jsonb_typeof(candidate)<>'object' or candidate#>>'{game,id}'<>target_game_id::text or candidate#>>'{data,gameId}'<>target_game_id::text then
    raise exception using errcode='22023',message='The document does not belong to the selected game.';
  end if;
  if nullif(btrim(candidate#>>'{game,name}'),'') is null or char_length(candidate#>>'{game,name}')>100 then
    raise exception using errcode='22023',message='Game name must contain 1 to 100 characters.';
  end if;
  if coalesce(candidate#>>'{game,status}','') not in ('SETUP','ACTIVE','PAUSED','COMPLETED','ARCHIVED') then
    raise exception using errcode='22023',message='Invalid game status.';
  end if;
  foreach section_name in array array['factions','roles','players','actions','abilities','rules','history'] loop
    if jsonb_typeof(candidate#>array['data',section_name])<>'array' then raise exception using errcode='22023',message=format('%s must be an array.',section_name); end if;
    for row_data in select value from jsonb_array_elements(candidate#>array['data',section_name]) loop
      if row_data->>'gameId'<>target_game_id::text or nullif(row_data->>'id','') is null then raise exception using errcode='22023',message=format('Invalid or cross-game record in %s.',section_name); end if;
    end loop;
  end loop;
  if exists(select 1 from jsonb_array_elements(candidate#>'{data,players}') p where nullif(p->>'roleId','') is not null and not exists(select 1 from jsonb_array_elements(candidate#>'{data,roles}') r where r->>'id'=p->>'roleId')) then
    raise exception using errcode='23503',message='A player references a missing role. Archive referenced roles instead of deleting them.';
  end if;
end$$;

create function public.audit_snapshot(candidate jsonb,kind text,record_id text) returns jsonb language sql immutable as $$
select case when kind='game' then candidate->'game' when kind in ('role','rule','player','faction','ability','action') then
 (select value from jsonb_array_elements(candidate#>array['data',kind||'s']) where value->>'id'=record_id limit 1) else null end$$;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,display_name) values(new.id,coalesce(nullif(new.raw_user_meta_data->>'display_name',''),split_part(coalesce(new.email,'GM'),'@',1),'GM')) on conflict(id) do nothing; return new; end$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create function public.create_game(game_id uuid,initial_document jsonb)
returns table(id uuid,version integer,share_code text) language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception using errcode='28000',message='Authentication required.'; end if;
  perform public.validate_game_document(game_id,initial_document);
  insert into public.games(id,owner_id,name,theme,description,status,created_by,updated_by) values(game_id,auth.uid(),initial_document#>>'{game,name}',coalesce(initial_document#>>'{game,theme}',''),coalesce(initial_document#>>'{game,description}',''),initial_document#>>'{game,status}',auth.uid(),auth.uid());
  insert into public.game_members values(game_id,auth.uid(),'owner',now());
  insert into public.game_documents(game_id,document,updated_by) values(game_id,initial_document,auth.uid());
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(game_id,auth.uid(),'game',game_id::text,'Game created',initial_document->'game');
  return query select g.id,d.version,g.share_code from public.games g join public.game_documents d on d.game_id=g.id where g.id=$1;
end$$;

create function public.save_game_document(target_game_id uuid,expected_version integer,next_document jsonb,change_action text default 'Game updated',change_entity_type text default 'game',change_entity_id text default null)
returns table(document jsonb,version integer,updated_at timestamptz,updated_by uuid) language plpgsql security definer set search_path=public as $$
declare previous_document jsonb; actual_version integer; saved_at timestamptz:=now();
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='You do not have permission to edit this game.'; end if;
  if char_length(coalesce(change_action,'')) not between 1 and 120 or char_length(coalesce(change_entity_type,'')) not between 1 and 40 then raise exception using errcode='22023',message='Invalid audit metadata.'; end if;
  perform public.validate_game_document(target_game_id,next_document);
  select d.document,d.version into previous_document,actual_version from public.game_documents d where d.game_id=target_game_id for update;
  if not found then raise exception using errcode='P0002',message='Game document not found.'; end if;
  if actual_version<>expected_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  update public.game_documents d set document=next_document,version=d.version+1,updated_at=saved_at,updated_by=auth.uid() where d.game_id=target_game_id;
  update public.games g set name=next_document#>>'{game,name}',theme=coalesce(next_document#>>'{game,theme}',''),description=coalesce(next_document#>>'{game,description}',''),status=next_document#>>'{game,status}',updated_at=saved_at,updated_by=auth.uid() where g.id=target_game_id;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(target_game_id,auth.uid(),change_entity_type,change_entity_id,change_action,public.audit_snapshot(previous_document,change_entity_type,change_entity_id),public.audit_snapshot(next_document,change_entity_type,change_entity_id));
  return query select d.document,d.version,d.updated_at,d.updated_by from public.game_documents d where d.game_id=target_game_id;
end$$;

create function public.join_game_by_code(invite_code text) returns uuid language plpgsql security definer set search_path=public as $$
declare target_game_id uuid; begin
 if auth.uid() is null then raise exception using errcode='28000',message='Authentication required.'; end if;
 select id into target_game_id from public.games where share_code=upper(btrim(invite_code));
 if target_game_id is null then raise exception using errcode='P0002',message='Invite code not found.'; end if;
 insert into public.game_members(game_id,user_id,member_role) values(target_game_id,auth.uid(),'gm') on conflict do nothing; return target_game_id;
end$$;
create function public.delete_game(target_game_id uuid) returns void language plpgsql security definer set search_path=public as $$begin if not public.is_game_owner(target_game_id) then raise exception using errcode='42501',message='Only the owner can delete a game.'; end if; delete from public.games where id=target_game_id; end$$;

alter table public.profiles enable row level security; alter table public.games enable row level security; alter table public.game_members enable row level security; alter table public.game_documents enable row level security; alter table public.change_history enable row level security;
create policy profiles_read_shared on public.profiles for select to authenticated using(id=auth.uid() or exists(select 1 from public.game_members mine join public.game_members theirs on theirs.game_id=mine.game_id where mine.user_id=auth.uid() and theirs.user_id=profiles.id));
create policy profiles_update_self on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy games_read_member on public.games for select to authenticated using(public.is_game_member(id));
create policy members_read_member on public.game_members for select to authenticated using(public.is_game_member(game_id));
create policy documents_read_member on public.game_documents for select to authenticated using(public.is_game_member(game_id));
create policy history_read_member on public.change_history for select to authenticated using(public.is_game_member(game_id));
grant select on public.profiles,public.games,public.game_members,public.game_documents,public.change_history to authenticated;
grant update(display_name) on public.profiles to authenticated;
revoke all on function public.create_game(uuid,jsonb) from public; grant execute on function public.create_game(uuid,jsonb) to authenticated;
revoke all on function public.save_game_document(uuid,integer,jsonb,text,text,text) from public; grant execute on function public.save_game_document(uuid,integer,jsonb,text,text,text) to authenticated;
revoke all on function public.join_game_by_code(text) from public; grant execute on function public.join_game_by_code(text) to authenticated;
revoke all on function public.delete_game(uuid) from public; grant execute on function public.delete_game(uuid) to authenticated;
do $$ begin alter publication supabase_realtime add table public.game_documents; exception when duplicate_object then null; end $$;

create policy realtime_game_presence_read on realtime.messages for select to authenticated using(split_part((select realtime.topic()),':',1)='game' and public.is_game_member((split_part((select realtime.topic()),':',2))::uuid));
create policy realtime_game_presence_write on realtime.messages for insert to authenticated with check(split_part((select realtime.topic()),':',1)='game' and public.is_game_member((split_part((select realtime.topic()),':',2))::uuid));
