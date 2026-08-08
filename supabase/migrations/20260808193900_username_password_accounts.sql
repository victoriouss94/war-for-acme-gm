-- Permanent username/password accounts backed by Supabase Auth.
-- Passwords remain exclusively in auth.users.encrypted_password, where GoTrue
-- stores salted bcrypt hashes. No application table stores password material.

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists username_normalized text;
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists legacy_account boolean not null default false;

-- Preserve any pre-existing accounts. Valid usernames in existing metadata are
-- retained; otherwise a stable legacy username is assigned without touching
-- games, ownership, memberships, invitations, documents, or audit history.
with candidates as (
  select
    profile.id,
    case
      when btrim(coalesce(auth_user.raw_user_meta_data->>'username','')) ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$'
        then btrim(auth_user.raw_user_meta_data->>'username')
      else 'gm_' || substr(replace(profile.id::text,'-',''),1,12)
    end as candidate
  from public.profiles profile
  left join auth.users auth_user on auth_user.id=profile.id
), ranked as (
  select
    id,
    candidate,
    row_number() over(partition by lower(candidate) order by id) as duplicate_number
  from candidates
)
update public.profiles profile
set
  username=case
    when ranked.duplicate_number=1 then ranked.candidate
    else left(ranked.candidate,20) || '_' || substr(replace(ranked.id::text,'-',''),1,8)
  end,
  username_normalized=lower(case
    when ranked.duplicate_number=1 then ranked.candidate
    else left(ranked.candidate,20) || '_' || substr(replace(ranked.id::text,'-',''),1,8)
  end)
from ranked
where ranked.id=profile.id
  and (profile.username is null or profile.username_normalized is null);

-- Grandfather only anonymous accounts that already existed when this migration
-- ran. New anonymous signups are rejected by handle_new_user below.
update public.profiles profile
set legacy_account=true
from auth.users auth_user
where auth_user.id=profile.id and coalesce(auth_user.is_anonymous,false);

alter table public.profiles alter column username set not null;
alter table public.profiles alter column username_normalized set not null;

alter table public.profiles drop constraint if exists profiles_username_format_check;
alter table public.profiles add constraint profiles_username_format_check
  check (username ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$');

alter table public.profiles drop constraint if exists profiles_username_normalized_check;
alter table public.profiles add constraint profiles_username_normalized_check
  check (username_normalized=lower(username));

create unique index if not exists profiles_username_normalized_key
  on public.profiles(username_normalized);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  requested_username text:=btrim(coalesce(new.raw_user_meta_data->>'username',''));
  normalized_username text:=lower(requested_username);
  expected_email text;
begin
  if coalesce(new.is_anonymous,false) then
    raise exception using errcode='28000',message='Permanent username and password account required.';
  end if;
  if requested_username !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$' then
    raise exception using errcode='22023',message='Invalid username.';
  end if;

  expected_email:=normalized_username || '@users.bipjqwemwqivyassibqm.supabase.co';
  if lower(coalesce(new.email,''))<>expected_email then
    raise exception using errcode='22023',message='Invalid username account identity.';
  end if;

  insert into public.profiles(id,username,username_normalized,display_name,last_login_at)
  values(
    new.id,
    requested_username,
    normalized_username,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'),''),requested_username),
    now()
  );
  return new;
exception
  when unique_violation then
    raise exception using errcode='23505',message='Username already taken.';
end
$$;

revoke execute on function public.handle_new_user() from public,anon,authenticated;

grant select on public.profiles to authenticated;
grant update(display_name,last_login_at) on public.profiles to authenticated;

create or replace function public.is_permanent_account()
returns boolean
language sql
stable
security invoker
set search_path=''
as $$
  select (select auth.uid()) is not null
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)
$$;

create or replace function public.is_legacy_account()
returns boolean
language sql
stable
security invoker
set search_path=''
as $$
  select (select auth.uid()) is not null
    and coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)
    and exists(
      select 1 from public.profiles profile
      where profile.id=(select auth.uid()) and profile.legacy_account
    )
$$;

create or replace function public.is_game_member(target_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select (public.is_permanent_account() or public.is_legacy_account()) and exists(
    select 1 from public.game_members member
    where member.game_id=target_game_id
      and member.user_id=(select auth.uid())
  )
$$;

create or replace function public.can_edit_game(target_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select (public.is_permanent_account() or public.is_legacy_account()) and exists(
    select 1 from public.game_members member
    where member.game_id=target_game_id
      and member.user_id=(select auth.uid())
      and member.member_role in ('owner','gm')
  )
$$;

create or replace function public.is_game_owner(target_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select (public.is_permanent_account() or public.is_legacy_account()) and exists(
    select 1 from public.game_members member
    where member.game_id=target_game_id
      and member.user_id=(select auth.uid())
      and member.member_role='owner'
  )
$$;

create or replace function public.require_permanent_game_member()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if not exists(
    select 1
    from auth.users auth_user
    where auth_user.id=new.user_id
      and not coalesce(auth_user.is_anonymous,false)
  ) then
    raise exception using errcode='28000',message='Permanent username and password account required.';
  end if;
  return new;
end
$$;

drop trigger if exists require_permanent_game_member on public.game_members;
create trigger require_permanent_game_member
before insert or update of user_id on public.game_members
for each row execute function public.require_permanent_game_member();

revoke execute on function public.require_permanent_game_member() from public,anon,authenticated;
revoke execute on function public.is_permanent_account() from public,anon;
revoke execute on function public.is_legacy_account() from public,anon;
grant execute on function public.is_permanent_account(),public.is_legacy_account() to authenticated;
grant execute on function public.is_game_member(uuid),public.can_edit_game(uuid),public.is_game_owner(uuid) to authenticated;

-- Existing anonymous device accounts keep their memberships and can upgrade
-- in place. The caller must first attach the matching synthetic email/password
-- identity through Supabase Auth; this function never handles a password.
create or replace function public.complete_legacy_account(requested_username text)
returns table(id uuid,username text,display_name text,created_at timestamptz,last_login_at timestamptz)
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_id uuid:=(select auth.uid());
  clean_username text:=btrim(coalesce(requested_username,''));
  normalized_username text:=lower(clean_username);
  auth_record record;
begin
  if caller_id is null then raise exception using errcode='28000',message='Authentication required.'; end if;
  if clean_username !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$' then
    raise exception using errcode='22023',message='Invalid username.';
  end if;
  select auth_user.email,auth_user.is_anonymous into auth_record
  from auth.users auth_user where auth_user.id=caller_id;
  if not found
    or coalesce(auth_record.is_anonymous,false)
    or lower(coalesce(auth_record.email,''))<>normalized_username || '@users.bipjqwemwqivyassibqm.supabase.co'
  then raise exception using errcode='28000',message='Permanent username and password identity required.'; end if;

  update public.profiles profile
  set username=clean_username,username_normalized=normalized_username,display_name=clean_username,updated_at=now(),last_login_at=now(),legacy_account=false
  where profile.id=caller_id;
  return query
  select profile.id,profile.username,profile.display_name,profile.created_at,profile.last_login_at
  from public.profiles profile where profile.id=caller_id;
exception
  when unique_violation then
    raise exception using errcode='23505',message='Username already taken.';
end
$$;

revoke execute on function public.complete_legacy_account(text) from public,anon;
grant execute on function public.complete_legacy_account(text) to authenticated;

create or replace function public.create_game(game_id uuid,initial_document jsonb)
returns table(id uuid,version integer,share_code text)
language plpgsql
security definer
set search_path=''
as $$
begin
  if not public.is_permanent_account() then
    raise exception using errcode='28000',message='Permanent username and password account required.';
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

create or replace function public.redeem_game_invite(invite_code text)
returns table(game_id uuid,game_name text,member_role text)
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_id uuid:=(select auth.uid());
  normalized_code text;
  selected_invite record;
begin
  if not public.is_permanent_account() then
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

revoke execute on function public.create_game(uuid,jsonb) from public,anon;
revoke execute on function public.redeem_game_invite(text) from public,anon;
grant execute on function public.create_game(uuid,jsonb),public.redeem_game_invite(text) to authenticated;
