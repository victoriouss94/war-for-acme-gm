-- Append-only audit storage for the existing resolver's saved calculations.
-- Keep revision bodies out of routine resolution/session sync responses.
create table public.resolution_simulation_revisions (
  session_id uuid not null references public.resolution_sessions(id) on delete cascade,
  simulation_version integer not null check (simulation_version>0),
  game_id uuid not null references public.games(id) on delete cascade,
  proposal jsonb not null check (jsonb_typeof(proposal)='object' and octet_length(proposal::text)<=900000),
  engine_status text,
  engine_version text,
  captured_at timestamptz not null default now(),
  simulated_at timestamptz,
  simulated_by uuid references auth.users(id) on delete set null,
  capture_kind text not null check (capture_kind in ('SAVED','LEGACY_CURRENT')),
  primary key (session_id,simulation_version)
);
create index resolution_simulation_revisions_game_idx on public.resolution_simulation_revisions(game_id);
create index resolution_simulation_revisions_actor_idx on public.resolution_simulation_revisions(simulated_by);
alter table public.resolution_simulation_revisions enable row level security;
revoke all on public.resolution_simulation_revisions from public,anon,authenticated,service_role;
grant select on public.resolution_simulation_revisions to authenticated,service_role;
create policy simulation_revisions_read_gm on public.resolution_simulation_revisions
  for select to authenticated using ((select public.can_edit_game(game_id)));
comment on table public.resolution_simulation_revisions is 'Read-only GM audit revisions. Populated atomically by the existing save_deterministic_resolution RPC. LEGACY_CURRENT preserves an available older latest proposal, not missing historical originals.';

do $migration$
declare definition text; needle text; replacement text;
begin
  definition:=pg_get_functiondef('private.save_deterministic_resolution(uuid,integer,jsonb)'::regprocedure);
  needle:='  update public.resolution_sessions session set';
  replacement:=$sql$  -- Retain a pre-migration latest proposal before it is superseded. Never
  -- relabel it as the original or reconstruct revisions that are already lost.
  if session_row.simulation_version>0 and session_row.engine_proposal<>'{}'::jsonb then
    insert into public.resolution_simulation_revisions(session_id,simulation_version,game_id,proposal,engine_status,engine_version,simulated_at,simulated_by,capture_kind)
    values(session_row.id,session_row.simulation_version,session_row.game_id,session_row.engine_proposal,session_row.engine_status,session_row.engine_version,session_row.simulated_at,session_row.simulated_by,'LEGACY_CURRENT')
    on conflict (session_id,simulation_version) do nothing;
  end if;
  update public.resolution_sessions session set$sql$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected simulation update boundary'; end if;
  definition:=replace(definition,needle,replacement);
  needle:='  insert into public.resolution_session_events(session_id,game_id,event_order,event_type,outcome)';
  replacement:=$sql$  insert into public.resolution_simulation_revisions(session_id,simulation_version,game_id,proposal,engine_status,engine_version,simulated_at,simulated_by,capture_kind)
  values(session_row.id,session_row.simulation_version,session_row.game_id,session_row.engine_proposal,session_row.engine_status,session_row.engine_version,session_row.simulated_at,session_row.simulated_by,'SAVED');
  insert into public.resolution_session_events(session_id,game_id,event_order,event_type,outcome)$sql$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected simulation audit boundary'; end if;
  execute replace(definition,needle,replacement);
end $migration$;
