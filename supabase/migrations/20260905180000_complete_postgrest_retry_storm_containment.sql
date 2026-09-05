-- Complete the targeted PostgREST retry-storm containment begun in
-- 20260905173123. Every routine below is either an authenticated RPC, a
-- service-role RPC, or a private helper reachable from a current public RPC.
-- SQLSTATE 40001 is reserved for serialization failures that PostgREST may
-- retry. These routines use it only for ordinary optimistic-lock conflicts,
-- which must fail once as the non-retryable PT422 application response.

do $migration$
declare
  function_record record;
  patched_definition text;
begin
  for function_record in
    select
      target.routine::oid as oid,
      pg_get_functiondef(target.routine::oid) as definition
    from unnest(array[
      'private.approve_and_apply_resolution_v11_5(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)'::regprocedure,
      'private.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text)'::regprocedure,
      'private.finalize_resolution_with_grants_v11_2(uuid,integer,text,jsonb,text,boolean,text,text[])'::regprocedure,
      'private.grant_player_ability(uuid,integer,text,text,text,text,text,integer,text,timestamp with time zone,integer,text,text[],jsonb,boolean,boolean,jsonb)'::regprocedure,
      'private.manage_gm_precedent(uuid,integer,text,uuid,text,text,text)'::regprocedure,
      'private.mutate_player_ability_grant(uuid,integer,text,text,integer)'::regprocedure,
      'private.phase_advance_preview(uuid,uuid,integer)'::regprocedure,
      'private.queue_player_action(uuid,integer,jsonb,text)'::regprocedure,
      'private.queue_player_action_document_v11_2(uuid,integer,jsonb,text)'::regprocedure,
      'private.save_deterministic_resolution(uuid,integer,jsonb)'::regprocedure,
      'private.start_resolution_session_document_v11_2(uuid,integer)'::regprocedure,
      'public.advance_game_phase(uuid,integer,uuid,integer,boolean,text)'::regprocedure,
      'public.apply_role_assignment_preview(uuid,integer,boolean)'::regprocedure,
      'public.cancel_role_assignment_preview(uuid,integer)'::regprocedure,
      'public.create_ai_change_proposal_internal(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,uuid)'::regprocedure,
      'public.create_global_rule_proposal_internal(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,uuid)'::regprocedure,
      'public.record_resolution_ai_proposal_internal(uuid,integer,jsonb,text,uuid,text,uuid,uuid[])'::regprocedure,
      'public.review_ai_change_proposal(uuid,integer,text,jsonb,text)'::regprocedure,
      'public.review_game_ai_change_proposal(uuid,integer,text,jsonb,text)'::regprocedure,
      'public.save_global_rule(uuid,uuid,text,text,text,text,jsonb,text,boolean,integer)'::regprocedure,
      'public.set_game_phase_pause(uuid,integer,uuid,integer,boolean,text)'::regprocedure,
      'public.shuffle_role_assignment_preview(uuid,integer)'::regprocedure
    ]) as target(routine)
  loop
    if function_record.definition !~* 'errcode\s*=\s*''40001''' then
      raise exception 'EXPECTED_RETRYABLE_CONFLICT_NOT_FOUND: %', function_record.oid::regprocedure;
    end if;

    patched_definition := regexp_replace(
      function_record.definition,
      'errcode\s*=\s*''40001''',
      'errcode = ''PT422''',
      'gi'
    );

    execute patched_definition;
  end loop;

  if exists (
    select 1
    from unnest(array[
      'private.approve_and_apply_resolution_v11_5(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)'::regprocedure,
      'private.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text)'::regprocedure,
      'private.finalize_resolution_with_grants_v11_2(uuid,integer,text,jsonb,text,boolean,text,text[])'::regprocedure,
      'private.grant_player_ability(uuid,integer,text,text,text,text,text,integer,text,timestamp with time zone,integer,text,text[],jsonb,boolean,boolean,jsonb)'::regprocedure,
      'private.manage_gm_precedent(uuid,integer,text,uuid,text,text,text)'::regprocedure,
      'private.mutate_player_ability_grant(uuid,integer,text,text,integer)'::regprocedure,
      'private.phase_advance_preview(uuid,uuid,integer)'::regprocedure,
      'private.queue_player_action(uuid,integer,jsonb,text)'::regprocedure,
      'private.queue_player_action_document_v11_2(uuid,integer,jsonb,text)'::regprocedure,
      'private.save_deterministic_resolution(uuid,integer,jsonb)'::regprocedure,
      'private.start_resolution_session_document_v11_2(uuid,integer)'::regprocedure,
      'public.advance_game_phase(uuid,integer,uuid,integer,boolean,text)'::regprocedure,
      'public.apply_role_assignment_preview(uuid,integer,boolean)'::regprocedure,
      'public.cancel_role_assignment_preview(uuid,integer)'::regprocedure,
      'public.create_ai_change_proposal_internal(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,uuid)'::regprocedure,
      'public.create_global_rule_proposal_internal(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,uuid)'::regprocedure,
      'public.record_resolution_ai_proposal_internal(uuid,integer,jsonb,text,uuid,text,uuid,uuid[])'::regprocedure,
      'public.review_ai_change_proposal(uuid,integer,text,jsonb,text)'::regprocedure,
      'public.review_game_ai_change_proposal(uuid,integer,text,jsonb,text)'::regprocedure,
      'public.save_global_rule(uuid,uuid,text,text,text,text,jsonb,text,boolean,integer)'::regprocedure,
      'public.set_game_phase_pause(uuid,integer,uuid,integer,boolean,text)'::regprocedure,
      'public.shuffle_role_assignment_preview(uuid,integer)'::regprocedure
    ]) as target(routine)
    where pg_get_functiondef(target.routine::oid) ~* 'errcode\s*=\s*''40001'''
  ) then
    raise exception 'RETRYABLE_REACHABLE_CONFLICT_REMAINS';
  end if;
end
$migration$;

notify pgrst, 'reload schema';
