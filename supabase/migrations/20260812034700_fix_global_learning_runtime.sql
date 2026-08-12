-- Runtime fixes for the Global Master GM learning summaries.
-- Keep PL/pgSQL variable names distinct from table columns so PostgREST calls
-- do not fail with an ambiguous owner_id reference.

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
    'draftRoles',(select count(*) from public.ai_drafts where game_id=target_game_id and draft_type='ROLE' and status='DRAFT'),
    'draftAbilities',(select count(*) from public.ai_drafts where game_id=target_game_id and draft_type='ABILITY' and status='DRAFT')
  );
end $$;

create or replace function public.get_cross_game_learning_patterns(target_game_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare target_owner_id uuid;
begin
  if not public.can_edit_game(target_game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  select game.owner_id into target_owner_id from public.games game where game.id=target_game_id;
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
        where game.owner_id=target_owner_id and precedent.status='ACTIVE' and precedent.scope not in ('ONE_TIME','ROLE_SPECIFIC') and cardinality(precedent.role_ids)=0
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
        where game.owner_id=target_owner_id and precedent.status in ('ACTIVE','CONFLICTING') and precedent.scope not in ('ONE_TIME','ROLE_SPECIFIC') and cardinality(precedent.role_ids)=0
        group by lower(precedent.interaction_signature)
        having count(distinct precedent.game_id)>=2 and count(distinct md5(precedent.final_outcome::text))>1
      ) differences
    ),'[]'::jsonb)
  );
end $$;

