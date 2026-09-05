-- Proposal-review functions intentionally turn stale versions into EXPIRED
-- proposals. Their handlers must recognize both genuine serialization errors
-- and the non-retryable PT422 optimistic-conflict code introduced by the sync
-- recovery migrations.

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
      'public.review_ai_change_proposal(uuid,integer,text,jsonb,text)'::regprocedure,
      'public.review_game_ai_change_proposal(uuid,integer,text,jsonb,text)'::regprocedure
    ]) as target(routine)
  loop
    if function_record.definition !~* 'when\s+sqlstate\s+''40001''\s+then' then
      raise exception 'EXPECTED_PROPOSAL_CONFLICT_HANDLER_NOT_FOUND: %', function_record.oid::regprocedure;
    end if;

    patched_definition := regexp_replace(
      function_record.definition,
      'when\s+sqlstate\s+''40001''\s+then',
      'when sqlstate ''40001'' or sqlstate ''PT422'' then',
      'gi'
    );

    execute patched_definition;
  end loop;

  if exists (
    select 1
    from unnest(array[
      'public.review_ai_change_proposal(uuid,integer,text,jsonb,text)'::regprocedure,
      'public.review_game_ai_change_proposal(uuid,integer,text,jsonb,text)'::regprocedure
    ]) as target(routine)
    where pg_get_functiondef(target.routine::oid) !~* 'when\s+sqlstate\s+''40001''\s+or\s+sqlstate\s+''PT422''\s+then'
  ) then
    raise exception 'PROPOSAL_CONFLICT_HANDLER_NOT_UPDATED';
  end if;
end
$migration$;

notify pgrst, 'reload schema';
