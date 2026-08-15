-- Document-driven games use owner-scoped, versioned global fallback rules.
-- Game documents remain authoritative and are never rewritten when a global
-- rule changes; effective rules are assembled dynamically at read time.

create table public.global_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  rule_key text not null check (rule_key ~ '^[A-Z0-9][A-Z0-9_]{2,119}$'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text not null default 'General' check (char_length(btrim(category)) between 1 and 80),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,rule_key)
);

create table public.global_rule_versions (
  id uuid primary key default gen_random_uuid(),
  global_rule_id uuid not null references public.global_rules(id) on delete cascade,
  version_number integer not null check (version_number>0),
  status text not null check (status in ('ACTIVE','SUPERSEDED')),
  description text not null check (char_length(btrim(description)) between 1 and 20000),
  structured_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(structured_data)='object' and octet_length(structured_data::text)<=100000),
  notes text not null default '' check (char_length(notes)<=4000),
  previous_version_id uuid references public.global_rule_versions(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(global_rule_id,version_number)
);

create unique index global_rule_versions_one_active_idx on public.global_rule_versions(global_rule_id) where status='ACTIVE';
create index global_rules_owner_active_idx on public.global_rules(owner_id,active,updated_at desc);
create index global_rule_versions_rule_created_idx on public.global_rule_versions(global_rule_id,created_at desc);

alter table public.global_rules enable row level security;
alter table public.global_rule_versions enable row level security;

create policy global_rules_read_authorized_gm on public.global_rules for select to authenticated using (
  exists(
    select 1 from public.games game join public.game_members member on member.game_id=game.id
    where game.owner_id=global_rules.owner_id and member.user_id=(select auth.uid()) and member.member_role in ('owner','gm')
  )
);
create policy global_rule_versions_read_authorized_gm on public.global_rule_versions for select to authenticated using (
  exists(
    select 1 from public.global_rules rule join public.games game on game.owner_id=rule.owner_id
      join public.game_members member on member.game_id=game.id
    where rule.id=global_rule_versions.global_rule_id and member.user_id=(select auth.uid()) and member.member_role in ('owner','gm')
  )
);

grant select on public.global_rules,public.global_rule_versions to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.global_rules,public.global_rule_versions from anon,authenticated;

create or replace function public.get_global_rules(target_game_id uuid)
returns table(
  id uuid,rule_key text,name text,category text,active boolean,version_id uuid,version_number integer,
  description text,structured_data jsonb,notes text,previous_version_id uuid,created_at timestamptz,updated_at timestamptz
) language plpgsql security invoker set search_path='' stable as $$
declare target_owner uuid;
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select game.owner_id into target_owner from public.games game where game.id=target_game_id;
  return query
  select rule.id,rule.rule_key,rule.name,rule.category,rule.active,version.id,version.version_number,
    version.description,version.structured_data,version.notes,version.previous_version_id,version.created_at,rule.updated_at
  from public.global_rules rule
  join public.global_rule_versions version on version.global_rule_id=rule.id and version.status='ACTIVE'
  where rule.owner_id=target_owner
  order by rule.category,rule.name;
end $$;

create or replace function public.save_global_rule(
  target_game_id uuid,target_rule_id uuid,target_rule_key text,target_name text,target_category text,
  target_description text,target_structured_data jsonb default '{}'::jsonb,target_notes text default '',
  target_active boolean default true,expected_version integer default null
) returns table(rule_id uuid,version_id uuid,version_number integer,rule_key text,active boolean)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); target_owner uuid; current_rule public.global_rules%rowtype;
  current_version public.global_rule_versions%rowtype; next_version integer; inserted_version uuid; normalized_key text;
begin
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select game.owner_id into target_owner from public.games game where game.id=target_game_id;
  normalized_key:=upper(regexp_replace(btrim(coalesce(target_rule_key,'')),'[^A-Za-z0-9]+','_','g'));
  normalized_key:=trim(both '_' from normalized_key);
  if normalized_key!~'^[A-Z0-9][A-Z0-9_]{2,119}$' or char_length(btrim(coalesce(target_name,''))) not between 1 and 200
    or char_length(btrim(coalesce(target_category,''))) not between 1 and 80
    or char_length(btrim(coalesce(target_description,''))) not between 1 and 20000
    or jsonb_typeof(coalesce(target_structured_data,'{}'::jsonb))<>'object' or octet_length(coalesce(target_structured_data,'{}'::jsonb)::text)>100000
    or char_length(coalesce(target_notes,''))>4000
  then raise exception using errcode='22023',message='INVALID_GLOBAL_RULE'; end if;
  if target_rule_id is null then
    insert into public.global_rules(owner_id,rule_key,name,category,active,created_by,updated_by)
    values(target_owner,normalized_key,btrim(target_name),btrim(target_category),coalesce(target_active,true),actor,actor)
    returning * into current_rule;
  else
    select * into current_rule from public.global_rules where id=target_rule_id and owner_id=target_owner for update;
    if current_rule.id is null then raise exception using errcode='P0002',message='GLOBAL_RULE_NOT_FOUND'; end if;
    select * into current_version from public.global_rule_versions where global_rule_id=current_rule.id and status='ACTIVE' for update;
    if expected_version is not null and coalesce(current_version.version_number,0)<>expected_version then raise exception using errcode='40001',message='GLOBAL_RULE_VERSION_CONFLICT'; end if;
    update public.global_rules set rule_key=normalized_key,name=btrim(target_name),category=btrim(target_category),active=coalesce(target_active,true),updated_by=actor,updated_at=now()
    where id=current_rule.id returning * into current_rule;
  end if;
  select coalesce(max(version.version_number),0)+1 into next_version from public.global_rule_versions version where version.global_rule_id=current_rule.id;
  update public.global_rule_versions set status='SUPERSEDED' where global_rule_id=current_rule.id and status='ACTIVE';
  insert into public.global_rule_versions(global_rule_id,version_number,status,description,structured_data,notes,previous_version_id,created_by)
  values(current_rule.id,next_version,'ACTIVE',btrim(target_description),coalesce(target_structured_data,'{}'::jsonb),coalesce(target_notes,''),current_version.id,actor)
  returning id into inserted_version;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data)
  values(target_game_id,actor,'global_rule',current_rule.id::text,case when next_version=1 then 'Global fallback rule created' else 'Global fallback rule version created' end,
    case when current_version.id is null then '{}'::jsonb else jsonb_build_object('versionId',current_version.id,'version',current_version.version_number,'description',current_version.description,'structuredData',current_version.structured_data,'notes',current_version.notes) end,
    jsonb_build_object('ruleKey',current_rule.rule_key,'name',current_rule.name,'category',current_rule.category,'active',current_rule.active,'versionId',inserted_version,'version',next_version,'description',target_description,'structuredData',coalesce(target_structured_data,'{}'::jsonb),'notes',coalesce(target_notes,'')));
  return query select current_rule.id,inserted_version,next_version,current_rule.rule_key,current_rule.active;
end $$;

create or replace function public.get_effective_ruleset(target_game_id uuid)
returns jsonb language plpgsql security invoker set search_path='' stable as $$
declare target_owner uuid; stored jsonb; result jsonb;
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select game.owner_id,document.document into target_owner,stored from public.games game join public.game_documents document on document.game_id=game.id where game.id=target_game_id;
  if stored is null then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  with game_rules as (
    select rule,
      lower(regexp_replace(coalesce(nullif(rule->>'globalRuleKey',''),rule->>'title'),'[^A-Za-z0-9]+','_','g')) as effective_key
    from jsonb_array_elements(coalesce(stored#>'{data,rules}','[]'::jsonb)) rule where coalesce((rule->>'enabled')::boolean,true)
  ), global_values as (
    select rule.id,rule.rule_key,rule.name,rule.category,rule.active,version.id version_id,version.version_number,
      version.description,version.structured_data,version.notes
    from public.global_rules rule join public.global_rule_versions version on version.global_rule_id=rule.id and version.status='ACTIVE'
    where rule.owner_id=target_owner and rule.active
  ), ability_values as (
    select ability.id ability_id,ability.display_name,ability.category,version.id version_id,version.version_number,
      case when version.game_id is null then 'GLOBAL' else 'GAME' end version_scope,version.official_description,version.structured_data
    from public.game_ability_datasets active join public.standard_abilities ability on ability.dataset_id=active.dataset_id
    join lateral(
      select candidate.* from public.standard_ability_versions candidate
      where candidate.ability_id=ability.id and candidate.status='ACTIVE' and (candidate.game_id=target_game_id or candidate.game_id is null)
      order by (candidate.game_id is not null) desc,candidate.version_number desc limit 1
    ) version on true where active.game_id=target_game_id
  )
  select jsonb_build_object(
    'gameId',target_game_id,
    'generatedAt',now(),
    'gameRules',coalesce((select jsonb_agg(jsonb_build_object('ruleKey',effective_key,'source','CURRENT_GAME','authority','GAME_RULE','rule',rule)) from game_rules),'[]'::jsonb),
    'gameOverrides',coalesce((select jsonb_agg(jsonb_build_object('ruleKey',game.effective_key,'gameRule',game.rule,'overridesGlobalVersion',global.version_number,'reason','Current-game rule overrides the matching global fallback.')) from game_rules game join global_values global on lower(global.rule_key)=game.effective_key),'[]'::jsonb),
    'globalFallbacks',coalesce((select jsonb_agg(jsonb_build_object('id',global.id,'ruleKey',global.rule_key,'name',global.name,'category',global.category,'source','GLOBAL_FALLBACK','authority','GLOBAL_SETTING','versionId',global.version_id,'version',global.version_number,'description',global.description,'structuredData',global.structured_data,'notes',global.notes)) from global_values global where not exists(select 1 from game_rules game where game.effective_key=lower(global.rule_key))),'[]'::jsonb),
    'standardAbilities',coalesce((select jsonb_agg(to_jsonb(ability_values)) from ability_values),'[]'::jsonb),
    'roleModifiers',coalesce((select jsonb_agg(jsonb_build_object('id',modifier.id,'roleId',modifier.role_id,'abilityId',modifier.ability_id,'version',modifier.version_number,'modifier',modifier.modifier_text,'source','ROLE_MODIFIER')) from public.role_ability_modifiers modifier where modifier.game_id=target_game_id and modifier.status='ACTIVE'),'[]'::jsonb),
    'unresolved','[]'::jsonb
  ) into result;
  return result;
end $$;

-- Preserve the exact global fallback versions used by every resolution.
create or replace function private.start_resolution_session(target_game_id uuid,expected_game_version integer)
returns public.resolution_sessions language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); stored public.game_documents%rowtype; result public.resolution_sessions%rowtype; actions jsonb; relevant text[]; target_owner uuid;
begin
  if actor is null or not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select * into stored from public.game_documents document where document.game_id=target_game_id;
  select game.owner_id into target_owner from public.games game where game.id=target_game_id;
  if not found then raise exception using errcode='P0002',message='GAME_NOT_FOUND'; end if;
  if expected_game_version is not null and stored.version<>expected_game_version then raise exception using errcode='40001',message='VERSION_CONFLICT'; end if;
  actions:=coalesce(stored.document#>'{data,actions}','[]'::jsonb);
  if jsonb_typeof(actions)<>'array' then raise exception using errcode='22023',message='INVALID_ACTION_QUEUE'; end if;
  select coalesce(array_agg(distinct player_id) filter(where player_id<>''),'{}') into relevant
  from jsonb_array_elements(actions) action cross join lateral(values(coalesce(action->>'actorId','')),(coalesce(action->>'targetId',''))) ids(player_id);
  insert into public.resolution_sessions(game_id,cycle,phase,source_game_version,submitted_actions,relevant_player_ids,pre_resolution_state,source_versions,created_by)
  values(target_game_id,greatest(0,coalesce((stored.document#>>'{game,currentDay}')::integer,0)),case when stored.document#>>'{game,currentPhase}' in ('Day','Night') then stored.document#>>'{game,currentPhase}' else 'Any' end,stored.version,actions,relevant,
    jsonb_build_object('players',coalesce((select jsonb_agg(player) from jsonb_array_elements(coalesce(stored.document#>'{data,players}','[]'::jsonb)) player where player->>'id'=any(relevant)),'[]'::jsonb),'statuses',coalesce((select jsonb_agg(to_jsonb(effect)) from public.player_status_effects effect where effect.game_id=target_game_id and effect.player_id=any(relevant) and effect.state in ('ACTIVE','PENDING')),'[]'::jsonb)),
    jsonb_build_object('gameVersion',stored.version,
      'officialDocuments',coalesce((select jsonb_agg(jsonb_build_object('documentId',document.id,'versionId',version.id,'version',version.version_number,'type',document.document_type)) from public.official_documents document join public.official_document_versions version on version.document_id=document.id where document.game_id=target_game_id and version.status='ACTIVE'),'[]'::jsonb),
      'standardAbilities',coalesce((select jsonb_agg(jsonb_build_object('abilityId',version.ability_id,'versionId',version.id,'version',version.version_number,'scope',case when version.game_id is null then 'global' else 'game' end)) from public.standard_ability_versions version where version.status='ACTIVE' and (version.game_id is null or version.game_id=target_game_id)),'[]'::jsonb),
      'globalRules',coalesce((select jsonb_agg(jsonb_build_object('ruleId',rule.id,'ruleKey',rule.rule_key,'versionId',version.id,'version',version.version_number)) from public.global_rules rule join public.global_rule_versions version on version.global_rule_id=rule.id and version.status='ACTIVE' where rule.owner_id=target_owner and rule.active),'[]'::jsonb)),actor)
  returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(target_game_id,actor,'resolution_session',result.id::text,'Resolution session opened',jsonb_build_object('cycle',result.cycle,'phase',result.phase,'actionCount',jsonb_array_length(actions),'sourceVersions',result.source_versions));
  return result;
end $$;

alter table public.ai_change_proposals drop constraint ai_change_proposals_proposal_type_check;
alter table public.ai_change_proposals add constraint ai_change_proposals_proposal_type_check check (proposal_type in ('GAME_CHANGES','LIVE_STATUS','MIXED','GLOBAL_RULE'));

create or replace function public.create_global_rule_proposal_internal(
  target_game_id uuid,target_conversation_id uuid,target_run_id uuid,target_request_id uuid,target_idempotency_key uuid,
  target_title text,target_summary text,target_changes jsonb,target_source_game_version integer,target_model text,actor_user_id uuid
) returns public.ai_change_proposals language plpgsql security definer set search_path='' as $$
declare result public.ai_change_proposals%rowtype; change jsonb; payload jsonb; target_owner uuid; snapshot jsonb:='{}'::jsonb;
begin
  if (select auth.role())<>'service_role' then raise exception using errcode='42501',message='SERVICE_ACCESS_REQUIRED'; end if;
  if not private.master_gm_is_authorized(target_game_id,actor_user_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if jsonb_typeof(target_changes)<>'array' or jsonb_array_length(target_changes) not between 1 and 10 or octet_length(target_changes::text)>150000 then raise exception using errcode='22023',message='INVALID_AI_PROPOSAL'; end if;
  select game.owner_id into target_owner from public.games game where game.id=target_game_id;
  for change in select value from jsonb_array_elements(target_changes) loop
    if change->>'kind'<>'upsert_global_rule' or char_length(coalesce(change->>'value',''))>100000 then raise exception using errcode='22023',message='UNSUPPORTED_AI_CHANGE'; end if;
    begin payload:=(change->>'value')::jsonb; exception when others then raise exception using errcode='22023',message='INVALID_GLOBAL_RULE_PATCH'; end;
    if jsonb_typeof(payload)<>'object'
      or (payload-array['rule_key','name','category','description','structured_data','notes','active','expected_version'])<>'{}'::jsonb
      or coalesce(payload->>'rule_key','')!~'^[A-Z0-9][A-Z0-9_]{2,119}$'
      or char_length(btrim(coalesce(payload->>'name',''))) not between 1 and 200
      or char_length(btrim(coalesce(payload->>'description',''))) not between 1 and 20000
      or jsonb_typeof(coalesce(payload->'structured_data','{}'::jsonb))<>'object'
      or (payload?'active' and jsonb_typeof(payload->'active')<>'boolean')
    then raise exception using errcode='22023',message='INVALID_GLOBAL_RULE_PATCH'; end if;
    if nullif(change->>'target_id','') is not null then
      if change->>'target_id'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        or coalesce(payload->>'expected_version','')!~'^[1-9][0-9]*$'
      then raise exception using errcode='22023',message='INVALID_GLOBAL_RULE_PATCH'; end if;
      if not exists(
        select 1 from public.global_rules rule join public.global_rule_versions version on version.global_rule_id=rule.id and version.status='ACTIVE'
        where rule.id=(change->>'target_id')::uuid and rule.owner_id=target_owner and version.version_number=(payload->>'expected_version')::integer
      ) then raise exception using errcode='40001',message='GLOBAL_RULE_VERSION_CONFLICT'; end if;
      snapshot:=snapshot||jsonb_build_object(change->>'target_id',coalesce((select jsonb_build_object('rule',to_jsonb(rule),'version',to_jsonb(version)) from public.global_rules rule join public.global_rule_versions version on version.global_rule_id=rule.id and version.status='ACTIVE' where rule.id=(change->>'target_id')::uuid and rule.owner_id=target_owner),'{}'::jsonb));
    end if;
  end loop;
  insert into public.ai_change_proposals(game_id,conversation_id,run_id,request_id,idempotency_key,proposal_type,title,summary,changes,before_snapshot,source_game_version,model,created_by)
  values(target_game_id,target_conversation_id,target_run_id,target_request_id,target_idempotency_key,'GLOBAL_RULE',left(target_title,200),left(coalesce(target_summary,''),4000),target_changes,jsonb_build_object('globalRules',snapshot,'gameVersion',target_source_game_version),target_source_game_version,left(coalesce(target_model,''),120),actor_user_id)
  on conflict(idempotency_key) do nothing returning * into result;
  if result.id is null then select * into result from public.ai_change_proposals where idempotency_key=target_idempotency_key;
  else insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(target_game_id,actor_user_id,'ai_proposal',result.id::text,'AI global rule proposal created',jsonb_build_object('changeCount',jsonb_array_length(target_changes),'runId',target_run_id)); end if;
  return result;
end $$;

alter function public.review_ai_change_proposal(uuid,integer,text,jsonb,text) rename to review_game_ai_change_proposal;
revoke all on function public.review_game_ai_change_proposal(uuid,integer,text,jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.review_ai_change_proposal(target_proposal_id uuid,expected_version integer,target_decision text,target_edited_changes jsonb default null,target_reason text default '')
returns public.ai_change_proposals language plpgsql security definer set search_path='' as $$
declare proposal public.ai_change_proposals%rowtype; actor uuid:=(select auth.uid()); decision text:=upper(btrim(coalesce(target_decision,''))); changes jsonb; change jsonb; payload jsonb; saved jsonb:='[]'::jsonb; saved_item jsonb;
begin
  select * into proposal from public.ai_change_proposals where id=target_proposal_id;
  if proposal.id is null then raise exception using errcode='P0002',message='AI_PROPOSAL_NOT_FOUND'; end if;
  if proposal.proposal_type<>'GLOBAL_RULE' then return public.review_game_ai_change_proposal(target_proposal_id,expected_version,target_decision,target_edited_changes,target_reason); end if;
  select * into proposal from public.ai_change_proposals where id=target_proposal_id for update;
  if actor is null or not public.can_edit_game(proposal.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if proposal.status in ('APPLIED','REJECTED','FAILED','EXPIRED') then return proposal; end if;
  if proposal.version<>expected_version then raise exception using errcode='40001',message='AI_PROPOSAL_VERSION_CONFLICT'; end if;
  if decision='REJECT' then
    update public.ai_change_proposals set status='REJECTED',version=version+1,approval_reason=left(coalesce(target_reason,''),4000),reviewed_by=actor,reviewed_at=now(),updated_at=now() where id=proposal.id returning * into proposal;
    insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(proposal.game_id,actor,'ai_proposal',proposal.id::text,'AI global rule proposal rejected',jsonb_build_object('status','PENDING'),jsonb_build_object('status','REJECTED','reason',proposal.approval_reason));
    return proposal;
  end if;
  if decision<>'APPROVE' then raise exception using errcode='22023',message='INVALID_AI_PROPOSAL_DECISION'; end if;
  changes:=coalesce(target_edited_changes,proposal.changes);
  if jsonb_typeof(changes)<>'array' or jsonb_array_length(changes) not between 1 and 10 then raise exception using errcode='22023',message='INVALID_AI_PROPOSAL'; end if;
  for change in select value from jsonb_array_elements(changes) loop
    if change->>'kind'<>'upsert_global_rule' then raise exception using errcode='22023',message='UNSUPPORTED_AI_CHANGE'; end if;
    begin payload:=(change->>'value')::jsonb; exception when others then raise exception using errcode='22023',message='INVALID_GLOBAL_RULE_PATCH'; end;
    if nullif(change->>'target_id','') is not null and coalesce(payload->>'expected_version','')!~'^[1-9][0-9]*$'
    then raise exception using errcode='22023',message='GLOBAL_RULE_EXPECTED_VERSION_REQUIRED'; end if;
    select to_jsonb(result) into saved_item from public.save_global_rule(proposal.game_id,nullif(change->>'target_id','')::uuid,payload->>'rule_key',payload->>'name',coalesce(payload->>'category','General'),payload->>'description',coalesce(payload->'structured_data','{}'::jsonb),coalesce(payload->>'notes',''),coalesce((payload->>'active')::boolean,true),nullif(payload->>'expected_version','')::integer) result limit 1;
    saved:=saved||jsonb_build_array(saved_item);
  end loop;
  update public.ai_change_proposals set changes=changes,status='APPLIED',version=version+1,approval_reason=left(coalesce(target_reason,''),4000),applied_result=jsonb_build_object('globalRules',saved,'changeCount',jsonb_array_length(changes)),reviewed_by=actor,reviewed_at=now(),applied_at=now(),updated_at=now() where id=proposal.id returning * into proposal;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(proposal.game_id,actor,'ai_proposal',proposal.id::text,'AI global rule proposal applied',proposal.before_snapshot,jsonb_build_object('status','APPLIED','changes',changes,'result',proposal.applied_result,'reason',proposal.approval_reason));
  return proposal;
exception when sqlstate '40001' then
  if proposal.id is null or actor is null or not public.can_edit_game(proposal.game_id) then raise; end if;
  update public.ai_change_proposals set status='EXPIRED',version=version+1,failure_code='VERSION_CONFLICT',reviewed_by=actor,reviewed_at=now(),updated_at=now() where id=proposal.id and status='PENDING' returning * into proposal;
  return proposal;
end $$;

revoke all on function public.get_global_rules(uuid),public.save_global_rule(uuid,uuid,text,text,text,text,jsonb,text,boolean,integer),public.get_effective_ruleset(uuid),public.review_ai_change_proposal(uuid,integer,text,jsonb,text) from public,anon;
grant execute on function public.get_global_rules(uuid),public.save_global_rule(uuid,uuid,text,text,text,text,jsonb,text,boolean,integer),public.get_effective_ruleset(uuid),public.review_ai_change_proposal(uuid,integer,text,jsonb,text) to authenticated;
revoke all on function public.create_global_rule_proposal_internal(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.create_global_rule_proposal_internal(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,uuid) to service_role;
