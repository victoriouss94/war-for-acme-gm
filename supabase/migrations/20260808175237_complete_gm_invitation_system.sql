-- Persisted, owner-managed invitations and atomic shared-game membership redemption.
alter table public.game_members
  add column invited_by uuid references auth.users(id) on delete set null;

-- Repair legacy ownership before enforcing one permanent owner membership per game.
update public.game_members member
set member_role='gm'
from public.games game
where member.game_id=game.id
  and member.member_role='owner'
  and member.user_id<>game.owner_id;

insert into public.game_members(game_id,user_id,member_role,created_at,invited_by)
select game.id,game.owner_id,'owner',game.created_at,null
from public.games game
on conflict(game_id,user_id) do update
set member_role='owner',invited_by=null;

create unique index game_members_one_owner_idx
  on public.game_members(game_id)
  where member_role='owner';
create index game_members_invited_by_idx
  on public.game_members(invited_by)
  where invited_by is not null;

create table public.game_invites (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  code text not null unique check (
    code=upper(code)
    and code~'^[A-Z0-9]{1,8}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$'
  ),
  permission text not null check (permission in ('gm','viewer')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses between 1 and 1000),
  use_count integer not null default 0 check (use_count>=0),
  revoked boolean not null default false,
  revoked_at timestamptz,
  last_used_at timestamptz,
  check (max_uses is null or use_count<=max_uses),
  check ((revoked and revoked_at is not null) or (not revoked and revoked_at is null))
);

create index game_invites_active_game_idx
  on public.game_invites(game_id,created_at desc)
  where revoked=false;
create index game_invites_created_by_idx on public.game_invites(created_by);

alter table public.game_invites enable row level security;
create policy game_invites_owner_read on public.game_invites
  for select to authenticated
  using ((select public.is_game_owner(game_id)));
grant select on public.game_invites to authenticated;

-- Harden the membership helpers used by RLS and privileged RPCs.
create or replace function public.is_game_member(target_game_id uuid)
returns boolean
language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.game_members member
    where member.game_id=target_game_id
      and member.user_id=(select auth.uid())
  )
$$;

create or replace function public.can_edit_game(target_game_id uuid)
returns boolean
language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.game_members member
    where member.game_id=target_game_id
      and member.user_id=(select auth.uid())
      and member.member_role in ('owner','gm')
  )
$$;

create or replace function public.is_game_owner(target_game_id uuid)
returns boolean
language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.game_members member
    where member.game_id=target_game_id
      and member.user_id=(select auth.uid())
      and member.member_role='owner'
  )
$$;

-- The new nullable invited_by column requires an explicit member column list.
create or replace function public.create_game(game_id uuid,initial_document jsonb)
returns table(id uuid,version integer,share_code text)
language plpgsql security definer set search_path=''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode='28000',message='Authentication required.';
  end if;
  perform public.validate_game_document(game_id,initial_document);
  insert into public.games(id,owner_id,name,theme,description,status,created_by,updated_by)
  values(
    game_id,(select auth.uid()),initial_document#>>'{game,name}',
    coalesce(initial_document#>>'{game,theme}',''),
    coalesce(initial_document#>>'{game,description}',''),
    initial_document#>>'{game,status}',(select auth.uid()),(select auth.uid())
  );
  insert into public.game_members(game_id,user_id,member_role,created_at,invited_by)
  values(game_id,(select auth.uid()),'owner',now(),null);
  insert into public.game_documents(game_id,document,updated_by)
  values(game_id,initial_document,(select auth.uid()));
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(game_id,(select auth.uid()),'game',game_id::text,'Game created',initial_document->'game');
  return query
  select game.id,document.version,game.share_code
  from public.games game
  join public.game_documents document on document.game_id=game.id
  where game.id=$1;
end
$$;

create function public.generate_game_invite(
  target_game_id uuid,
  invite_permission text,
  expires_in_seconds integer,
  requested_max_uses integer
)
returns table(
  id uuid,
  game_id uuid,
  code text,
  permission text,
  created_at timestamptz,
  expires_at timestamptz,
  max_uses integer,
  use_count integer,
  revoked boolean,
  last_used_at timestamptz
)
language plpgsql security definer set search_path=''
as $$
declare
  caller_id uuid:=(select auth.uid());
  selected_game_name text;
  code_prefix text;
  alphabet constant text:='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  random_bytes bytea;
  random_token text;
  candidate_code text;
  created_invite public.game_invites%rowtype;
  attempt integer;
  byte_index integer;
  calculated_expiry timestamptz;
begin
  if caller_id is null then
    raise exception using errcode='28000',message='AUTHENTICATION_REQUIRED';
  end if;
  if not public.is_game_owner(target_game_id) then
    raise exception using errcode='42501',message='ACCESS_DENIED';
  end if;
  if invite_permission not in ('gm','viewer') then
    raise exception using errcode='P0001',message='INVALID_INVITE_PERMISSION';
  end if;
  if expires_in_seconds is not null and expires_in_seconds not in (86400,604800,2592000) then
    raise exception using errcode='P0001',message='INVALID_INVITE_EXPIRATION';
  end if;
  if requested_max_uses is not null and requested_max_uses<>1 then
    raise exception using errcode='P0001',message='INVALID_INVITE_USE_LIMIT';
  end if;

  select game.name into selected_game_name
  from public.games game
  where game.id=target_game_id;
  if not found then
    raise exception using errcode='P0001',message='GAME_NOT_FOUND';
  end if;

  code_prefix:=left(upper(regexp_replace(selected_game_name,'[^a-zA-Z0-9]+','','g')),8);
  if code_prefix='' then code_prefix:='GAME'; end if;
  calculated_expiry:=case
    when expires_in_seconds is null then null
    else statement_timestamp()+make_interval(secs=>expires_in_seconds)
  end;

  for attempt in 1..8 loop
    random_bytes:=extensions.gen_random_bytes(12);
    random_token:='';
    for byte_index in 0..11 loop
      random_token:=random_token||substr(alphabet,(get_byte(random_bytes,byte_index)%32)+1,1);
    end loop;
    candidate_code:=code_prefix||'-'||substr(random_token,1,4)||'-'||substr(random_token,5,4)||'-'||substr(random_token,9,4);
    begin
      insert into public.game_invites(game_id,code,permission,created_by,expires_at,max_uses)
      values(target_game_id,candidate_code,invite_permission,caller_id,calculated_expiry,requested_max_uses)
      returning * into created_invite;
      exit;
    exception when unique_violation then
      if attempt=8 then
        raise exception using errcode='P0001',message='INVITE_GENERATION_RETRY';
      end if;
    end;
  end loop;

  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(
    target_game_id,caller_id,'invite',created_invite.id::text,'GM Invite Created',
    jsonb_build_object(
      'permission',created_invite.permission,
      'expiresAt',created_invite.expires_at,
      'maxUses',created_invite.max_uses
    )
  );
  raise log 'game_invite_created actor=% game=% permission=% expires=% max_uses=%',
    caller_id,target_game_id,invite_permission,calculated_expiry,requested_max_uses;

  return query select
    created_invite.id,created_invite.game_id,created_invite.code,created_invite.permission,
    created_invite.created_at,created_invite.expires_at,created_invite.max_uses,
    created_invite.use_count,created_invite.revoked,created_invite.last_used_at;
end
$$;

create function public.redeem_game_invite(invite_code text)
returns table(game_id uuid,game_name text,member_role text)
language plpgsql security definer set search_path=''
as $$
declare
  caller_id uuid:=(select auth.uid());
  normalized_code text;
  selected_invite record;
begin
  if caller_id is null then
    raise exception using errcode='28000',message='AUTHENTICATION_REQUIRED';
  end if;
  normalized_code:=upper(regexp_replace(coalesce(invite_code,''),'\s+','','g'));
  if normalized_code='' or char_length(normalized_code)>40 then
    raise exception using errcode='P0001',message='INVITE_NOT_FOUND';
  end if;

  select invite.*,game.name as game_name
  into selected_invite
  from public.game_invites invite
  join public.games game on game.id=invite.game_id
  where invite.code=normalized_code
  for update of invite;

  if not found then
    raise exception using errcode='P0001',message='INVITE_NOT_FOUND';
  end if;
  if selected_invite.revoked then
    raise exception using errcode='P0001',message='INVITE_REVOKED';
  end if;
  if selected_invite.expires_at is not null and selected_invite.expires_at<=statement_timestamp() then
    raise exception using errcode='P0001',message='INVITE_EXPIRED';
  end if;
  if selected_invite.max_uses is not null and selected_invite.use_count>=selected_invite.max_uses then
    raise exception using errcode='P0001',message='INVITE_MAX_USES';
  end if;
  if exists(
    select 1 from public.game_members member
    where member.game_id=selected_invite.game_id and member.user_id=caller_id
  ) then
    raise exception using errcode='P0001',message='ALREADY_JOINED';
  end if;

  insert into public.game_members(game_id,user_id,member_role,invited_by)
  values(selected_invite.game_id,caller_id,selected_invite.permission,selected_invite.created_by);
  update public.game_invites invite
  set use_count=invite.use_count+1,last_used_at=statement_timestamp()
  where invite.id=selected_invite.id;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(
    selected_invite.game_id,caller_id,'member',caller_id::text,'GM Joined',
    jsonb_build_object('permission',selected_invite.permission,'inviteId',selected_invite.id)
  );
  raise log 'game_invite_redeemed actor=% game=% permission=% invite=%',
    caller_id,selected_invite.game_id,selected_invite.permission,selected_invite.id;

  return query select selected_invite.game_id,selected_invite.game_name,selected_invite.permission;
end
$$;

create function public.revoke_game_invite(target_invite_id uuid)
returns void
language plpgsql security definer set search_path=''
as $$
declare
  caller_id uuid:=(select auth.uid());
  selected_invite public.game_invites%rowtype;
begin
  if caller_id is null then
    raise exception using errcode='28000',message='AUTHENTICATION_REQUIRED';
  end if;
  select invite.* into selected_invite
  from public.game_invites invite
  where invite.id=target_invite_id
  for update;
  if not found or not public.is_game_owner(selected_invite.game_id) then
    raise exception using errcode='42501',message='ACCESS_DENIED';
  end if;
  if selected_invite.revoked then return; end if;

  update public.game_invites invite
  set revoked=true,revoked_at=statement_timestamp()
  where invite.id=target_invite_id;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data)
  values(
    selected_invite.game_id,caller_id,'invite',selected_invite.id::text,'Invite Revoked',
    jsonb_build_object('permission',selected_invite.permission,'inviteId',selected_invite.id)
  );
  raise log 'game_invite_revoked actor=% game=% invite=%',caller_id,selected_invite.game_id,selected_invite.id;
end
$$;

create function public.remove_game_member(target_game_id uuid,target_user_id uuid)
returns void
language plpgsql security definer set search_path=''
as $$
declare
  caller_id uuid:=(select auth.uid());
  previous_role text;
begin
  if caller_id is null then
    raise exception using errcode='28000',message='AUTHENTICATION_REQUIRED';
  end if;
  if not public.is_game_owner(target_game_id) then
    raise exception using errcode='42501',message='ACCESS_DENIED';
  end if;
  select member.member_role into previous_role
  from public.game_members member
  where member.game_id=target_game_id and member.user_id=target_user_id
  for update;
  if not found then
    raise exception using errcode='P0001',message='MEMBER_NOT_FOUND';
  end if;
  if previous_role='owner' then
    raise exception using errcode='P0001',message='OWNER_CANNOT_BE_REMOVED';
  end if;

  delete from public.game_members member
  where member.game_id=target_game_id and member.user_id=target_user_id;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data)
  values(
    target_game_id,caller_id,'member',target_user_id::text,'GM Removed',
    jsonb_build_object('memberRole',previous_role)
  );
  raise log 'game_member_removed actor=% game=% removed_user=% previous_role=%',
    caller_id,target_game_id,target_user_id,previous_role;
end
$$;

create or replace function public.set_game_member_role(target_game_id uuid,target_user_id uuid,next_role text)
returns void
language plpgsql security definer set search_path=''
as $$
declare
  caller_id uuid:=(select auth.uid());
  previous_role text;
begin
  if caller_id is null then
    raise exception using errcode='28000',message='AUTHENTICATION_REQUIRED';
  end if;
  if not public.is_game_owner(target_game_id) then
    raise exception using errcode='42501',message='ACCESS_DENIED';
  end if;
  if next_role not in ('gm','viewer') then
    raise exception using errcode='P0001',message='INVALID_MEMBER_PERMISSION';
  end if;
  select member.member_role into previous_role
  from public.game_members member
  where member.game_id=target_game_id
    and member.user_id=target_user_id
    and member.member_role<>'owner'
  for update;
  if not found then
    raise exception using errcode='P0001',message='MEMBER_NOT_FOUND';
  end if;
  if previous_role=next_role then return; end if;

  update public.game_members member
  set member_role=next_role
  where member.game_id=target_game_id and member.user_id=target_user_id;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data)
  values(
    target_game_id,caller_id,'member',target_user_id::text,'GM Permission Changed',
    jsonb_build_object('memberRole',previous_role),jsonb_build_object('memberRole',next_role)
  );
  raise log 'game_member_permission_changed actor=% game=% member=% previous=% next=%',
    caller_id,target_game_id,target_user_id,previous_role,next_role;
end
$$;

-- Backward-compatible endpoint: old clients can redeem new persisted invitations,
-- but legacy permanent games.share_code values no longer grant access.
create or replace function public.join_game_by_code(invite_code text)
returns uuid
language plpgsql security invoker set search_path=''
as $$
declare joined record;
begin
  select * into joined from public.redeem_game_invite(invite_code);
  return joined.game_id;
end
$$;

alter table public.game_members replica identity full;
alter table public.game_invites replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.game_members;
exception when duplicate_object then null;
end
$$;
do $$
begin
  alter publication supabase_realtime add table public.game_invites;
exception when duplicate_object then null;
end
$$;

revoke execute on function public.generate_game_invite(uuid,text,integer,integer) from public,anon;
revoke execute on function public.redeem_game_invite(text) from public,anon;
revoke execute on function public.revoke_game_invite(uuid) from public,anon;
revoke execute on function public.remove_game_member(uuid,uuid) from public,anon;
revoke execute on function public.set_game_member_role(uuid,uuid,text) from public,anon;
revoke execute on function public.join_game_by_code(text) from public,anon;
revoke execute on function public.create_game(uuid,jsonb) from public,anon;
grant execute on function public.generate_game_invite(uuid,text,integer,integer) to authenticated;
grant execute on function public.redeem_game_invite(text) to authenticated;
grant execute on function public.revoke_game_invite(uuid) to authenticated;
grant execute on function public.remove_game_member(uuid,uuid) to authenticated;
grant execute on function public.set_game_member_role(uuid,uuid,text) to authenticated;
grant execute on function public.join_game_by_code(text) to authenticated;
grant execute on function public.create_game(uuid,jsonb) to authenticated;
