-- Complete the existing AI GM architecture with GM-reviewed resolution sessions,
-- one shared precedent system, AI drafts, interaction evidence, and durable usage controls.
-- Existing game documents, statuses, official knowledge, abilities, and audit history remain authoritative.

create table public.resolution_sessions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  cycle integer not null check (cycle between 0 and 9999),
  phase text not null check (phase in ('Day','Night','Any','Immediate')),
  status text not null default 'OPEN' check (status in ('OPEN','AI_ANALYZING','AI_PROPOSED','GM_REVIEW','MODIFIED','APPROVED','FINALIZED','REJECTED')),
  source_game_version integer not null check (source_game_version > 0),
  lock_version integer not null default 1 check (lock_version > 0),
  submitted_actions jsonb not null default '[]'::jsonb check (jsonb_typeof(submitted_actions)='array' and octet_length(submitted_actions::text)<=200000),
  relevant_player_ids text[] not null default '{}',
  pre_resolution_state jsonb not null default '{}'::jsonb check (jsonb_typeof(pre_resolution_state)='object' and octet_length(pre_resolution_state::text)<=500000),
  source_versions jsonb not null default '{}'::jsonb check (jsonb_typeof(source_versions)='object' and octet_length(source_versions::text)<=200000),
  ai_proposal jsonb check (ai_proposal is null or (jsonb_typeof(ai_proposal)='object' and octet_length(ai_proposal::text)<=300000)),
  ai_model text not null default '' check (char_length(ai_model)<=120),
  ai_request_id uuid,
  ai_response_id text not null default '' check (char_length(ai_response_id)<=200),
  ai_confidence text check (ai_confidence is null or ai_confidence in ('high','medium','low')),
  ai_authority text check (ai_authority is null or ai_authority in ('saved_game','official_sources','gm_precedent','mixed','insufficient')),
  gm_decision text not null default 'NONE' check (gm_decision in ('NONE','APPROVE','MODIFY','REJECT')),
  manual_resolution jsonb check (manual_resolution is null or (jsonb_typeof(manual_resolution)='object' and octet_length(manual_resolution::text)<=300000)),
  final_resolution jsonb check (final_resolution is null or (jsonb_typeof(final_resolution)='object' and octet_length(final_resolution::text)<=300000)),
  post_resolution_state jsonb check (post_resolution_state is null or (jsonb_typeof(post_resolution_state)='object' and octet_length(post_resolution_state::text)<=500000)),
  gm_explanation text not null default '' check (char_length(gm_explanation)<=12000),
  teach_ai boolean not null default false,
  precedent_id uuid,
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz
);

create table public.resolution_session_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.resolution_sessions(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  event_order integer not null check (event_order between 1 and 1000),
  event_type text not null check (event_type in ('SUCCESS','FAILURE','BLOCK','REDIRECT','REFLECT','TRANSFER','PASSIVE_TRIGGER','PROTECTION_USED','DEATH','SURVIVAL','CONVERSION','STATUS_ADDED','STATUS_REMOVED','ABILITY_CONSUMED','STATE_CHANGE','OTHER')),
  actor_player_id text,
  target_player_id text,
  ability_id text,
  outcome jsonb not null default '{}'::jsonb check (jsonb_typeof(outcome)='object' and octet_length(outcome::text)<=20000),
  created_at timestamptz not null default now(),
  unique(session_id,event_order)
);

create table public.gm_precedents (
  id uuid primary key default gen_random_uuid(),
  precedent_number bigint generated always as identity unique,
  game_id uuid not null references public.games(id) on delete cascade,
  source_resolution_session_id uuid references public.resolution_sessions(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text not null default '' check (char_length(summary)<=4000),
  interaction_signature text not null check (char_length(btrim(interaction_signature)) between 1 and 1000),
  signature_tokens text[] not null check (cardinality(signature_tokens) between 1 and 100),
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions)='object' and octet_length(conditions::text)<=100000),
  submitted_actions jsonb not null default '[]'::jsonb check (jsonb_typeof(submitted_actions)='array' and octet_length(submitted_actions::text)<=200000),
  resolution_order jsonb not null default '[]'::jsonb check (jsonb_typeof(resolution_order)='array' and octet_length(resolution_order::text)<=100000),
  final_outcome jsonb not null check (jsonb_typeof(final_outcome)='object' and octet_length(final_outcome::text)<=300000),
  gm_reasoning text not null default '' check (char_length(gm_reasoning)<=12000),
  scope text not null default 'GAME_SPECIFIC' check (scope in ('GENERAL','ABILITY_SPECIFIC','ROLE_SPECIFIC','GAME_SPECIFIC','ONE_TIME')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CONFLICTING','SUPERSEDED','ARCHIVED','INCORRECT')),
  authority text not null default 'GM_PRECEDENT' check (authority='GM_PRECEDENT'),
  ability_ids text[] not null default '{}',
  role_ids text[] not null default '{}',
  status_types text[] not null default '{}',
  rule_versions jsonb not null default '{}'::jsonb check (jsonb_typeof(rule_versions)='object'),
  tags text[] not null default '{}',
  use_count integer not null default 0 check (use_count>=0),
  version integer not null default 1 check (version>0),
  superseded_by uuid references public.gm_precedents(id) on delete set null,
  created_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.resolution_sessions
  add constraint resolution_sessions_precedent_fkey foreign key(precedent_id) references public.gm_precedents(id) on delete set null;

create table public.ai_drafts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  draft_type text not null check (draft_type in ('ROLE','ABILITY')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  request_text text not null default '' check (char_length(request_text)<=6000),
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=100000),
  possible_duplicate boolean not null default false,
  duplicate_notes text not null default '' check (char_length(duplicate_notes)<=4000),
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','REJECTED')),
  model text not null default '' check (char_length(model)<=120),
  request_id uuid,
  source_versions jsonb not null default '{}'::jsonb check (jsonb_typeof(source_versions)='object'),
  created_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table public.ability_interactions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  source_ability_id text not null check (char_length(source_ability_id) between 1 and 120),
  target_ability_or_effect text not null check (char_length(target_ability_or_effect) between 1 and 160),
  result text not null check (result in ('SUCCEEDS','FAILS','BLOCKS','REDIRECTS','REFLECTS','TRANSFERS','BYPASSES','TRIGGERS','PARTIAL','GM_DECISION_REQUIRED')),
  notes text not null default '' check (char_length(notes)<=8000),
  exceptions text not null default '' check (char_length(exceptions)<=8000),
  authority text not null check (authority in ('OFFICIAL_DOCUMENT','GAME_RULE','GM_PRECEDENT')),
  source_reference text not null check (char_length(source_reference) between 1 and 500),
  source_version text not null default '' check (char_length(source_version)<=120),
  source_precedent_id uuid references public.gm_precedents(id) on delete set null,
  version integer not null default 1 check (version>0),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(game_id,source_ability_id,target_ability_or_effect,authority,source_reference,version)
);

create table public.ai_usage_limits (
  game_id uuid primary key references public.games(id) on delete cascade,
  monthly_limit_usd numeric(12,4) check (monthly_limit_usd is null or monthly_limit_usd between 0 and 100000),
  requests_per_minute integer not null default 12 check (requests_per_minute between 1 and 120),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.ai_usage_events (
  id uuid primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('assistant','resolve_actions','explain_role','plan_session','create_role','create_ability','balance_role','document_import','knowledge_ingest')),
  model text not null check (char_length(model) between 1 and 120),
  provider_response_id text not null default '' check (char_length(provider_response_id)<=200),
  input_tokens integer not null default 0 check (input_tokens>=0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens>=0 and cached_input_tokens<=input_tokens),
  output_tokens integer not null default 0 check (output_tokens>=0),
  estimated_cost_usd numeric(14,8) not null default 0 check (estimated_cost_usd>=0),
  pricing_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(pricing_snapshot)='object'),
  latency_ms integer check (latency_ms is null or latency_ms>=0),
  status text not null default 'STARTED' check (status in ('STARTED','COMPLETED','FAILED')),
  error_code text not null default '' check (char_length(error_code)<=120),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index resolution_sessions_game_created_idx on public.resolution_sessions(game_id,created_at desc);
create index resolution_sessions_open_idx on public.resolution_sessions(game_id,status,updated_at desc) where status not in ('FINALIZED','REJECTED');
create index resolution_session_events_session_idx on public.resolution_session_events(session_id,event_order);
create index resolution_session_events_game_idx on public.resolution_session_events(game_id,created_at desc);
create index gm_precedents_game_status_idx on public.gm_precedents(game_id,status,updated_at desc);
create index gm_precedents_signature_idx on public.gm_precedents(game_id,lower(interaction_signature)) where status in ('ACTIVE','CONFLICTING');
create index gm_precedents_tokens_idx on public.gm_precedents using gin(signature_tokens);
create index gm_precedents_abilities_idx on public.gm_precedents using gin(ability_ids);
create index gm_precedents_roles_idx on public.gm_precedents using gin(role_ids);
create index gm_precedents_created_by_idx on public.gm_precedents(created_by);
create index gm_precedents_approved_by_idx on public.gm_precedents(approved_by);
create index ai_drafts_game_status_idx on public.ai_drafts(game_id,status,created_at desc);
create index ai_drafts_created_by_idx on public.ai_drafts(created_by);
create index ai_drafts_reviewed_by_idx on public.ai_drafts(reviewed_by) where reviewed_by is not null;
create index ability_interactions_lookup_idx on public.ability_interactions(game_id,source_ability_id,target_ability_or_effect) where active;
create index ability_interactions_precedent_idx on public.ability_interactions(source_precedent_id) where source_precedent_id is not null;
create index ability_interactions_created_by_idx on public.ability_interactions(created_by);
create index ai_usage_events_game_created_idx on public.ai_usage_events(game_id,created_at desc);
create index ai_usage_events_user_created_idx on public.ai_usage_events(user_id,created_at desc);
create index ai_usage_events_monthly_idx on public.ai_usage_events(game_id,created_at) where status='COMPLETED';
create index ai_usage_limits_updated_by_idx on public.ai_usage_limits(updated_by);

alter table public.resolution_sessions enable row level security;
alter table public.resolution_session_events enable row level security;
alter table public.gm_precedents enable row level security;
alter table public.ai_drafts enable row level security;
alter table public.ability_interactions enable row level security;
alter table public.ai_usage_limits enable row level security;
alter table public.ai_usage_events enable row level security;

create policy resolution_sessions_read_gm on public.resolution_sessions for select to authenticated using ((select public.can_edit_game(game_id)));
create policy resolution_events_read_gm on public.resolution_session_events for select to authenticated using ((select public.can_edit_game(game_id)));
create policy gm_precedents_read_gm on public.gm_precedents for select to authenticated using ((select public.can_edit_game(game_id)));
create policy ai_drafts_read_gm on public.ai_drafts for select to authenticated using ((select public.can_edit_game(game_id)));
create policy ability_interactions_read_gm on public.ability_interactions for select to authenticated using ((select public.can_edit_game(game_id)));
create policy ai_usage_limits_read_owner on public.ai_usage_limits for select to authenticated using ((select public.is_game_owner(game_id)));
create policy ai_usage_events_read_owner on public.ai_usage_events for select to authenticated using ((select public.is_game_owner(game_id)));

grant select on public.resolution_sessions,public.resolution_session_events,public.gm_precedents,public.ai_drafts,public.ability_interactions to authenticated;
grant select on public.ai_usage_limits,public.ai_usage_events to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.resolution_sessions,public.resolution_session_events,public.gm_precedents,public.ai_drafts,public.ability_interactions,public.ai_usage_limits,public.ai_usage_events from anon,authenticated;

create or replace function private.start_resolution_session(target_game_id uuid,expected_game_version integer)
returns public.resolution_sessions
language plpgsql security definer set search_path=''
as $$
declare actor uuid := (select auth.uid()); stored public.game_documents%rowtype; result public.resolution_sessions%rowtype; actions jsonb; relevant text[];
begin
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select * into stored from public.game_documents where game_id=target_game_id;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  if expected_game_version is not null and stored.version<>expected_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  actions:=coalesce(stored.document#>'{data,actions}','[]'::jsonb);
  if jsonb_typeof(actions)<>'array' then raise exception using errcode='22023',message='INVALID_ACTION_QUEUE'; end if;
  select coalesce(array_agg(distinct player_id) filter(where player_id<>''),'{}') into relevant
  from jsonb_array_elements(actions) action cross join lateral (values(coalesce(action->>'actorId','')),(coalesce(action->>'targetId',''))) ids(player_id);
  insert into public.resolution_sessions(game_id,cycle,phase,source_game_version,submitted_actions,relevant_player_ids,pre_resolution_state,source_versions,created_by)
  values(target_game_id,greatest(0,coalesce((stored.document#>>'{game,currentDay}')::integer,0)),case when stored.document#>>'{game,currentPhase}' in ('Day','Night') then stored.document#>>'{game,currentPhase}' else 'Any' end,stored.version,actions,relevant,
    jsonb_build_object('players',coalesce((select jsonb_agg(player) from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=any(relevant)),'[]'::jsonb),'statuses',coalesce((select jsonb_agg(to_jsonb(effect)) from public.player_status_effects effect where effect.game_id=target_game_id and effect.player_id=any(relevant) and effect.state in ('ACTIVE','PENDING')),'[]'::jsonb)),
    jsonb_build_object('gameVersion',stored.version,'officialDocuments',coalesce((select jsonb_agg(jsonb_build_object('documentId',document.id,'versionId',version.id,'version',version.version_number,'type',document.document_type)) from public.official_documents document join public.official_document_versions version on version.document_id=document.id where document.game_id=target_game_id and version.status='ACTIVE'),'[]'::jsonb),'standardAbilities',coalesce((select jsonb_agg(jsonb_build_object('abilityId',version.ability_id,'version',version.version_number,'scope',case when version.game_id is null then 'global' else 'game' end)) from public.standard_ability_versions version where version.status='ACTIVE' and (version.game_id is null or version.game_id=target_game_id)),'[]'::jsonb)),actor)
  returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(target_game_id,actor,'resolution_session',result.id::text,'Resolution session opened',jsonb_build_object('cycle',result.cycle,'phase',result.phase,'actionCount',jsonb_array_length(actions)));
  return result;
end $$;

create or replace function private.finalize_resolution_session(target_session_id uuid,expected_lock_version integer,target_decision text,target_manual_resolution jsonb,target_gm_explanation text,target_teach_ai boolean)
returns public.resolution_sessions
language plpgsql security definer set search_path=''
as $$
declare actor uuid := (select auth.uid()); current_row public.resolution_sessions%rowtype; result public.resolution_sessions%rowtype; decision text:=upper(btrim(coalesce(target_decision,''))); manual jsonb:=coalesce(target_manual_resolution,'{}'::jsonb); final_value jsonb; signature text; tokens text[]; precedent uuid; item jsonb; ordinal integer:=0; event_kind text;
begin
  select * into current_row from public.resolution_sessions where id=target_session_id for update;
  if not found then raise exception using errcode='P0002',message='RESOLUTION_SESSION_NOT_FOUND'; end if;
  if actor is null or not public.can_edit_game(current_row.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if current_row.lock_version<>expected_lock_version then raise exception using errcode='40001',message='RESOLUTION_VERSION_CONFLICT'; end if;
  if current_row.status in ('FINALIZED','REJECTED') then raise exception using errcode='55000',message='RESOLUTION_ALREADY_FINALIZED'; end if;
  if decision not in ('APPROVE','MODIFY','REJECT') then raise exception using errcode='22023',message='INVALID_GM_DECISION'; end if;
  if jsonb_typeof(manual)<>'object' or octet_length(manual::text)>300000 then raise exception using errcode='22023',message='INVALID_MANUAL_RESOLUTION'; end if;
  if decision='APPROVE' then final_value:=coalesce(current_row.ai_proposal->'resolution',current_row.ai_proposal); else final_value:=manual; end if;
  if decision<>'REJECT' and (final_value is null or jsonb_typeof(final_value)<>'object') then raise exception using errcode='22023',message='FINAL_RESOLUTION_REQUIRED'; end if;
  if coalesce(target_teach_ai,false) and char_length(btrim(coalesce(target_gm_explanation,'')))<3 then raise exception using errcode='22023',message='PRECEDENT_REASON_REQUIRED'; end if;
  update public.resolution_sessions set status=case when decision='REJECT' then 'REJECTED' else 'FINALIZED' end,lock_version=lock_version+1,gm_decision=decision,manual_resolution=case when decision='APPROVE' then null else manual end,final_resolution=final_value,post_resolution_state=manual->'post_resolution_state',gm_explanation=left(coalesce(target_gm_explanation,''),12000),teach_ai=coalesce(target_teach_ai,false),approved_by=actor,updated_at=now(),finalized_at=now()
  where id=target_session_id returning * into result;
  delete from public.resolution_session_events where session_id=target_session_id;
  if jsonb_typeof(final_value->'events')='array' then
    for item in select value from jsonb_array_elements(final_value->'events') loop
      ordinal:=ordinal+1; event_kind:=upper(coalesce(item->>'event_type','OTHER'));
      if event_kind not in ('SUCCESS','FAILURE','BLOCK','REDIRECT','REFLECT','TRANSFER','PASSIVE_TRIGGER','PROTECTION_USED','DEATH','SURVIVAL','CONVERSION','STATUS_ADDED','STATUS_REMOVED','ABILITY_CONSUMED','STATE_CHANGE','OTHER') then event_kind:='OTHER'; end if;
      insert into public.resolution_session_events(session_id,game_id,event_order,event_type,actor_player_id,target_player_id,ability_id,outcome)
      values(target_session_id,current_row.game_id,ordinal,event_kind,nullif(item->>'actor_player_id',''),nullif(item->>'target_player_id',''),nullif(item->>'ability_id',''),item);
    end loop;
  end if;
  if coalesce(target_teach_ai,false) then
    signature:=btrim(coalesce(manual->>'interaction_signature',final_value->>'interaction_signature',''));
    select coalesce(array_agg(distinct lower(btrim(value))) filter(where btrim(value)<>''),'{}') into tokens from jsonb_array_elements_text(coalesce(manual->'signature_tokens',final_value->'signature_tokens','[]'::jsonb));
    if signature='' then signature:=array_to_string(tokens,' + '); end if;
    if signature='' or cardinality(tokens)=0 then raise exception using errcode='22023',message='PRECEDENT_SIGNATURE_REQUIRED'; end if;
    insert into public.gm_precedents(game_id,source_resolution_session_id,title,summary,interaction_signature,signature_tokens,conditions,submitted_actions,resolution_order,final_outcome,gm_reasoning,scope,ability_ids,role_ids,status_types,rule_versions,tags,created_by,approved_by)
    values(current_row.game_id,current_row.id,left(coalesce(nullif(manual->>'title',''),'Resolution '||current_row.cycle||' '||current_row.phase),200),left(coalesce(manual->>'summary',''),4000),signature,tokens,coalesce(manual->'conditions','{}'::jsonb),current_row.submitted_actions,coalesce(final_value->'resolution_order','[]'::jsonb),final_value,left(coalesce(target_gm_explanation,''),12000),case when coalesce(manual->>'scope','GAME_SPECIFIC') in ('GENERAL','ABILITY_SPECIFIC','ROLE_SPECIFIC','GAME_SPECIFIC','ONE_TIME') then manual->>'scope' else 'GAME_SPECIFIC' end,coalesce(array(select jsonb_array_elements_text(coalesce(manual->'ability_ids','[]'::jsonb))),'{}'),coalesce(array(select jsonb_array_elements_text(coalesce(manual->'role_ids','[]'::jsonb))),'{}'),coalesce(array(select jsonb_array_elements_text(coalesce(manual->'status_types','[]'::jsonb))),'{}'),current_row.source_versions,coalesce(array(select jsonb_array_elements_text(coalesce(manual->'tags','[]'::jsonb))),'{}'),actor,actor)
    returning id into precedent;
    update public.gm_precedents existing set status='CONFLICTING',updated_at=now(),version=version+1 where existing.game_id=current_row.game_id and existing.id<>precedent and existing.status='ACTIVE' and lower(existing.interaction_signature)=lower(signature) and existing.final_outcome<>final_value;
    if found then update public.gm_precedents set status='CONFLICTING',updated_at=now(),version=version+1 where id=precedent; end if;
    update public.resolution_sessions set precedent_id=precedent where id=target_session_id returning * into result;
    insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(current_row.game_id,actor,'gm_precedent',precedent::text,'GM precedent created from approved resolution',jsonb_build_object('signature',signature,'scope',manual->>'scope'));
  end if;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(current_row.game_id,actor,'resolution_session',target_session_id::text,'Resolution '||lower(decision),jsonb_build_object('status',current_row.status,'lockVersion',current_row.lock_version),jsonb_build_object('status',result.status,'lockVersion',result.lock_version,'teachAi',result.teach_ai));
  return result;
end $$;

create or replace function private.review_ai_draft(target_draft_id uuid,target_status text)
returns public.ai_drafts language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); result public.ai_drafts%rowtype; next_status text:=upper(btrim(coalesce(target_status,'')));
begin
  select * into result from public.ai_drafts where id=target_draft_id for update;
  if not found then raise exception using errcode='P0002',message='AI_DRAFT_NOT_FOUND'; end if;
  if actor is null or not public.can_edit_game(result.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if result.status<>'DRAFT' then raise exception using errcode='55000',message='AI_DRAFT_ALREADY_REVIEWED'; end if;
  if next_status not in ('APPROVED','REJECTED') then raise exception using errcode='22023',message='INVALID_DRAFT_STATUS'; end if;
  update public.ai_drafts set status=next_status,reviewed_by=actor,reviewed_at=now(),updated_at=now() where id=target_draft_id returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(result.game_id,actor,lower(result.draft_type)||'_draft',result.id::text,initcap(lower(result.draft_type))||' draft '||lower(next_status),jsonb_build_object('title',result.title,'status',next_status));
  return result;
end $$;

create or replace function private.manage_gm_precedent(target_precedent_id uuid,expected_version integer,target_status text,target_superseded_by uuid default null)
returns public.gm_precedents language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); result public.gm_precedents%rowtype; next_status text:=upper(btrim(coalesce(target_status,'')));
begin
  select * into result from public.gm_precedents where id=target_precedent_id for update;
  if not found then raise exception using errcode='P0002',message='PRECEDENT_NOT_FOUND'; end if;
  if actor is null or not public.can_edit_game(result.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if result.version<>expected_version then raise exception using errcode='40001',message='PRECEDENT_VERSION_CONFLICT'; end if;
  if next_status not in ('ACTIVE','CONFLICTING','SUPERSEDED','ARCHIVED','INCORRECT') then raise exception using errcode='22023',message='INVALID_PRECEDENT_STATUS'; end if;
  if target_superseded_by is not null and not exists(select 1 from public.gm_precedents other where other.id=target_superseded_by and other.game_id=result.game_id) then raise exception using errcode='23503',message='SUPERSEDING_PRECEDENT_NOT_FOUND'; end if;
  update public.gm_precedents set status=next_status,superseded_by=case when next_status='SUPERSEDED' then target_superseded_by else null end,version=version+1,updated_at=now() where id=target_precedent_id returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(result.game_id,actor,'gm_precedent',result.id::text,'GM precedent marked '||lower(next_status),jsonb_build_object('status',next_status,'version',result.version));
  return result;
end $$;

create or replace function private.set_ai_usage_limit(target_game_id uuid,target_monthly_limit_usd numeric,target_requests_per_minute integer)
returns public.ai_usage_limits language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); result public.ai_usage_limits%rowtype;
begin
  if actor is null or not public.is_game_owner(target_game_id) then raise exception using errcode='42501',message='OWNER_ACCESS_REQUIRED'; end if;
  if target_monthly_limit_usd is not null and (target_monthly_limit_usd<0 or target_monthly_limit_usd>100000) or target_requests_per_minute not between 1 and 120 then raise exception using errcode='22023',message='INVALID_AI_USAGE_LIMIT'; end if;
  insert into public.ai_usage_limits(game_id,monthly_limit_usd,requests_per_minute,updated_by) values(target_game_id,target_monthly_limit_usd,target_requests_per_minute,actor)
  on conflict(game_id) do update set monthly_limit_usd=excluded.monthly_limit_usd,requests_per_minute=excluded.requests_per_minute,updated_by=actor,updated_at=now() returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(target_game_id,actor,'ai_usage_limit',target_game_id::text,'AI usage limits updated',jsonb_build_object('monthlyLimitUsd',target_monthly_limit_usd,'requestsPerMinute',target_requests_per_minute));
  return result;
end $$;

create or replace function public.start_resolution_session(target_game_id uuid,expected_game_version integer)
returns public.resolution_sessions language sql security invoker set search_path='' as $$select private.start_resolution_session(target_game_id,expected_game_version)$$;
create or replace function public.finalize_resolution_session(target_session_id uuid,expected_lock_version integer,target_decision text,target_manual_resolution jsonb,target_gm_explanation text,target_teach_ai boolean)
returns public.resolution_sessions language sql security invoker set search_path='' as $$select private.finalize_resolution_session(target_session_id,expected_lock_version,target_decision,target_manual_resolution,target_gm_explanation,target_teach_ai)$$;
create or replace function public.review_ai_draft(target_draft_id uuid,target_status text)
returns public.ai_drafts language sql security invoker set search_path='' as $$select private.review_ai_draft(target_draft_id,target_status)$$;
create or replace function public.manage_gm_precedent(target_precedent_id uuid,expected_version integer,target_status text,target_superseded_by uuid default null)
returns public.gm_precedents language sql security invoker set search_path='' as $$select private.manage_gm_precedent(target_precedent_id,expected_version,target_status,target_superseded_by)$$;
create or replace function public.set_ai_usage_limit(target_game_id uuid,target_monthly_limit_usd numeric,target_requests_per_minute integer)
returns public.ai_usage_limits language sql security invoker set search_path='' as $$select private.set_ai_usage_limit(target_game_id,target_monthly_limit_usd,target_requests_per_minute)$$;

create or replace function public.search_gm_precedents(target_game_id uuid,target_signature_tokens text[],target_query text default '',match_count integer default 8)
returns table(id uuid,precedent_number bigint,title text,summary text,interaction_signature text,signature_tokens text[],conditions jsonb,final_outcome jsonb,gm_reasoning text,scope text,status text,ability_ids text[],role_ids text[],rule_versions jsonb,version integer,created_at timestamptz,similarity_score numeric,similarity text)
language sql stable security invoker set search_path=''
as $$
  with requested as (select coalesce(array(select distinct lower(btrim(token)) from unnest(coalesce(target_signature_tokens,'{}')) token where btrim(token)<>''),'{}') tokens), ranked as (
    select precedent.*,case when cardinality(requested.tokens)=0 then 0::numeric else (select count(*)::numeric from unnest(precedent.signature_tokens) token where lower(token)=any(requested.tokens))/greatest(cardinality(requested.tokens),cardinality(precedent.signature_tokens)) end score
    from public.gm_precedents precedent cross join requested where precedent.game_id=target_game_id and precedent.status in ('ACTIVE','CONFLICTING') and (cardinality(requested.tokens)=0 or precedent.signature_tokens&&requested.tokens or (btrim(coalesce(target_query,''))<>'' and lower(precedent.interaction_signature) like '%'||lower(btrim(target_query))||'%'))
  )
  select id,precedent_number,title,summary,interaction_signature,signature_tokens,conditions,final_outcome,gm_reasoning,scope,status,ability_ids,role_ids,rule_versions,version,created_at,score,case when score=1 then 'EXACT' when score>=0.6 then 'STRONG' else 'PARTIAL' end from ranked order by score desc,created_at desc limit least(greatest(match_count,1),25)
$$;

create or replace function public.get_ai_learning_summary(target_game_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$
select case when public.can_edit_game(target_game_id) then jsonb_build_object(
  'manualResolutions',(select count(*) from public.resolution_sessions where game_id=target_game_id and final_resolution is not null),
  'aiApproved',(select count(*) from public.resolution_sessions where game_id=target_game_id and gm_decision='APPROVE'),
  'aiModified',(select count(*) from public.resolution_sessions where game_id=target_game_id and gm_decision='MODIFY'),
  'aiRejected',(select count(*) from public.resolution_sessions where game_id=target_game_id and gm_decision='REJECT'),
  'totalPrecedents',(select count(*) from public.gm_precedents where game_id=target_game_id),
  'activePrecedents',(select count(*) from public.gm_precedents where game_id=target_game_id and status='ACTIVE'),
  'conflictingPrecedents',(select count(*) from public.gm_precedents where game_id=target_game_id and status='CONFLICTING'),
  'supersededPrecedents',(select count(*) from public.gm_precedents where game_id=target_game_id and status='SUPERSEDED'),
  'draftRoles',(select count(*) from public.ai_drafts where game_id=target_game_id and draft_type='ROLE' and status='DRAFT'),
  'draftAbilities',(select count(*) from public.ai_drafts where game_id=target_game_id and draft_type='ABILITY' and status='DRAFT')
) else (select jsonb_build_object('error','GM_ACCESS_REQUIRED')) end
$$;

create or replace function public.reserve_ai_usage_internal(target_game_id uuid,actor_user_id uuid,target_feature text,target_model text,target_request_id uuid,target_pricing_snapshot jsonb)
returns uuid language plpgsql security definer set search_path=''
as $$
declare limit_row public.ai_usage_limits%rowtype; recent_count integer; month_cost numeric; lock_key bigint;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if not exists(select 1 from public.game_members where game_id=target_game_id and user_id=actor_user_id and member_role in ('owner','gm')) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if target_feature not in ('assistant','resolve_actions','explain_role','plan_session','create_role','create_ability','balance_role','document_import','knowledge_ingest') or char_length(target_model) not between 1 and 120 then raise exception using errcode='22023',message='INVALID_AI_USAGE_REQUEST'; end if;
  lock_key:=hashtextextended(target_game_id::text,9317);perform pg_advisory_xact_lock(lock_key);
  select * into limit_row from public.ai_usage_limits where game_id=target_game_id;
  select count(*) into recent_count from public.ai_usage_events where game_id=target_game_id and created_at>=now()-interval '1 minute';
  if recent_count>=coalesce(limit_row.requests_per_minute,12) then raise exception using errcode='P0001',message='AI_RATE_LIMIT_REACHED'; end if;
  select coalesce(sum(estimated_cost_usd),0) into month_cost from public.ai_usage_events where game_id=target_game_id and status='COMPLETED' and created_at>=date_trunc('month',now());
  if limit_row.monthly_limit_usd is not null and month_cost>=limit_row.monthly_limit_usd then raise exception using errcode='P0001',message='AI_MONTHLY_LIMIT_REACHED'; end if;
  insert into public.ai_usage_events(id,game_id,user_id,feature,model,pricing_snapshot) values(target_request_id,target_game_id,actor_user_id,target_feature,target_model,coalesce(target_pricing_snapshot,'{}'::jsonb));return target_request_id;
end $$;

create or replace function public.complete_ai_usage_internal(target_request_id uuid,target_provider_response_id text,target_input_tokens integer,target_cached_input_tokens integer,target_output_tokens integer,target_estimated_cost_usd numeric,target_latency_ms integer,target_status text,target_error_code text)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  update public.ai_usage_events set provider_response_id=left(coalesce(target_provider_response_id,''),200),input_tokens=greatest(coalesce(target_input_tokens,0),0),cached_input_tokens=least(greatest(coalesce(target_cached_input_tokens,0),0),greatest(coalesce(target_input_tokens,0),0)),output_tokens=greatest(coalesce(target_output_tokens,0),0),estimated_cost_usd=greatest(coalesce(target_estimated_cost_usd,0),0),latency_ms=greatest(coalesce(target_latency_ms,0),0),status=case when target_status='COMPLETED' then 'COMPLETED' else 'FAILED' end,error_code=left(coalesce(target_error_code,''),120),completed_at=now() where id=target_request_id;
end $$;

create or replace function public.record_resolution_ai_proposal_internal(target_session_id uuid,expected_lock_version integer,target_proposal jsonb,target_model text,target_request_id uuid,target_response_id text,actor_user_id uuid)
returns public.resolution_sessions language plpgsql security definer set search_path=''
as $$
declare result public.resolution_sessions%rowtype;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  select * into result from public.resolution_sessions where id=target_session_id for update;if not found then raise exception using errcode='P0002',message='RESOLUTION_SESSION_NOT_FOUND'; end if;
  if not exists(select 1 from public.game_members where game_id=result.game_id and user_id=actor_user_id and member_role in ('owner','gm')) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if result.lock_version<>expected_lock_version or result.status in ('FINALIZED','REJECTED') then raise exception using errcode='40001',message='RESOLUTION_VERSION_CONFLICT'; end if;
  if jsonb_typeof(target_proposal)<>'object' or octet_length(target_proposal::text)>300000 then raise exception using errcode='22023',message='INVALID_AI_PROPOSAL'; end if;
  update public.resolution_sessions set status='AI_PROPOSED',lock_version=lock_version+1,ai_proposal=target_proposal,ai_model=left(target_model,120),ai_request_id=target_request_id,ai_response_id=left(coalesce(target_response_id,''),200),ai_confidence=case when target_proposal->>'confidence' in ('high','medium','low') then target_proposal->>'confidence' else 'low' end,ai_authority=case when target_proposal->>'authority' in ('saved_game','official_sources','gm_precedent','mixed','insufficient') then target_proposal->>'authority' else 'insufficient' end,updated_at=now() where id=target_session_id returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(result.game_id,actor_user_id,'resolution_session',result.id::text,'AI resolution proposed',jsonb_build_object('model',target_model,'requestId',target_request_id,'lockVersion',result.lock_version));return result;
end $$;

create or replace function public.create_ai_draft_internal(target_game_id uuid,target_draft_type text,target_title text,target_request_text text,target_payload jsonb,target_possible_duplicate boolean,target_duplicate_notes text,target_model text,target_request_id uuid,target_source_versions jsonb,actor_user_id uuid)
returns public.ai_drafts language plpgsql security definer set search_path=''
as $$
declare result public.ai_drafts%rowtype;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if not exists(select 1 from public.game_members where game_id=target_game_id and user_id=actor_user_id and member_role in ('owner','gm')) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if target_draft_type not in ('ROLE','ABILITY') or jsonb_typeof(target_payload)<>'object' or octet_length(target_payload::text)>100000 then raise exception using errcode='22023',message='INVALID_AI_DRAFT'; end if;
  insert into public.ai_drafts(game_id,draft_type,title,request_text,payload,possible_duplicate,duplicate_notes,model,request_id,source_versions,created_by) values(target_game_id,target_draft_type,left(target_title,200),left(coalesce(target_request_text,''),6000),target_payload,coalesce(target_possible_duplicate,false),left(coalesce(target_duplicate_notes,''),4000),left(target_model,120),target_request_id,coalesce(target_source_versions,'{}'::jsonb),actor_user_id) returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(target_game_id,actor_user_id,lower(target_draft_type)||'_draft',result.id::text,initcap(lower(target_draft_type))||' draft created',jsonb_build_object('title',result.title,'model',target_model));return result;
end $$;

revoke all on function private.start_resolution_session(uuid,integer),private.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean),private.review_ai_draft(uuid,text),private.manage_gm_precedent(uuid,integer,text,uuid),private.set_ai_usage_limit(uuid,numeric,integer) from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.start_resolution_session(uuid,integer),private.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean),private.review_ai_draft(uuid,text),private.manage_gm_precedent(uuid,integer,text,uuid),private.set_ai_usage_limit(uuid,numeric,integer) to authenticated;
revoke all on function public.start_resolution_session(uuid,integer),public.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean),public.review_ai_draft(uuid,text),public.manage_gm_precedent(uuid,integer,text,uuid),public.set_ai_usage_limit(uuid,numeric,integer),public.search_gm_precedents(uuid,text[],text,integer),public.get_ai_learning_summary(uuid) from public,anon;
grant execute on function public.start_resolution_session(uuid,integer),public.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean),public.review_ai_draft(uuid,text),public.manage_gm_precedent(uuid,integer,text,uuid),public.set_ai_usage_limit(uuid,numeric,integer),public.search_gm_precedents(uuid,text[],text,integer),public.get_ai_learning_summary(uuid) to authenticated;
revoke all on function public.reserve_ai_usage_internal(uuid,uuid,text,text,uuid,jsonb),public.complete_ai_usage_internal(uuid,text,integer,integer,integer,numeric,integer,text,text),public.record_resolution_ai_proposal_internal(uuid,integer,jsonb,text,uuid,text,uuid),public.create_ai_draft_internal(uuid,text,text,text,jsonb,boolean,text,text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.reserve_ai_usage_internal(uuid,uuid,text,text,uuid,jsonb),public.complete_ai_usage_internal(uuid,text,integer,integer,integer,numeric,integer,text,text),public.record_resolution_ai_proposal_internal(uuid,integer,jsonb,text,uuid,text,uuid),public.create_ai_draft_internal(uuid,text,text,text,jsonb,boolean,text,text,uuid,jsonb,uuid) to service_role;

do $$ begin alter publication supabase_realtime add table public.resolution_sessions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.gm_precedents; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.ai_drafts; exception when duplicate_object then null; end $$;
