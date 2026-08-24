-- Basic roles and reviewed, server-randomized assignment using existing game document roles/players.
create table if not exists public.role_assignment_previews (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  source_game_version integer not null check (source_game_version > 0),
  status text not null default 'PENDING' check (status in ('PENDING','APPLIED','CANCELLED','EXPIRED')),
  mode text not null default 'LOCKED_RANDOM' check (mode in ('RANDOM','PARTIAL_RANDOM','LOCKED_RANDOM')),
  assignments jsonb not null default '{}'::jsonb check (jsonb_typeof(assignments)='object'),
  locked_assignments jsonb not null default '{}'::jsonb check (jsonb_typeof(locked_assignments)='object'),
  faction_constraints jsonb not null default '{}'::jsonb check (jsonb_typeof(faction_constraints)='object'),
  replace_existing boolean not null default false,
  summary jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  shuffle_count integer not null default 0 check (shuffle_count >= 0),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz
);

create table if not exists public.role_assignment_history (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  preview_id uuid references public.role_assignment_previews(id) on delete set null,
  player_id text not null check (char_length(player_id) between 1 and 200),
  player_name text not null check (char_length(player_name) between 1 and 200),
  role_id text not null check (char_length(role_id) between 1 and 200),
  role_name text not null check (char_length(role_name) between 1 and 200),
  faction_id text not null default '',
  faction_name text not null default '',
  previous_role_id text not null default '',
  assignment_method text not null check (assignment_method in ('RANDOM','PARTIAL_RANDOM','LOCKED_RANDOM','MANUAL','IMPORT','AI_ASSISTED')),
  replaced_previous boolean not null default false,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now()
);

create index if not exists role_assignment_previews_game_created_idx on public.role_assignment_previews(game_id,created_at desc);
create index if not exists role_assignment_history_game_assigned_idx on public.role_assignment_history(game_id,assigned_at desc);

alter table public.role_assignment_previews enable row level security;
alter table public.role_assignment_history enable row level security;
drop policy if exists role_assignment_previews_gm_read on public.role_assignment_previews;
create policy role_assignment_previews_gm_read on public.role_assignment_previews for select to authenticated using (public.can_edit_game(game_id));
drop policy if exists role_assignment_history_gm_read on public.role_assignment_history;
create policy role_assignment_history_gm_read on public.role_assignment_history for select to authenticated using (public.can_edit_game(game_id));

revoke all on table public.role_assignment_previews,public.role_assignment_history from public,anon,authenticated;
grant select on table public.role_assignment_previews,public.role_assignment_history to authenticated;

create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;

create or replace function private.random_role_assignments(
  target_game_id uuid,
  target_replace_existing boolean,
  target_locked_assignments jsonb,
  target_faction_constraints jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  document_row public.game_documents%rowtype;
  player_record jsonb;
  role_record jsonb;
  chosen_slot jsonb;
  chosen_ordinal bigint;
  available_slots jsonb := '[]'::jsonb;
  assignments jsonb := '{}'::jsonb;
  effective_locks jsonb := coalesce(target_locked_assignments,'{}'::jsonb);
  constraints jsonb := coalesce(target_faction_constraints,'{}'::jsonb);
  player_id text;
  role_id text;
  constraint_id text;
  existing_role_id text;
  players_count integer;
  slots_count integer;
  assigned_count integer;
  replacement_count integer := 0;
  existing_assignment_count integer := 0;
  faction_distribution jsonb;
  basic_count integer;
begin
  if jsonb_typeof(effective_locks)<>'object' or jsonb_typeof(constraints)<>'object' then raise exception using errcode='22023',message='Assignment locks and constraints must be JSON objects.'; end if;
  select d.* into document_row from public.game_documents d where d.game_id=target_game_id;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',r.value->>'id'||':'||slot.number,'roleId',r.value->>'id','roleName',r.value->>'name','factionId',coalesce(r.value->>'factionId',''),'roleType',coalesce(r.value->>'roleType','STANDARD')) order by r.ordinality,slot.number),'[]'::jsonb)
  into available_slots
  from jsonb_array_elements(document_row.document#>'{data,roles}') with ordinality r(value,ordinality)
  cross join lateral generate_series(1,greatest(1,least(1000,coalesce(nullif(r.value->>'slotCount','')::integer,1)))) slot(number)
  where coalesce((r.value->>'enabled')::boolean,true) and nullif(r.value->>'archivedAt','') is null;
  slots_count:=jsonb_array_length(available_slots);
  players_count:=jsonb_array_length(document_row.document#>'{data,players}');
  select count(*) into existing_assignment_count from jsonb_array_elements(document_row.document#>'{data,players}') p where nullif(p->>'roleId','') is not null;

  -- Preserve existing assignments unless replacement was explicitly requested.
  if not target_replace_existing then
    for player_record in select value from jsonb_array_elements(document_row.document#>'{data,players}') loop
      player_id:=player_record->>'id';existing_role_id:=coalesce(player_record->>'roleId','');
      if existing_role_id<>'' then
        select slot.value,slot.ordinality into chosen_slot,chosen_ordinal from jsonb_array_elements(available_slots) with ordinality slot(value,ordinality) where slot.value->>'roleId'=existing_role_id order by slot.ordinality limit 1;
        if chosen_slot is null then raise exception using errcode='22023',message='EXISTING_ASSIGNMENT_EXCEEDS_ROLE_SLOTS:'||player_id; end if;
        assignments:=jsonb_set(assignments,array[player_id],to_jsonb(existing_role_id),true);
        effective_locks:=jsonb_set(effective_locks,array[player_id],to_jsonb(existing_role_id),true);
        select coalesce(jsonb_agg(slot.value order by slot.ordinality),'[]'::jsonb) into available_slots from jsonb_array_elements(available_slots) with ordinality slot(value,ordinality) where slot.ordinality<>chosen_ordinal;
        chosen_slot:=null;chosen_ordinal:=null;
      end if;
    end loop;
  end if;

  -- Reserve explicit GM locks before any random selection.
  for player_id,role_id in select key,value#>>'{}' from jsonb_each(effective_locks) loop
    if not exists(select 1 from jsonb_array_elements(document_row.document#>'{data,players}') p where p->>'id'=player_id) then raise exception using errcode='22023',message='LOCKED_PLAYER_NOT_FOUND:'||player_id; end if;
    if assignments ? player_id then
      if assignments->>player_id<>role_id then raise exception using errcode='22023',message='LOCK_CONFLICT:'||player_id; end if;
      continue;
    end if;
    select slot.value,slot.ordinality into chosen_slot,chosen_ordinal from jsonb_array_elements(available_slots) with ordinality slot(value,ordinality) where slot.value->>'roleId'=role_id order by slot.ordinality limit 1;
    if chosen_slot is null then raise exception using errcode='22023',message='LOCKED_ROLE_SLOT_UNAVAILABLE:'||role_id; end if;
    constraint_id:=coalesce(constraints->>player_id,'');if constraint_id<>'' and chosen_slot->>'factionId'<>constraint_id then raise exception using errcode='22023',message='LOCK_VIOLATES_FACTION_CONSTRAINT:'||player_id; end if;
    assignments:=jsonb_set(assignments,array[player_id],to_jsonb(role_id),true);
    select coalesce(jsonb_agg(slot.value order by slot.ordinality),'[]'::jsonb) into available_slots from jsonb_array_elements(available_slots) with ordinality slot(value,ordinality) where slot.ordinality<>chosen_ordinal;
    chosen_slot:=null;chosen_ordinal:=null;
  end loop;

  if players_count-(select count(*) from jsonb_object_keys(assignments))>jsonb_array_length(available_slots) then
    raise exception using errcode='22023',message='NOT_ENOUGH_ROLE_SLOTS:players='||players_count||',slots='||slots_count||',missing='||(players_count-slots_count);
  end if;

  -- PostgreSQL random UUID ordering is server-side cryptographic randomization (pgcrypto).
  for player_record in select value from jsonb_array_elements(document_row.document#>'{data,players}') p(value) where not (assignments ? (value->>'id')) order by gen_random_uuid() loop
    player_id:=player_record->>'id';constraint_id:=coalesce(constraints->>player_id,'');
    select slot.value,slot.ordinality into chosen_slot,chosen_ordinal from jsonb_array_elements(available_slots) with ordinality slot(value,ordinality) where constraint_id='' or slot.value->>'factionId'=constraint_id order by gen_random_uuid() limit 1;
    if chosen_slot is null then raise exception using errcode='22023',message='NO_ELIGIBLE_ROLE_SLOT:'||player_id; end if;
    assignments:=jsonb_set(assignments,array[player_id],to_jsonb(chosen_slot->>'roleId'),true);
    select coalesce(jsonb_agg(slot.value order by slot.ordinality),'[]'::jsonb) into available_slots from jsonb_array_elements(available_slots) with ordinality slot(value,ordinality) where slot.ordinality<>chosen_ordinal;
    chosen_slot:=null;chosen_ordinal:=null;
  end loop;
  select count(*) into assigned_count from jsonb_object_keys(assignments);
  select count(*) into replacement_count from jsonb_array_elements(document_row.document#>'{data,players}') p where nullif(p->>'roleId','') is not null and assignments->>(p->>'id')<>p->>'roleId';
  select coalesce(jsonb_object_agg(faction_name,total),'{}'::jsonb) into faction_distribution from (
    select coalesce(f->>'name','No faction') faction_name,count(*) total
    from jsonb_each_text(assignments) a
    join jsonb_array_elements(document_row.document#>'{data,roles}') r on r->>'id'=a.value
    left join jsonb_array_elements(document_row.document#>'{data,factions}') f on f->>'id'=r->>'factionId'
    group by coalesce(f->>'name','No faction')
  ) totals;
  select count(*) into basic_count from jsonb_each_text(assignments) a join jsonb_array_elements(document_row.document#>'{data,roles}') r on r->>'id'=a.value where coalesce(r->>'roleType','STANDARD')='BASIC';
  return jsonb_build_object('assignments',assignments,'lockedAssignments',effective_locks,'unusedSlots',available_slots,'summary',jsonb_build_object('players',players_count,'availableRoleSlots',slots_count,'assigned',assigned_count,'unassigned',players_count-assigned_count,'unusedRoleSlots',jsonb_array_length(available_slots),'unusedRoles',available_slots,'basicRoleAssignments',basic_count,'existingAssignments',existing_assignment_count,'replacedAssignmentsInPreview',replacement_count,'factionDistribution',faction_distribution),'warnings',case when target_replace_existing and existing_assignment_count>0 then jsonb_build_array('EXISTING_ROLE_ASSIGNMENTS_DETECTED') else '[]'::jsonb end);
end$$;

revoke all on function private.random_role_assignments(uuid,boolean,jsonb,jsonb) from public,anon,authenticated;

create or replace function private.validate_basic_roles_and_roster()
returns trigger language plpgsql security definer set search_path='' as $$
declare role_record jsonb;
begin
  for role_record in select value from jsonb_array_elements(new.document#>'{data,roles}') loop
    if coalesce(role_record->>'roleType','STANDARD') not in ('STANDARD','BASIC') then raise exception using errcode='22023',message='INVALID_ROLE_TYPE'; end if;
    if coalesce(nullif(role_record->>'slotCount','')::integer,1) not between 1 and 1000 then raise exception using errcode='22023',message='INVALID_ROLE_SLOT_COUNT'; end if;
    if coalesce(role_record->>'roleType','STANDARD')='BASIC' and (nullif(role_record->>'activeAbilityId','') is not null or nullif(role_record->>'passiveAbilityId','') is not null or jsonb_array_length(coalesce(role_record->'tags','[]'::jsonb))>0) then raise exception using errcode='22023',message='BASIC_ROLE_CANNOT_HAVE_ABILITIES'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(new.document#>'{data,players}') p group by lower(regexp_replace(btrim(p->>'name'),'\s+',' ','g')) having count(*)>1) then raise exception using errcode='23505',message='DUPLICATE_PLAYER_NAME'; end if;
  return new;
end$$;
drop trigger if exists validate_basic_roles_and_roster_trigger on public.game_documents;
create trigger validate_basic_roles_and_roster_trigger before insert or update of document on public.game_documents for each row execute function private.validate_basic_roles_and_roster();
revoke all on function private.validate_basic_roles_and_roster() from public,anon,authenticated;

create or replace function public.create_role_assignment_preview(
  target_game_id uuid,
  expected_game_version integer,
  target_replace_existing boolean default false,
  target_locked_assignments jsonb default '{}'::jsonb,
  target_faction_constraints jsonb default '{}'::jsonb
) returns public.role_assignment_previews
language plpgsql
security definer
set search_path=''
as $$
declare actual_version integer;plan jsonb;saved public.role_assignment_previews;
begin
  if auth.uid() is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_PERMISSION_REQUIRED'; end if;
  select version into actual_version from public.game_documents where game_id=target_game_id;
  if actual_version<>expected_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  plan:=private.random_role_assignments(target_game_id,target_replace_existing,target_locked_assignments,target_faction_constraints);
  update public.role_assignment_previews set status='EXPIRED',updated_at=now(),version=version+1 where game_id=target_game_id and status='PENDING';
  insert into public.role_assignment_previews(game_id,source_game_version,mode,assignments,locked_assignments,faction_constraints,replace_existing,summary,warnings,created_by)
  values(target_game_id,actual_version,case when (select count(*) from jsonb_object_keys(plan->'lockedAssignments'))>0 then 'LOCKED_RANDOM' else 'RANDOM' end,plan->'assignments',plan->'lockedAssignments',target_faction_constraints,target_replace_existing,plan->'summary',plan->'warnings',auth.uid()) returning * into saved;
  return saved;
end$$;

create or replace function public.shuffle_role_assignment_preview(target_preview_id uuid,expected_preview_version integer)
returns public.role_assignment_previews language plpgsql security definer set search_path='' as $$
declare preview public.role_assignment_previews;plan jsonb;
begin
  select * into preview from public.role_assignment_previews where id=target_preview_id for update;
  if not found then raise exception using errcode='P0002',message='PREVIEW_NOT_FOUND'; end if;
  if not public.can_edit_game(preview.game_id) then raise exception using errcode='42501',message='GM_PERMISSION_REQUIRED'; end if;
  if preview.status<>'PENDING' or preview.version<>expected_preview_version then raise exception using errcode='40001',message='PREVIEW_CONFLICT'; end if;
  if (select version from public.game_documents where game_id=preview.game_id)<>preview.source_game_version then update public.role_assignment_previews set status='EXPIRED',version=version+1,updated_at=now() where id=preview.id;raise exception using errcode='40001',message='GAME_CHANGED_PREVIEW_EXPIRED'; end if;
  plan:=private.random_role_assignments(preview.game_id,preview.replace_existing,preview.locked_assignments,preview.faction_constraints);
  update public.role_assignment_previews set assignments=plan->'assignments',summary=plan->'summary',warnings=plan->'warnings',shuffle_count=shuffle_count+1,version=version+1,updated_at=now() where id=preview.id returning * into preview;
  return preview;
end$$;

create or replace function public.cancel_role_assignment_preview(target_preview_id uuid,expected_preview_version integer)
returns public.role_assignment_previews language plpgsql security definer set search_path='' as $$
declare preview public.role_assignment_previews;
begin
  select * into preview from public.role_assignment_previews where id=target_preview_id for update;
  if not found or not public.can_edit_game(preview.game_id) then raise exception using errcode='42501',message='GM_PERMISSION_REQUIRED'; end if;
  if preview.status<>'PENDING' or preview.version<>expected_preview_version then raise exception using errcode='40001',message='PREVIEW_CONFLICT'; end if;
  update public.role_assignment_previews set status='CANCELLED',version=version+1,updated_at=now() where id=preview.id returning * into preview;return preview;
end$$;

create or replace function public.apply_role_assignment_preview(target_preview_id uuid,expected_preview_version integer,confirm_active_game boolean default false)
returns public.role_assignment_previews language plpgsql security definer set search_path='' as $$
declare preview public.role_assignment_previews;document_row public.game_documents%rowtype;candidate jsonb;next_players jsonb;player_record jsonb;role_record jsonb;assigned_role_id text;previous_role_id text;saved_record record;
begin
  select * into preview from public.role_assignment_previews where id=target_preview_id for update;
  if not found or not public.can_edit_game(preview.game_id) then raise exception using errcode='42501',message='GM_PERMISSION_REQUIRED'; end if;
  if preview.status<>'PENDING' or preview.version<>expected_preview_version then raise exception using errcode='40001',message='PREVIEW_CONFLICT'; end if;
  select * into document_row from public.game_documents where game_id=preview.game_id for update;
  if document_row.version<>preview.source_game_version then update public.role_assignment_previews set status='EXPIRED',version=version+1,updated_at=now() where id=preview.id;raise exception using errcode='40001',message='GAME_CHANGED_PREVIEW_EXPIRED'; end if;
  if document_row.document#>>'{game,status}'='ACTIVE' and not confirm_active_game then raise exception using errcode='22023',message='ACTIVE_GAME_CONFIRMATION_REQUIRED'; end if;
  select jsonb_agg(jsonb_set(jsonb_set(p.value,'{roleId}',to_jsonb(preview.assignments->>(p.value->>'id')),true),'{currentFactionId}',to_jsonb(coalesce(r.value->>'factionId','')),true) order by p.ordinality)
  into next_players from jsonb_array_elements(document_row.document#>'{data,players}') with ordinality p(value,ordinality)
  join jsonb_array_elements(document_row.document#>'{data,roles}') r(value) on r.value->>'id'=preview.assignments->>(p.value->>'id');
  if jsonb_array_length(coalesce(next_players,'[]'::jsonb))<>jsonb_array_length(document_row.document#>'{data,players}') then raise exception using errcode='22023',message='INCOMPLETE_ASSIGNMENT_PREVIEW'; end if;
  candidate:=jsonb_set(document_row.document,'{data,players}',next_players,false);
  select * into saved_record from public.save_game_document(preview.game_id,document_row.version,candidate,'Role assignment preview approved','player',null) limit 1;
  for player_record in select value from jsonb_array_elements(document_row.document#>'{data,players}') loop
    assigned_role_id:=preview.assignments->>(player_record->>'id');previous_role_id:=coalesce(player_record->>'roleId','');
    select value into role_record from jsonb_array_elements(document_row.document#>'{data,roles}') where value->>'id'=assigned_role_id limit 1;
    insert into public.role_assignment_history(game_id,preview_id,player_id,player_name,role_id,role_name,faction_id,faction_name,previous_role_id,assignment_method,replaced_previous,assigned_by)
    values(preview.game_id,preview.id,player_record->>'id',player_record->>'name',assigned_role_id,role_record->>'name',coalesce(role_record->>'factionId',''),coalesce((select f->>'name' from jsonb_array_elements(document_row.document#>'{data,factions}') f where f->>'id'=role_record->>'factionId' limit 1),''),previous_role_id,preview.mode,previous_role_id<>'' and previous_role_id<>assigned_role_id,auth.uid());
  end loop;
  update public.role_assignment_previews set status='APPLIED',applied_at=now(),updated_at=now(),version=version+1 where id=preview.id returning * into preview;return preview;
end$$;

revoke all on function public.create_role_assignment_preview(uuid,integer,boolean,jsonb,jsonb),public.shuffle_role_assignment_preview(uuid,integer),public.cancel_role_assignment_preview(uuid,integer),public.apply_role_assignment_preview(uuid,integer,boolean) from public,anon;
grant execute on function public.create_role_assignment_preview(uuid,integer,boolean,jsonb,jsonb),public.shuffle_role_assignment_preview(uuid,integer),public.cancel_role_assignment_preview(uuid,integer),public.apply_role_assignment_preview(uuid,integer,boolean) to authenticated;

do $$ begin alter publication supabase_realtime add table public.role_assignment_previews; exception when duplicate_object then null; end $$;
