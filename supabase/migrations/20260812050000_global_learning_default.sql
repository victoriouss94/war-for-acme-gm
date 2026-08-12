-- Make new taught rulings Global by default without changing historical scopes.
-- This migration extends the existing precedent and resolution architecture in place.

alter table public.gm_precedents
  add column if not exists legacy_scope_review boolean not null default false;

update public.gm_precedents
set legacy_scope_review=true
where scope<>'GLOBAL';

alter table public.resolution_sessions
  alter column teach_scope set default 'GLOBAL';

create or replace function public.get_ai_learning_summary(target_game_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare target_owner_id uuid;
begin
  if not public.can_edit_game(target_game_id) then return jsonb_build_object('error','GM_ACCESS_REQUIRED'); end if;
  select game.owner_id into target_owner_id from public.games game where game.id=target_game_id;
  return jsonb_build_object(
    'manualResolutions',(select count(*) from public.resolution_sessions where game_id=target_game_id and final_resolution is not null),
    'aiApproved',(select count(*) from public.resolution_sessions where game_id=target_game_id and gm_decision='APPROVE'),
    'aiModified',(select count(*) from public.resolution_sessions where game_id=target_game_id and gm_decision='MODIFY'),
    'aiRejected',(select count(*) from public.resolution_sessions where game_id=target_game_id and gm_decision='REJECT'),
    'totalPrecedents',(select count(*) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=target_owner_id),
    'activePrecedents',(select count(*) from public.gm_precedents where game_id=target_game_id and status='ACTIVE'),
    'gameSpecificPrecedents',(select count(*) from public.gm_precedents where game_id=target_game_id and scope<>'GLOBAL'),
    'globalPrecedents',(select count(*) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=target_owner_id and precedent.scope='GLOBAL' and precedent.authority='GM_PRECEDENT' and precedent.status in ('ACTIVE','CONFLICTING')),
    'globalOfficialRules',(select count(*) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=target_owner_id and precedent.scope='GLOBAL' and precedent.authority='GLOBAL_OFFICIAL_RULE' and precedent.status in ('ACTIVE','CONFLICTING')),
    'conflictingPrecedents',(select count(*) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=target_owner_id and precedent.status='CONFLICTING'),
    'supersededPrecedents',(select count(*) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=target_owner_id and precedent.status='SUPERSEDED'),
    'gamesContributing',(select count(distinct precedent.game_id) from public.gm_precedents precedent join public.games game on game.id=precedent.game_id where game.owner_id=target_owner_id and precedent.status in ('ACTIVE','CONFLICTING','SUPERSEDED')),
    'legacyScopeReview',(select count(*) from public.gm_precedents where game_id=target_game_id and legacy_scope_review),
    'draftRoles',(select count(*) from public.ai_drafts where game_id=target_game_id and draft_type='ROLE' and status='DRAFT'),
    'draftAbilities',(select count(*) from public.ai_drafts where game_id=target_game_id and draft_type='ABILITY' and status='DRAFT')
  );
end $$;

create or replace function private.manage_gm_precedent(target_precedent_id uuid,expected_version integer,target_status text,target_superseded_by uuid default null,target_scope text default null,target_authority text default null,target_reason text default '')
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
    legacy_scope_review=false,
    compatibility_metadata=compatibility_metadata||jsonb_build_object('lastScopeReason',left(coalesce(target_reason,''),2000),'scopeReviewedAt',now(),'scopeReviewedBy',actor),version=version+1,updated_at=now()
  where id=target_precedent_id returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,previous_data,new_data) values(result.game_id,actor,'gm_precedent',result.id::text,'GM precedent updated',previous,jsonb_build_object('status',result.status,'scope',result.scope,'authority',result.authority,'version',result.version,'reason',left(coalesce(target_reason,''),2000)));
  return result;
end $$;

create or replace function private.promote_global_pattern(target_game_id uuid,target_precedent_ids uuid[],target_reason text)
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
  update public.gm_precedents set scope='GLOBAL',authority='GLOBAL_OFFICIAL_RULE',approved_for_global_use=true,role_ids='{}',source_precedent_ids=target_precedent_ids,legacy_scope_review=false,
    compatibility_metadata=compatibility_metadata||jsonb_build_object('promotedFromCrossGamePattern',true,'promotionReason',left(coalesce(target_reason,''),2000),'gameCount',game_count),version=version+1,updated_at=now()
  where id=result.id returning * into result;
  insert into public.change_history(game_id,user_id,entity_type,entity_id,action,new_data) values(result.game_id,actor,'gm_precedent',result.id::text,'Cross-game pattern promoted to global official rule',jsonb_build_object('precedentIds',target_precedent_ids,'reason',left(coalesce(target_reason,''),2000),'version',result.version));
  return result;
end $$;

create or replace function private.finalize_resolution_session(target_session_id uuid,expected_lock_version integer,target_decision text,target_manual_resolution jsonb,target_gm_explanation text,target_teach_ai boolean,target_teach_scope text default 'GLOBAL')
returns public.resolution_sessions language plpgsql security definer set search_path=''
as $$
declare actor uuid:=(select auth.uid()); current_row public.resolution_sessions%rowtype; result public.resolution_sessions%rowtype; decision text:=upper(btrim(coalesce(target_decision,''))); manual jsonb:=coalesce(target_manual_resolution,'{}'::jsonb); final_value jsonb; signature text; tokens text[]; precedent uuid; item jsonb; ordinal integer:=0; event_kind text; learning_scope text:=upper(btrim(coalesce(target_teach_scope,'GLOBAL'))); local_scope text; ability_values text[]; role_values text[]; context_role_values text[]; status_values text[]; concept_values text[]; normalized jsonb; origin_name text; owner_id uuid; suggested_narrower_scope boolean:=false;
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
  if (manual ? 'ability_ids' and jsonb_typeof(manual->'ability_ids') is distinct from 'array')
    or (manual ? 'role_ids' and jsonb_typeof(manual->'role_ids') is distinct from 'array')
    or (manual ? 'context_role_ids' and jsonb_typeof(manual->'context_role_ids') is distinct from 'array')
    or (manual ? 'status_types' and jsonb_typeof(manual->'status_types') is distinct from 'array')
    or (manual ? 'ability_context' and jsonb_typeof(manual->'ability_context') is distinct from 'array')
    or (manual ? 'role_context' and jsonb_typeof(manual->'role_context') is distinct from 'array')
    or (manual ? 'role_modifier_context' and jsonb_typeof(manual->'role_modifier_context') is distinct from 'array')
    or (manual ? 'conditions' and jsonb_typeof(manual->'conditions') is distinct from 'object') then
    raise exception using errcode='22023',message='INVALID_COMPATIBILITY_CONTEXT';
  end if;
  local_scope:=case when upper(coalesce(manual->>'scope','GAME_SPECIFIC')) in ('ABILITY_SPECIFIC','ROLE_SPECIFIC','GAME_SPECIFIC','ONE_TIME') then upper(manual->>'scope') else 'GAME_SPECIFIC' end;
  select coalesce(array_agg(distinct value) filter(where value<>''),'{}') into ability_values from jsonb_array_elements_text(coalesce(manual->'ability_ids','[]'::jsonb)) value;
  select coalesce(array_agg(distinct value) filter(where value<>''),'{}') into role_values from jsonb_array_elements_text(coalesce(manual->'role_ids','[]'::jsonb)) value;
  select coalesce(array_agg(distinct value) filter(where value<>''),'{}') into context_role_values from jsonb_array_elements_text(coalesce(manual->'context_role_ids','[]'::jsonb)) value;
  select coalesce(array_agg(distinct upper(value)) filter(where value<>''),'{}') into status_values from jsonb_array_elements_text(coalesce(manual->'status_types','[]'::jsonb)) value;
  suggested_narrower_scope:=local_scope in ('ABILITY_SPECIFIC','ROLE_SPECIFIC','ONE_TIME') or jsonb_array_length(coalesce(manual->'role_modifier_context','[]'::jsonb))>0;
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
    values(current_row.game_id,current_row.id,left(coalesce(nullif(manual->>'title',''),'Resolution '||current_row.cycle||' '||current_row.phase),200),left(coalesce(manual->>'summary',''),4000),signature,tokens,coalesce(manual->'conditions','{}'::jsonb),current_row.submitted_actions,coalesce(final_value->'resolution_order',final_value->'proposed_order','[]'::jsonb),final_value,left(coalesce(target_gm_explanation,''),12000),case when learning_scope='GLOBAL' then 'GLOBAL' else local_scope end,ability_values,case when learning_scope='GLOBAL' then '{}'::text[] else role_values end,status_values,current_row.source_versions,coalesce(array(select jsonb_array_elements_text(coalesce(manual->'tags','[]'::jsonb))),'{}'),actor,actor,learning_scope='GLOBAL',jsonb_build_object('origin',jsonb_build_object('gameId',current_row.game_id,'gameName',origin_name,'resolutionSessionId',current_row.id),'originScope',local_scope,'abilityContext',coalesce(manual->'ability_context','[]'::jsonb),'roleContext',coalesce(manual->'role_context','[]'::jsonb),'roleModifierContext',coalesce(manual->'role_modifier_context','[]'::jsonb),'statuses',status_values,'conditions',coalesce(manual->'conditions','{}'::jsonb),'outcome',final_value,'reasoning',left(coalesce(target_gm_explanation,''),12000),'sourceVersions',current_row.source_versions,'requiresDefinitionComparison',learning_scope='GLOBAL','suggestedNarrowerScope',suggested_narrower_scope),jsonb_build_object('signatureTokens',tokens,'abilityIds',ability_values,'abilityContext',coalesce(manual->'ability_context','[]'::jsonb),'originRoleIds',context_role_values,'roleContext',coalesce(manual->'role_context','[]'::jsonb),'roleModifierContext',coalesce(manual->'role_modifier_context','[]'::jsonb),'statusTypes',status_values,'conditions',coalesce(manual->'conditions','{}'::jsonb),'sourceVersions',current_row.source_versions),normalized,concept_values,jsonb_build_object('decision',decision,'aiProposed',coalesce(current_row.ai_proposal->'resolution','{}'::jsonb),'gmCorrected',case when decision in ('MODIFY','REJECT') then final_value else '{}'::jsonb end,'explanation',left(coalesce(target_gm_explanation,''),12000)),origin_name)
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

create or replace function public.finalize_resolution_session(target_session_id uuid,expected_lock_version integer,target_decision text,target_manual_resolution jsonb,target_gm_explanation text,target_teach_ai boolean,target_teach_scope text default 'GLOBAL')
returns public.resolution_sessions language sql security invoker set search_path='' as $$select private.finalize_resolution_session(target_session_id,expected_lock_version,target_decision,target_manual_resolution,target_gm_explanation,target_teach_ai,target_teach_scope)$$;

revoke all on function private.manage_gm_precedent(uuid,integer,text,uuid,text,text,text),private.promote_global_pattern(uuid,uuid[],text),private.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text) from public,anon,service_role;
grant usage on schema private to authenticated;
grant execute on function private.manage_gm_precedent(uuid,integer,text,uuid,text,text,text),private.promote_global_pattern(uuid,uuid[],text),private.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text) to authenticated;
revoke all on function public.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text) from public,anon;
grant execute on function public.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text) to authenticated;
