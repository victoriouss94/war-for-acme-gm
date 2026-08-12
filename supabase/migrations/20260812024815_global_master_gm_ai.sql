-- Extend the existing consolidated AI GM architecture with owner-scoped,
-- explicitly approved cross-game learning. No existing game, precedent,
-- resolution, status, document, ability, conversation, or audit data is reset.

alter table public.gm_precedents drop constraint gm_precedents_scope_check;
alter table public.gm_precedents drop constraint gm_precedents_authority_check;
alter table public.gm_precedents
  add column approved_for_global_use boolean not null default false,
  add column compatibility_metadata jsonb not null default '{}'::jsonb,
  add column mechanic_fingerprint jsonb not null default '{}'::jsonb,
  add column normalized_actions jsonb not null default '[]'::jsonb,
  add column global_concept_ids text[] not null default '{}',
  add column source_precedent_ids uuid[] not null default '{}',
  add column correction_metadata jsonb not null default '{}'::jsonb,
  add column origin_game_name_snapshot text not null default '';
alter table public.gm_precedents
  add constraint gm_precedents_scope_check check (scope in ('GENERAL','GLOBAL','ABILITY_SPECIFIC','ROLE_SPECIFIC','GAME_SPECIFIC','ONE_TIME')),
  add constraint gm_precedents_authority_check check (authority in ('GM_PRECEDENT','GLOBAL_OFFICIAL_RULE')),
  add constraint gm_precedents_global_approval_check check ((scope='GLOBAL')=approved_for_global_use),
  add constraint gm_precedents_global_role_isolation_check check (scope<>'GLOBAL' or cardinality(role_ids)=0),
  add constraint gm_precedents_global_authority_check check (authority<>'GLOBAL_OFFICIAL_RULE' or scope='GLOBAL'),
  add constraint gm_precedents_compatibility_metadata_check check (jsonb_typeof(compatibility_metadata)='object' and octet_length(compatibility_metadata::text)<=100000),
  add constraint gm_precedents_mechanic_fingerprint_check check (jsonb_typeof(mechanic_fingerprint)='object' and octet_length(mechanic_fingerprint::text)<=100000),
  add constraint gm_precedents_normalized_actions_check check (jsonb_typeof(normalized_actions)='array' and octet_length(normalized_actions::text)<=200000),
  add constraint gm_precedents_correction_metadata_check check (jsonb_typeof(correction_metadata)='object' and octet_length(correction_metadata::text)<=300000),
  add constraint gm_precedents_origin_game_name_snapshot_check check (char_length(origin_game_name_snapshot)<=100);

update public.gm_precedents precedent
set origin_game_name_snapshot=game.name,
    approved_for_global_use=(precedent.scope='GLOBAL')
from public.games game
where game.id=precedent.game_id and precedent.origin_game_name_snapshot='';

alter table public.resolution_sessions
  add column teach_scope text not null default 'GAME_SPECIFIC',
  add column used_precedent_ids uuid[] not null default '{}';
alter table public.resolution_sessions
  add constraint resolution_sessions_teach_scope_check check (teach_scope in ('GAME_SPECIFIC','GLOBAL'));

alter table public.official_documents
  add column scope text not null default 'GAME_SPECIFIC',
  add column owner_id uuid references auth.users(id) on delete cascade;
update public.official_documents document
set scope=case when document.game_id is null then 'SYSTEM_GLOBAL' else 'GAME_SPECIFIC' end,
    owner_id=game.owner_id
from public.games game
where game.id=document.game_id;
update public.official_documents set scope='SYSTEM_GLOBAL' where game_id is null;
alter table public.official_documents
  add constraint official_documents_scope_check check (scope in ('GAME_SPECIFIC','GLOBAL','SYSTEM_GLOBAL')),
  add constraint official_documents_scope_owner_check check (
    (scope='SYSTEM_GLOBAL' and game_id is null and owner_id is null)
    or (scope in ('GAME_SPECIFIC','GLOBAL') and game_id is not null and owner_id is not null)
  );

create table public.global_ability_concepts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  concept_key text not null check (concept_key ~ '^[A-Z0-9][A-Z0-9_]{2,119}$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text not null default '' check (char_length(description)<=8000),
  mechanics jsonb not null default '{}'::jsonb check (jsonb_typeof(mechanics)='object' and octet_length(mechanics::text)<=100000),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUPERSEDED','ARCHIVED')),
  version integer not null default 1 check (version>0),
  created_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,concept_key)
);

create table public.ability_concept_mappings (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  game_ability_id text not null check (char_length(btrim(game_ability_id)) between 1 and 120),
  global_concept_id uuid not null references public.global_ability_concepts(id) on delete restrict,
  compatibility_level text not null check (compatibility_level in ('EXACT','STRONG','PARTIAL','INCOMPATIBLE')),
  notes text not null default '' check (char_length(notes)<=8000),
  mechanic_fingerprint jsonb not null default '{}'::jsonb check (jsonb_typeof(mechanic_fingerprint)='object' and octet_length(mechanic_fingerprint::text)<=100000),
  active boolean not null default true,
  version integer not null check (version>0),
  created_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(game_id,game_ability_id,version)
);
create unique index ability_concept_mappings_active_idx on public.ability_concept_mappings(game_id,game_ability_id) where active;
create index ability_concept_mappings_concept_idx on public.ability_concept_mappings(global_concept_id,compatibility_level) where active;
create index global_ability_concepts_owner_idx on public.global_ability_concepts(owner_id,status,updated_at desc);
create index gm_precedents_global_signature_idx on public.gm_precedents(lower(interaction_signature),status,updated_at desc) where scope='GLOBAL';
create index gm_precedents_global_concepts_idx on public.gm_precedents using gin(global_concept_ids);

alter table public.global_ability_concepts enable row level security;
alter table public.ability_concept_mappings enable row level security;

create policy global_ability_concepts_read_authorized_gm on public.global_ability_concepts for select to authenticated using (
  exists(
    select 1 from public.games game join public.game_members member on member.game_id=game.id
    where game.owner_id=global_ability_concepts.owner_id and member.user_id=(select auth.uid()) and member.member_role in ('owner','gm')
  )
);
create policy ability_concept_mappings_read_authorized_gm on public.ability_concept_mappings for select to authenticated using (
  (select public.can_edit_game(game_id)) or exists(
    select 1 from public.games origin join public.games accessible on accessible.owner_id=origin.owner_id
    join public.game_members member on member.game_id=accessible.id
    where origin.id=ability_concept_mappings.game_id and member.user_id=(select auth.uid()) and member.member_role in ('owner','gm')
  )
);

grant select on public.global_ability_concepts,public.ability_concept_mappings to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.global_ability_concepts,public.ability_concept_mappings from anon,authenticated;

drop policy gm_precedents_read_gm on public.gm_precedents;
create policy gm_precedents_read_gm on public.gm_precedents for select to authenticated using (
  (select public.can_edit_game(game_id)) or (
    scope='GLOBAL' and exists(
      select 1 from public.games origin join public.games accessible on accessible.owner_id=origin.owner_id
      join public.game_members member on member.game_id=accessible.id
      where origin.id=gm_precedents.game_id and member.user_id=(select auth.uid()) and member.member_role in ('owner','gm')
    )
  )
);

drop policy official_documents_read on public.official_documents;
create policy official_documents_read on public.official_documents for select to authenticated using (
  scope='SYSTEM_GLOBAL' or (select public.is_game_member(game_id)) or (
    scope='GLOBAL' and exists(
      select 1 from public.games accessible join public.game_members member on member.game_id=accessible.id
      where accessible.owner_id=official_documents.owner_id and member.user_id=(select auth.uid()) and member.member_role in ('owner','gm')
    )
  )
);
drop policy official_document_versions_read on public.official_document_versions;
create policy official_document_versions_read on public.official_document_versions for select to authenticated using (
  exists(select 1 from public.official_documents document where document.id=document_id)
);
drop policy official_document_chunks_read on public.official_document_chunks;
create policy official_document_chunks_read on public.official_document_chunks for select to authenticated using (
  exists(
    select 1 from public.official_document_versions version
    join public.official_documents document on document.id=version.document_id
    where version.id=official_document_chunks.document_version_id
  )
);

drop function public.search_gm_precedents(uuid,text[],text,integer);
create function public.search_gm_precedents(target_game_id uuid,target_signature_tokens text[],target_query text default '',match_count integer default 8)
returns table(
  id uuid,precedent_number bigint,title text,summary text,interaction_signature text,signature_tokens text[],conditions jsonb,
  final_outcome jsonb,gm_reasoning text,scope text,status text,authority text,ability_ids text[],role_ids text[],status_types text[],
  rule_versions jsonb,global_concept_ids text[],compatibility_metadata jsonb,version integer,created_at timestamptz,
  origin_game_id uuid,origin_game_name text,authority_layer text,applicability text,compatibility_reasons jsonb,
  similarity_score numeric,similarity text
)
language plpgsql stable security invoker set search_path=''
as $$
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  return query
  with target as (
    select game.owner_id from public.games game where game.id=target_game_id
  ), requested as (
    select
      coalesce(array(select distinct lower(btrim(token)) from unnest(coalesce(target_signature_tokens,'{}')) token where btrim(token)<>''),'{}') tokens,
      coalesce(array(select regexp_replace(lower(token),'^ability:','') from unnest(coalesce(target_signature_tokens,'{}')) token where lower(token) like 'ability:%'),'{}') ability_tokens,
      coalesce(array(select regexp_replace(lower(token),'^role:','') from unnest(coalesce(target_signature_tokens,'{}')) token where lower(token) like 'role:%'),'{}') role_tokens,
      coalesce(array(select regexp_replace(lower(token),'^status:','') from unnest(coalesce(target_signature_tokens,'{}')) token where lower(token) like 'status:%'),'{}') status_tokens
  ), eligible as (
    select precedent.*,origin.name origin_name,
      case when precedent.game_id=target_game_id and precedent.scope<>'GLOBAL' then 'CURRENT_GAME_APPROVED_PRECEDENT'
           when precedent.authority='GLOBAL_OFFICIAL_RULE' then 'GLOBAL_OFFICIAL_GM_RULE'
           else 'GLOBAL_APPROVED_GM_PRECEDENT' end layer,
      case when cardinality(requested.tokens)=0 then 0::numeric else
        (select count(*)::numeric from unnest(precedent.signature_tokens) token where lower(token)=any(requested.tokens))
        /greatest(cardinality(requested.tokens),cardinality(precedent.signature_tokens)) end token_score,
      requested.tokens requested_tokens,requested.status_tokens,requested.ability_tokens,requested.role_tokens
    from public.gm_precedents precedent
    join public.games origin on origin.id=precedent.game_id
    cross join target cross join requested
    where precedent.status in ('ACTIVE','CONFLICTING') and precedent.scope<>'ONE_TIME'
      and (precedent.game_id=target_game_id or (precedent.scope='GLOBAL' and precedent.approved_for_global_use and origin.owner_id=target.owner_id))
      and (precedent.scope<>'ROLE_SPECIFIC' or (cardinality(precedent.role_ids)>0 and exists(select 1 from unnest(precedent.role_ids) role_id where regexp_replace(lower(role_id),'[^a-z0-9]+','_','g')=any(requested.role_tokens))))
      and (precedent.scope<>'ABILITY_SPECIFIC' or (cardinality(precedent.ability_ids)>0 and exists(select 1 from unnest(precedent.ability_ids) ability_id where regexp_replace(lower(ability_id),'[^a-z0-9]+','_','g')=any(requested.ability_tokens))))
      and (cardinality(requested.tokens)=0 or precedent.signature_tokens&&requested.tokens or precedent.global_concept_ids&&requested.tokens or (btrim(coalesce(target_query,''))<>'' and (lower(precedent.interaction_signature) like '%'||lower(btrim(target_query))||'%' or lower(precedent.gm_reasoning) like '%'||lower(btrim(target_query))||'%')))
  ), scored as (
    select eligible.*,
      greatest(0,least(1,eligible.token_score
        +case when eligible.game_id=target_game_id and eligible.scope<>'GLOBAL' then .15 else 0 end
        +case when eligible.authority='GLOBAL_OFFICIAL_RULE' then .10 else 0 end
        +case when eligible.global_concept_ids&&eligible.requested_tokens then .65 else 0 end
        -case when cardinality(eligible.status_types)>0 and not exists(select 1 from unnest(eligible.status_types) status_type where regexp_replace(lower(status_type),'[^a-z0-9]+','_','g')=any(eligible.status_tokens)) then .25 else 0 end
      ))::numeric compatibility_score
    from eligible
  )
  select scored.id,scored.precedent_number,scored.title,scored.summary,scored.interaction_signature,scored.signature_tokens,scored.conditions,
    scored.final_outcome,scored.gm_reasoning,scored.scope,scored.status,scored.authority,scored.ability_ids,scored.role_ids,scored.status_types,
    scored.rule_versions,scored.global_concept_ids,scored.compatibility_metadata,scored.version,scored.created_at,
    scored.game_id,coalesce(nullif(scored.origin_game_name_snapshot,''),scored.origin_name),scored.layer,
    case when scored.compatibility_score>=.95 then 'EXACT' when scored.compatibility_score>=.6 then 'STRONG' else 'PARTIAL' end,
    jsonb_strip_nulls(jsonb_build_object(
      'currentGame',scored.game_id=target_game_id,
      'statusContextMismatch',case when cardinality(scored.status_types)>0 and not exists(select 1 from unnest(scored.status_types) status_type where regexp_replace(lower(status_type),'[^a-z0-9]+','_','g')=any(scored.status_tokens)) then true else null end,
      'versionCheckRequired',scored.scope='GLOBAL',
      'roleSpecific',cardinality(scored.role_ids)>0
    )),scored.compatibility_score,
    case when scored.compatibility_score>=.95 then 'EXACT' when scored.compatibility_score>=.6 then 'STRONG' else 'PARTIAL' end
  from scored
  order by case scored.layer when 'CURRENT_GAME_APPROVED_PRECEDENT' then 1 when 'GLOBAL_OFFICIAL_GM_RULE' then 2 else 3 end,
    scored.compatibility_score desc,scored.created_at desc
  limit least(greatest(match_count,1),50);
end $$;

drop function public.get_ai_learning_summary(uuid);
create function public.get_ai_learning_summary(target_game_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare owner_id uuid;
begin
  if not public.can_edit_game(target_game_id) then return jsonb_build_object('error','GM_ACCESS_REQUIRED'); end if;
  select game.owner_id into owner_id from public.games game where game.id=target_game_id;
  return jsonb_build_object(
    'manualResolutions',(select count(*) from public.resolution_sessions where game_id=target_game_id and final_resolution is not null),
    'aiApproved',(select count(*) from public.resolution_sessions where game_id=target_game_id and gm_decision='APPROVE'),
    'aiModified',(select count(*) from public.resolution_sessions where game_id=target_game_id and gm_decision='MODIFY'),
    'aiRejected',(select count(*) from public.resolution_sessions where game_id=target_game_id and gm_decision='REJECT'),
    'totalPrecedents',(select count(*) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=owner_id),
    'activePrecedents',(select count(*) from public.gm_precedents where game_id=target_game_id and status='ACTIVE'),
    'gameSpecificPrecedents',(select count(*) from public.gm_precedents where game_id=target_game_id and scope<>'GLOBAL'),
    'globalPrecedents',(select count(*) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=owner_id and precedent.scope='GLOBAL' and precedent.authority='GM_PRECEDENT' and precedent.status in ('ACTIVE','CONFLICTING')),
    'globalOfficialRules',(select count(*) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=owner_id and precedent.scope='GLOBAL' and precedent.authority='GLOBAL_OFFICIAL_RULE' and precedent.status in ('ACTIVE','CONFLICTING')),
    'conflictingPrecedents',(select count(*) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=owner_id and precedent.status='CONFLICTING'),
    'supersededPrecedents',(select count(*) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=owner_id and precedent.status='SUPERSEDED'),
    'gamesContributing',(select count(distinct precedent.game_id) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=owner_id and precedent.status in ('ACTIVE','CONFLICTING','SUPERSEDED')),
    'draftRoles',(select count(*) from public.ai_drafts where game_id=target_game_id and draft_type='ROLE' and status='DRAFT'),
    'draftAbilities',(select count(*) from public.ai_drafts where game_id=target_game_id and draft_type='ABILITY' and status='DRAFT')
  );
end $$;

create function public.get_cross_game_learning_patterns(target_game_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare owner_id uuid;
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select game.owner_id into owner_id from public.games game where game.id=target_game_id;
  return jsonb_build_object(
    'consistentPatterns',coalesce((
      select jsonb_agg(pattern order by (pattern->>'rulingCount')::integer desc)
      from (
        select jsonb_build_object(
          'interactionSignature',min(precedent.interaction_signature),
          'rulingCount',count(*),
          'gameCount',count(distinct precedent.game_id),
          'games',array_agg(distinct game.name order by game.name),
          'commonOutcome',precedent.final_outcome,
          'commonReasoning',min(nullif(precedent.gm_reasoning,'')),
          'sourcePrecedentIds',array_agg(precedent.id order by precedent.created_at)
        ) pattern
        from public.gm_precedents precedent join public.games game on game.id=precedent.game_id
        where game.owner_id=owner_id and precedent.status='ACTIVE' and precedent.scope not in ('ONE_TIME','ROLE_SPECIFIC') and cardinality(precedent.role_ids)=0
        group by lower(precedent.interaction_signature),precedent.final_outcome
        having count(distinct precedent.game_id)>=2
      ) patterns
    ),'[]'::jsonb),
    'crossGameDifferences',coalesce((
      select jsonb_agg(difference)
      from (
        select jsonb_build_object(
          'interactionSignature',min(precedent.interaction_signature),
          'gameCount',count(distinct precedent.game_id),
          'outcomeCount',count(distinct md5(precedent.final_outcome::text)),
          'games',array_agg(distinct game.name order by game.name),
          'precedentIds',array_agg(precedent.id order by precedent.created_at)
        ) difference
        from public.gm_precedents precedent join public.games game on game.id=precedent.game_id
        where game.owner_id=owner_id and precedent.status in ('ACTIVE','CONFLICTING') and precedent.scope not in ('ONE_TIME','ROLE_SPECIFIC') and cardinality(precedent.role_ids)=0
        group by lower(precedent.interaction_signature)
        having count(distinct precedent.game_id)>=2 and count(distinct md5(precedent.final_outcome::text))>1
      ) differences
    ),'[]'::jsonb)
  );
end $$;

create function public.get_global_ability_concepts(target_game_id uuid)
returns table(id uuid,concept_key text,name text,description text,mechanics jsonb,status text,version integer,mapping_count bigint,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security invoker set search_path=''
as $$
declare target_owner uuid;
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select game.owner_id into target_owner from public.games game where game.id=target_game_id;
  return query select concept.id,concept.concept_key,concept.name,concept.description,concept.mechanics,concept.status,concept.version,
    (select count(*) from public.ability_concept_mappings mapping where mapping.global_concept_id=concept.id and mapping.active),concept.created_at,concept.updated_at
  from public.global_ability_concepts concept where concept.owner_id=target_owner order by concept.name;
end $$;

create function private.create_global_ability_concept(target_game_id uuid,target_concept_key text,target_name text,target_description text,target_mechanics jsonb)
returns public.global_ability_concepts language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); target_owner uuid; result public.global_ability_concepts%rowtype; concept_key text:=upper(btrim(coalesce(target_concept_key,'')));
begin
  select game.owner_id into target_owner from public.games game where game.id=target_game_id;
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if concept_key!~'^[A-Z0-9][A-Z0-9_]{2,119}$' or char_length(btrim(coalesce(target_name,''))) not between 1 and 160 or jsonb_typeof(coalesce(target_mechanics,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='INVALID_GLOBAL_CONCEPT'; end if;
  insert into public.global_ability_concepts(owner_id,concept_key,name,description,mechanics,created_by,approved_by)
  values(target_owner,concept_key,btrim(target_name),left(coalesce(target_description,''),8000),coalesce(target_mechanics,'{}'::jsonb),actor,actor) returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(target_game_id,actor,'global_ability_concept',result.id::text,'Global ability concept created',jsonb_build_object('conceptKey',concept_key,'name',result.name));
  return result;
end $$;

create function private.approve_ability_concept_mapping(target_game_id uuid,target_game_ability_id text,target_global_concept_id uuid,target_compatibility_level text,target_notes text,target_mechanic_fingerprint jsonb)
returns public.ability_concept_mappings language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); target_owner uuid; result public.ability_concept_mappings%rowtype; next_version integer; compatibility text:=upper(btrim(coalesce(target_compatibility_level,'')));
begin
  select game.owner_id into target_owner from public.games game where game.id=target_game_id;
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if compatibility not in ('EXACT','STRONG','PARTIAL','INCOMPATIBLE') or char_length(btrim(coalesce(target_game_ability_id,''))) not between 1 and 120 or char_length(btrim(coalesce(target_notes,'')))<3 or jsonb_typeof(coalesce(target_mechanic_fingerprint,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='INVALID_ABILITY_CONCEPT_MAPPING'; end if;
  if not exists(select 1 from public.global_ability_concepts concept where concept.id=target_global_concept_id and concept.owner_id=target_owner and concept.status='ACTIVE') then raise exception using errcode='23503',message='GLOBAL_CONCEPT_NOT_FOUND'; end if;
  if not exists(select 1 from public.game_documents document, jsonb_array_elements(coalesce(document.document#>'{data,abilities}','[]'::jsonb)) ability where document.game_id=target_game_id and ability->>'id'=target_game_ability_id)
     and not exists(select 1 from public.standard_abilities ability join public.game_ability_datasets dataset on dataset.dataset_id=ability.dataset_id and dataset.game_id=target_game_id where ability.id=target_game_ability_id)
  then raise exception using errcode='22023',message='GAME_ABILITY_NOT_FOUND'; end if;
  select coalesce(max(version),0)+1 into next_version from public.ability_concept_mappings where game_id=target_game_id and game_ability_id=target_game_ability_id;
  update public.ability_concept_mappings set active=false,updated_at=now() where game_id=target_game_id and game_ability_id=target_game_ability_id and active;
  insert into public.ability_concept_mappings(game_id,game_ability_id,global_concept_id,compatibility_level,notes,mechanic_fingerprint,version,created_by,approved_by)
  values(target_game_id,target_game_ability_id,target_global_concept_id,compatibility,left(coalesce(target_notes,''),8000),coalesce(target_mechanic_fingerprint,'{}'::jsonb),next_version,actor,actor) returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(target_game_id,actor,'ability_concept_mapping',result.id::text,'Global ability concept mapping approved',jsonb_build_object('abilityId',target_game_ability_id,'conceptId',target_global_concept_id,'compatibility',compatibility,'version',next_version));
  return result;
end $$;

create function private.remove_ability_concept_mapping(target_mapping_id uuid,target_reason text)
returns public.ability_concept_mappings language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); result public.ability_concept_mappings%rowtype;
begin
  select * into result from public.ability_concept_mappings where id=target_mapping_id for update;
  if not found then raise exception using errcode='P0002',message='ABILITY_MAPPING_NOT_FOUND'; end if;
  if actor is null or not public.can_edit_game(result.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if char_length(btrim(coalesce(target_reason,'')))<3 then raise exception using errcode='22023',message='ABILITY_MAPPING_REASON_REQUIRED'; end if;
  update public.ability_concept_mappings set active=false,updated_at=now() where id=target_mapping_id returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(result.game_id,actor,'ability_concept_mapping',result.id::text,'Global ability concept mapping removed',jsonb_build_object('active',true),jsonb_build_object('active',false,'reason',left(coalesce(target_reason,''),2000)));
  return result;
end $$;

drop function private.manage_gm_precedent(uuid,integer,text,uuid);
drop function public.manage_gm_precedent(uuid,integer,text,uuid);
create function private.manage_gm_precedent(target_precedent_id uuid,expected_version integer,target_status text,target_superseded_by uuid default null,target_scope text default null,target_authority text default null,target_reason text default '')
returns public.gm_precedents language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); result public.gm_precedents%rowtype; origin_owner uuid; next_status text:=upper(btrim(coalesce(target_status,''))); next_scope text; next_authority text; previous jsonb;
begin
  select * into result from public.gm_precedents where id=target_precedent_id for update;
  if not found then raise exception using errcode='P0002',message='PRECEDENT_NOT_FOUND'; end if;
  select game.owner_id into origin_owner from public.games game where game.id=result.game_id;
  if actor is null then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if result.version<>expected_version then raise exception using errcode='40001',message='PRECEDENT_VERSION_CONFLICT'; end if;
  next_scope:=upper(btrim(coalesce(target_scope,result.scope)));next_authority:=upper(btrim(coalesce(target_authority,result.authority)));
  if not public.can_edit_game(result.game_id) and not (
    (result.scope='GLOBAL' or next_scope='GLOBAL' or result.authority='GLOBAL_OFFICIAL_RULE' or next_authority='GLOBAL_OFFICIAL_RULE')
    and exists(select 1 from public.games accessible join public.game_members member on member.game_id=accessible.id where accessible.owner_id=origin_owner and member.user_id=actor and member.member_role in ('owner','gm'))
  ) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if next_status not in ('ACTIVE','CONFLICTING','SUPERSEDED','ARCHIVED','INCORRECT') or next_scope not in ('GENERAL','GLOBAL','ABILITY_SPECIFIC','ROLE_SPECIFIC','GAME_SPECIFIC','ONE_TIME') or next_authority not in ('GM_PRECEDENT','GLOBAL_OFFICIAL_RULE') then raise exception using errcode='22023',message='INVALID_PRECEDENT_UPDATE'; end if;
  if (result.scope='GLOBAL' or next_scope='GLOBAL' or result.authority='GLOBAL_OFFICIAL_RULE' or next_authority='GLOBAL_OFFICIAL_RULE') and char_length(btrim(coalesce(target_reason,'')))<3 then raise exception using errcode='22023',message='GLOBAL_PRECEDENT_REASON_REQUIRED'; end if;
  if next_scope='GLOBAL' and cardinality(result.role_ids)>0 then raise exception using errcode='22023',message='ROLE_SPECIFIC_PRECEDENT_CANNOT_BE_GLOBAL'; end if;
  if next_authority='GLOBAL_OFFICIAL_RULE' and next_scope<>'GLOBAL' then raise exception using errcode='22023',message='GLOBAL_RULE_REQUIRES_GLOBAL_SCOPE'; end if;
  if next_scope<>'GLOBAL' then next_authority:='GM_PRECEDENT'; end if;
  if target_superseded_by is not null and not exists(
    select 1 from public.gm_precedents other join public.games other_game on other_game.id=other.game_id
    where other.id=target_superseded_by and (other.game_id=result.game_id or (next_scope='GLOBAL' and other_game.owner_id=origin_owner))
  ) then raise exception using errcode='23503',message='SUPERSEDING_PRECEDENT_NOT_FOUND'; end if;
  previous:=jsonb_build_object('status',result.status,'scope',result.scope,'authority',result.authority,'version',result.version);
  update public.gm_precedents set status=next_status,scope=next_scope,authority=next_authority,approved_for_global_use=(next_scope='GLOBAL'),
    superseded_by=case when next_status='SUPERSEDED' then target_superseded_by else null end,
    compatibility_metadata=compatibility_metadata||jsonb_build_object('lastScopeReason',left(coalesce(target_reason,''),2000)),version=version+1,updated_at=now()
  where id=target_precedent_id returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(result.game_id,actor,'gm_precedent',result.id::text,'GM precedent updated',previous,jsonb_build_object('status',result.status,'scope',result.scope,'authority',result.authority,'version',result.version,'reason',left(coalesce(target_reason,''),2000)));
  return result;
end $$;

create function private.promote_global_pattern(target_game_id uuid,target_precedent_ids uuid[],target_reason text)
returns public.gm_precedents language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); target_owner uuid; result public.gm_precedents%rowtype; signature_count integer; outcome_count integer; game_count integer;
begin
  select game.owner_id into target_owner from public.games game where game.id=target_game_id;
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if cardinality(coalesce(target_precedent_ids,'{}'))<2 then raise exception using errcode='22023',message='CROSS_GAME_PATTERN_REQUIRED'; end if;
  if char_length(btrim(coalesce(target_reason,'')))<3 then raise exception using errcode='22023',message='GLOBAL_RULE_REASON_REQUIRED'; end if;
  select count(distinct lower(precedent.interaction_signature)),count(distinct md5(precedent.final_outcome::text)),count(distinct precedent.game_id)
  into signature_count,outcome_count,game_count
  from public.gm_precedents precedent join public.games game on game.id=precedent.game_id
  where precedent.id=any(target_precedent_ids) and game.owner_id=target_owner and precedent.status='ACTIVE' and precedent.scope not in ('ONE_TIME','ROLE_SPECIFIC') and cardinality(precedent.role_ids)=0;
  if signature_count<>1 or outcome_count<>1 or game_count<2 then raise exception using errcode='22023',message='INCONSISTENT_GLOBAL_PATTERN'; end if;
  select precedent.* into result from public.gm_precedents precedent where precedent.id=target_precedent_ids[1] for update;
  update public.gm_precedents set scope='GLOBAL',authority='GLOBAL_OFFICIAL_RULE',approved_for_global_use=true,role_ids='{}',source_precedent_ids=target_precedent_ids,
    compatibility_metadata=compatibility_metadata||jsonb_build_object('promotedFromCrossGamePattern',true,'promotionReason',left(coalesce(target_reason,''),2000),'gameCount',game_count),version=version+1,updated_at=now()
  where id=result.id returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(result.game_id,actor,'gm_precedent',result.id::text,'Cross-game pattern promoted to global official rule',jsonb_build_object('precedentIds',target_precedent_ids,'reason',left(coalesce(target_reason,''),2000),'version',result.version));
  return result;
end $$;

drop function private.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean);
drop function public.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean);
create function private.finalize_resolution_session(target_session_id uuid,expected_lock_version integer,target_decision text,target_manual_resolution jsonb,target_gm_explanation text,target_teach_ai boolean,target_teach_scope text default 'GAME_SPECIFIC')
returns public.resolution_sessions language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); current_row public.resolution_sessions%rowtype; result public.resolution_sessions%rowtype; decision text:=upper(btrim(coalesce(target_decision,''))); manual jsonb:=coalesce(target_manual_resolution,'{}'::jsonb); final_value jsonb; signature text; tokens text[]; precedent uuid; item jsonb; ordinal integer:=0; event_kind text; learning_scope text:=upper(btrim(coalesce(target_teach_scope,'GAME_SPECIFIC'))); local_scope text; ability_values text[]; role_values text[]; status_values text[]; concept_values text[]; normalized jsonb; origin_name text; owner_id uuid;
begin
  select * into current_row from public.resolution_sessions where id=target_session_id for update;
  if not found then raise exception using errcode='P0002',message='RESOLUTION_SESSION_NOT_FOUND'; end if;
  if actor is null or not public.can_edit_game(current_row.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select game.name,game.owner_id into origin_name,owner_id from public.games game where game.id=current_row.game_id;
  if current_row.lock_version<>expected_lock_version then raise exception using errcode='40001',message='RESOLUTION_VERSION_CONFLICT'; end if;
  if current_row.status in ('FINALIZED','REJECTED') then raise exception using errcode='55000',message='RESOLUTION_ALREADY_FINALIZED'; end if;
  if decision not in ('APPROVE','MODIFY','REJECT') or learning_scope not in ('GAME_SPECIFIC','GLOBAL') then raise exception using errcode='22023',message='INVALID_GM_DECISION'; end if;
  if jsonb_typeof(manual)<>'object' or octet_length(manual::text)>300000 then raise exception using errcode='22023',message='INVALID_MANUAL_RESOLUTION'; end if;
  if decision='APPROVE' then final_value:=coalesce(current_row.ai_proposal->'resolution',current_row.ai_proposal); else final_value:=manual; end if;
  if decision<>'REJECT' and (final_value is null or jsonb_typeof(final_value)<>'object') then raise exception using errcode='22023',message='FINAL_RESOLUTION_REQUIRED'; end if;
  if coalesce(target_teach_ai,false) and char_length(btrim(coalesce(target_gm_explanation,'')))<3 then raise exception using errcode='22023',message='PRECEDENT_REASON_REQUIRED'; end if;
  local_scope:=case when coalesce(manual->>'scope','GAME_SPECIFIC') in ('GENERAL','ABILITY_SPECIFIC','ROLE_SPECIFIC','GAME_SPECIFIC','ONE_TIME') then manual->>'scope' else 'GAME_SPECIFIC' end;
  select coalesce(array_agg(distinct value) filter(where value<>''),'{}') into ability_values from jsonb_array_elements_text(coalesce(manual->'ability_ids','[]'::jsonb)) value;
  select coalesce(array_agg(distinct value) filter(where value<>''),'{}') into role_values from jsonb_array_elements_text(coalesce(manual->'role_ids','[]'::jsonb)) value;
  select coalesce(array_agg(distinct upper(value)) filter(where value<>''),'{}') into status_values from jsonb_array_elements_text(coalesce(manual->'status_types','[]'::jsonb)) value;
  if learning_scope='GLOBAL' and (local_scope in ('ROLE_SPECIFIC','ONE_TIME') or cardinality(role_values)>0) then raise exception using errcode='22023',message='GLOBAL_LEARNING_REQUIRES_GENERAL_MECHANICS'; end if;
  update public.resolution_sessions set status=case when decision='REJECT' then 'REJECTED' else 'FINALIZED' end,lock_version=lock_version+1,gm_decision=decision,manual_resolution=case when decision='APPROVE' then null else manual end,final_resolution=final_value,post_resolution_state=manual->'post_resolution_state',gm_explanation=left(coalesce(target_gm_explanation,''),12000),teach_ai=coalesce(target_teach_ai,false),teach_scope=case when target_teach_ai then learning_scope else 'GAME_SPECIFIC' end,approved_by=actor,updated_at=now(),finalized_at=now()
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
    tokens:=tokens||coalesce(array(select distinct 'ability:'||regexp_replace(lower(value),'[^a-z0-9]+','_','g') from unnest(ability_values) value),'{}')||coalesce(array(select distinct 'role:'||regexp_replace(lower(value),'[^a-z0-9]+','_','g') from unnest(role_values) value),'{}')||coalesce(array(select distinct 'status:'||regexp_replace(lower(value),'[^a-z0-9]+','_','g') from unnest(status_values) value),'{}');
    select coalesce(array_agg(distinct token),'{}') into tokens from unnest(tokens) token where token<>'';
    if signature='' then signature:=array_to_string(tokens,' + '); end if;
    if signature='' or cardinality(tokens)=0 then raise exception using errcode='22023',message='PRECEDENT_SIGNATURE_REQUIRED'; end if;
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('action',coalesce(action->>'name',action->>'category','ACTION'),'category',action->>'category','abilityId',coalesce(action->>'abilityId',''),'actor','ATTACKER_'||ordinality,'target','TARGET_'||ordinality)) order by ordinality),'[]'::jsonb)
    into normalized from jsonb_array_elements(current_row.submitted_actions) with ordinality submitted(action,ordinality);
    select coalesce(array_agg(distinct concept.concept_key),'{}') into concept_values
    from public.ability_concept_mappings mapping join public.global_ability_concepts concept on concept.id=mapping.global_concept_id
    where mapping.game_id=current_row.game_id and mapping.active and mapping.compatibility_level<>'INCOMPATIBLE' and mapping.game_ability_id=any(ability_values);
    insert into public.gm_precedents(game_id,source_resolution_session_id,title,summary,interaction_signature,signature_tokens,conditions,submitted_actions,resolution_order,final_outcome,gm_reasoning,scope,ability_ids,role_ids,status_types,rule_versions,tags,created_by,approved_by,approved_for_global_use,compatibility_metadata,mechanic_fingerprint,normalized_actions,global_concept_ids,correction_metadata,origin_game_name_snapshot)
    values(current_row.game_id,current_row.id,left(coalesce(nullif(manual->>'title',''),'Resolution '||current_row.cycle||' '||current_row.phase),200),left(coalesce(manual->>'summary',''),4000),signature,tokens,coalesce(manual->'conditions','{}'::jsonb),current_row.submitted_actions,coalesce(final_value->'resolution_order',final_value->'proposed_order','[]'::jsonb),final_value,left(coalesce(target_gm_explanation,''),12000),case when learning_scope='GLOBAL' then 'GLOBAL' else local_scope end,ability_values,case when learning_scope='GLOBAL' then '{}'::text[] else role_values end,status_values,current_row.source_versions,coalesce(array(select jsonb_array_elements_text(coalesce(manual->'tags','[]'::jsonb))),'{}'),actor,actor,learning_scope='GLOBAL',jsonb_build_object('originScope',local_scope,'requiresDefinitionComparison',learning_scope='GLOBAL'),jsonb_build_object('signatureTokens',tokens,'abilityIds',ability_values,'roleIds',role_values,'statusTypes',status_values,'sourceVersions',current_row.source_versions),normalized,concept_values,jsonb_build_object('decision',decision,'aiProposed',coalesce(current_row.ai_proposal->'resolution','{}'::jsonb),'gmCorrected',case when decision in ('MODIFY','REJECT') then final_value else '{}'::jsonb end,'explanation',left(coalesce(target_gm_explanation,''),12000)),origin_name)
    returning id into precedent;
    update public.gm_precedents existing set status='CONFLICTING',updated_at=now(),version=version+1
    where existing.id<>precedent and existing.status='ACTIVE' and lower(existing.interaction_signature)=lower(signature) and existing.final_outcome<>final_value
      and (existing.game_id=current_row.game_id or (learning_scope='GLOBAL' and existing.scope='GLOBAL' and exists(select 1 from public.games other where other.id=existing.game_id and other.owner_id=owner_id)));
    if found then update public.gm_precedents set status='CONFLICTING',updated_at=now(),version=version+1 where id=precedent; end if;
    update public.resolution_sessions set precedent_id=precedent where id=target_session_id returning * into result;
    insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(current_row.game_id,actor,'gm_precedent',precedent::text,'GM precedent created from approved resolution',jsonb_build_object('signature',signature,'scope',case when learning_scope='GLOBAL' then 'GLOBAL' else local_scope end,'decision',decision));
  end if;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(current_row.game_id,actor,'resolution_session',target_session_id::text,'Resolution '||lower(decision),jsonb_build_object('status',current_row.status,'lockVersion',current_row.lock_version),jsonb_build_object('status',result.status,'lockVersion',result.lock_version,'teachAi',result.teach_ai,'teachScope',result.teach_scope));
  return result;
end $$;

drop function public.record_resolution_ai_proposal_internal(uuid,integer,jsonb,text,uuid,text,uuid);
create function public.record_resolution_ai_proposal_internal(target_session_id uuid,expected_lock_version integer,target_proposal jsonb,target_model text,target_request_id uuid,target_response_id text,actor_user_id uuid,target_used_precedent_ids uuid[] default '{}')
returns public.resolution_sessions language plpgsql security definer set search_path=''
as $$
declare result public.resolution_sessions%rowtype; allowed_ids uuid[];
begin
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  select * into result from public.resolution_sessions where id=target_session_id for update;if not found then raise exception using errcode='P0002',message='RESOLUTION_SESSION_NOT_FOUND'; end if;
  if not exists(select 1 from public.game_members where game_id=result.game_id and user_id=actor_user_id and member_role in ('owner','gm')) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if result.lock_version<>expected_lock_version or result.status in ('FINALIZED','REJECTED') then raise exception using errcode='40001',message='RESOLUTION_VERSION_CONFLICT'; end if;
  if jsonb_typeof(target_proposal)<>'object' or octet_length(target_proposal::text)>300000 then raise exception using errcode='22023',message='INVALID_AI_PROPOSAL'; end if;
  select coalesce(array_agg(precedent.id),'{}') into allowed_ids from public.gm_precedents precedent join public.games origin on origin.id=precedent.game_id join public.games target on target.id=result.game_id
  where precedent.id=any(coalesce(target_used_precedent_ids,'{}')) and (precedent.game_id=result.game_id or (precedent.scope='GLOBAL' and origin.owner_id=target.owner_id));
  update public.resolution_sessions set status='AI_PROPOSED',lock_version=lock_version+1,ai_proposal=target_proposal,ai_model=left(target_model,120),ai_request_id=target_request_id,ai_response_id=left(coalesce(target_response_id,''),200),ai_confidence=case when target_proposal->>'confidence' in ('high','medium','low') then target_proposal->>'confidence' else 'low' end,ai_authority=case when target_proposal->>'authority' in ('saved_game','official_sources','gm_precedent','mixed','insufficient') then target_proposal->>'authority' else 'insufficient' end,used_precedent_ids=allowed_ids,updated_at=now() where id=target_session_id returning * into result;
  update public.gm_precedents set use_count=use_count+1,updated_at=now() where id=any(allowed_ids);
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(result.game_id,actor_user_id,'resolution_session',result.id::text,'AI resolution proposed',jsonb_build_object('model',target_model,'requestId',target_request_id,'lockVersion',result.lock_version,'usedPrecedentIds',allowed_ids));return result;
end $$;

drop function public.create_knowledge_document(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text,text);
create function public.create_knowledge_document(
  target_game_id uuid,target_document_id uuid,target_version_id uuid,target_document_key text,target_title text,target_document_type text,target_source_file_name text,target_storage_path text,target_file_size bigint,target_content_type text,target_source_sha256 text default '',target_status text default 'ACTIVE',target_scope text default 'GAME_SPECIFIC'
) returns table(document_id uuid,version_id uuid,version_number integer)
language plpgsql security definer set search_path=''
as $$
declare owner_id uuid; requested_scope text:=upper(btrim(coalesce(target_scope,'GAME_SPECIFIC')));
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select game.owner_id into owner_id from public.games game where game.id=target_game_id;
  if requested_scope not in ('GAME_SPECIFIC','GLOBAL') then raise exception using errcode='22023',message='INVALID_DOCUMENT_SCOPE'; end if;
  if target_document_id is null or target_version_id is null or target_document_key!~'^[a-z0-9][a-z0-9_-]{2,119}$' or nullif(btrim(target_title),'') is null or char_length(target_title)>200 or target_document_type not in ('GAME_MASTER_RULESET','CHARACTER_ROLE_GUIDE','ABILITY_ENCYCLOPEDIA','ACTION_RESOLUTION_RULES','PLAYER_FAQ','CUSTOM') or target_status not in ('DRAFT','APPROVED','ACTIVE') or target_file_size not between 1 and 10485760 or target_content_type not in ('application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf','text/plain') or split_part(target_storage_path,'/',1)<>(select auth.uid())::text or split_part(target_storage_path,'/',2)<>target_game_id::text or (coalesce(target_source_sha256,'')<>'' and target_source_sha256!~'^[0-9a-f]{64}$') then raise exception using errcode='22023',message='INVALID_DOCUMENT_METADATA'; end if;
  if not exists(select 1 from storage.objects object where object.bucket_id='game-knowledge-documents' and object.name=target_storage_path and object.owner_id=(select auth.uid())::text) then raise exception using errcode='P0002',message='UPLOADED_DOCUMENT_NOT_FOUND'; end if;
  insert into public.official_documents(id,document_key,game_id,title,document_type,created_by,scope,owner_id) values(target_document_id,target_document_key,target_game_id,btrim(target_title),target_document_type,(select auth.uid()),requested_scope,owner_id);
  insert into public.official_document_versions(id,document_id,version_number,status,requested_status,source_file_name,storage_path,content_type,file_size,source_sha256,created_by) values(target_version_id,target_document_id,1,'PROCESSING',target_status,target_source_file_name,target_storage_path,target_content_type,target_file_size,coalesce(target_source_sha256,''),(select auth.uid()));
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(target_game_id,(select auth.uid()),'knowledge',target_document_id::text,'Official document uploaded',jsonb_build_object('title',target_title,'type',target_document_type,'version',1,'scope',requested_scope));
  return query select target_document_id,target_version_id,1;
end $$;

drop function public.match_game_knowledge(uuid,extensions.vector,text,integer);
create function public.match_game_knowledge(target_game_id uuid,query_embedding extensions.vector(1536),query_text text,match_count integer default 8)
returns table(chunk_id bigint,document_version_id uuid,document_title text,document_version integer,document_type text,knowledge_scope text,origin_game_id uuid,origin_game_name text,heading text,source_locator text,content text,similarity double precision)
language plpgsql security invoker set search_path='' stable as $$
declare target_owner uuid;
begin
  if not public.is_game_member(target_game_id) then raise exception using errcode='42501',message='GAME_ACCESS_REQUIRED'; end if;
  select game.owner_id into target_owner from public.games game where game.id=target_game_id;
  return query
  with eligible as (
    select chunk.*,document.title,document.document_type,document.scope,document.game_id,origin.name origin_name,version.version_number,
      (1-(chunk.embedding operator(extensions.<=>) query_embedding))::double precision vector_score,
      case when nullif(btrim(query_text),'') is null then 0::real else ts_rank(chunk.search_vector,websearch_to_tsquery('english',query_text)) end text_score
    from public.official_document_chunks chunk
    join public.official_document_versions version on version.id=chunk.document_version_id and version.status='ACTIVE'
    join public.official_documents document on document.id=version.document_id
    left join public.games origin on origin.id=document.game_id
    where chunk.embedding is not null and (
      document.game_id=target_game_id
      or (document.scope='GLOBAL' and document.owner_id=target_owner)
      or (document.scope='SYSTEM_GLOBAL' and exists(select 1 from public.standard_ability_datasets dataset join public.game_ability_datasets active on active.dataset_id=dataset.id and active.game_id=target_game_id where dataset.source_document_version_id=version.id))
    )
  )
  select eligible.id,eligible.document_version_id,eligible.title,eligible.version_number,eligible.document_type,eligible.scope,eligible.game_id,eligible.origin_name,eligible.heading,eligible.source_locator,eligible.content,
    (eligible.vector_score*.75+least(eligible.text_score::double precision,1)*.25) score
  from eligible order by case eligible.scope when 'GAME_SPECIFIC' then 1 when 'GLOBAL' then 2 else 3 end,score desc limit least(20,greatest(1,match_count));
end $$;

create function public.create_global_ability_concept(target_game_id uuid,target_concept_key text,target_name text,target_description text,target_mechanics jsonb)
returns public.global_ability_concepts language sql security invoker set search_path='' as $$select private.create_global_ability_concept(target_game_id,target_concept_key,target_name,target_description,target_mechanics)$$;
create function public.approve_ability_concept_mapping(target_game_id uuid,target_game_ability_id text,target_global_concept_id uuid,target_compatibility_level text,target_notes text,target_mechanic_fingerprint jsonb)
returns public.ability_concept_mappings language sql security invoker set search_path='' as $$select private.approve_ability_concept_mapping(target_game_id,target_game_ability_id,target_global_concept_id,target_compatibility_level,target_notes,target_mechanic_fingerprint)$$;
create function public.remove_ability_concept_mapping(target_mapping_id uuid,target_reason text default '')
returns public.ability_concept_mappings language sql security invoker set search_path='' as $$select private.remove_ability_concept_mapping(target_mapping_id,target_reason)$$;
create function public.manage_gm_precedent(target_precedent_id uuid,expected_version integer,target_status text,target_superseded_by uuid default null,target_scope text default null,target_authority text default null,target_reason text default '')
returns public.gm_precedents language sql security invoker set search_path='' as $$select private.manage_gm_precedent(target_precedent_id,expected_version,target_status,target_superseded_by,target_scope,target_authority,target_reason)$$;
create function public.promote_global_pattern(target_game_id uuid,target_precedent_ids uuid[],target_reason text default '')
returns public.gm_precedents language sql security invoker set search_path='' as $$select private.promote_global_pattern(target_game_id,target_precedent_ids,target_reason)$$;
create function public.finalize_resolution_session(target_session_id uuid,expected_lock_version integer,target_decision text,target_manual_resolution jsonb,target_gm_explanation text,target_teach_ai boolean,target_teach_scope text default 'GAME_SPECIFIC')
returns public.resolution_sessions language sql security invoker set search_path='' as $$select private.finalize_resolution_session(target_session_id,expected_lock_version,target_decision,target_manual_resolution,target_gm_explanation,target_teach_ai,target_teach_scope)$$;

revoke all on function private.create_global_ability_concept(uuid,text,text,text,jsonb),private.approve_ability_concept_mapping(uuid,text,uuid,text,text,jsonb),private.remove_ability_concept_mapping(uuid,text),private.manage_gm_precedent(uuid,integer,text,uuid,text,text,text),private.promote_global_pattern(uuid,uuid[],text),private.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text) from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.create_global_ability_concept(uuid,text,text,text,jsonb),private.approve_ability_concept_mapping(uuid,text,uuid,text,text,jsonb),private.remove_ability_concept_mapping(uuid,text),private.manage_gm_precedent(uuid,integer,text,uuid,text,text,text),private.promote_global_pattern(uuid,uuid[],text),private.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text) to authenticated;

revoke all on function public.search_gm_precedents(uuid,text[],text,integer),public.get_ai_learning_summary(uuid),public.get_cross_game_learning_patterns(uuid),public.get_global_ability_concepts(uuid),public.create_global_ability_concept(uuid,text,text,text,jsonb),public.approve_ability_concept_mapping(uuid,text,uuid,text,text,jsonb),public.remove_ability_concept_mapping(uuid,text),public.manage_gm_precedent(uuid,integer,text,uuid,text,text,text),public.promote_global_pattern(uuid,uuid[],text),public.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text),public.create_knowledge_document(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text,text,text),public.match_game_knowledge(uuid,extensions.vector,text,integer) from public,anon;
grant execute on function public.search_gm_precedents(uuid,text[],text,integer),public.get_ai_learning_summary(uuid),public.get_cross_game_learning_patterns(uuid),public.get_global_ability_concepts(uuid),public.create_global_ability_concept(uuid,text,text,text,jsonb),public.approve_ability_concept_mapping(uuid,text,uuid,text,text,jsonb),public.remove_ability_concept_mapping(uuid,text),public.manage_gm_precedent(uuid,integer,text,uuid,text,text,text),public.promote_global_pattern(uuid,uuid[],text),public.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text),public.create_knowledge_document(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text,text,text),public.match_game_knowledge(uuid,extensions.vector,text,integer) to authenticated;

revoke all on function public.record_resolution_ai_proposal_internal(uuid,integer,jsonb,text,uuid,text,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.record_resolution_ai_proposal_internal(uuid,integer,jsonb,text,uuid,text,uuid,uuid[]) to service_role;

do $$ begin alter publication supabase_realtime add table public.global_ability_concepts; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.ability_concept_mappings; exception when duplicate_object then null; end $$;
