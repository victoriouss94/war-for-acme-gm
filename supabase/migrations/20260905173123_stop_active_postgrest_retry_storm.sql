-- Optimistic-lock conflicts are application errors, not serialization failures.
-- PostgREST versions before 16 retry SQLSTATE 40001 indefinitely, so using
-- that code for stale client versions can exhaust the Data API connection pool.
-- Keep the existing conflict message tokens while making the four endpoints
-- observed in the production retry storm fail once with the non-retryable
-- PostgREST HTTP 422 error code. Other routines are deliberately untouched.

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
      'public.create_role_assignment_preview(uuid,integer,boolean,jsonb,jsonb)'::regprocedure,
      'public.start_game_phase(uuid,integer,text,text)'::regprocedure,
      'public.admin_correct_phase_action(uuid,uuid,integer,text,text,jsonb,text)'::regprocedure,
      'private.remove_queued_action(uuid,integer,text,text,uuid,integer)'::regprocedure,
      'private.remove_queued_action_document_v11_2(uuid,integer,text,text)'::regprocedure,
      'public.save_game_document(uuid,integer,jsonb,text,text,text)'::regprocedure
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
      'public.create_role_assignment_preview(uuid,integer,boolean,jsonb,jsonb)'::regprocedure,
      'public.start_game_phase(uuid,integer,text,text)'::regprocedure,
      'public.admin_correct_phase_action(uuid,uuid,integer,text,text,jsonb,text)'::regprocedure,
      'private.remove_queued_action(uuid,integer,text,text,uuid,integer)'::regprocedure,
      'private.remove_queued_action_document_v11_2(uuid,integer,text,text)'::regprocedure,
      'public.save_game_document(uuid,integer,jsonb,text,text,text)'::regprocedure
    ]) as target(routine)
    where pg_get_functiondef(target.routine::oid) ~* 'errcode\s*=\s*''40001'''
  ) then
    raise exception 'RETRYABLE_ACTIVE_ENDPOINT_CONFLICT_REMAINS';
  end if;
end
$migration$;

notify pgrst, 'reload schema';
