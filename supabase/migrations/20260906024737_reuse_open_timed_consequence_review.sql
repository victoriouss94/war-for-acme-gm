-- Prefer an in-flight review over older closed sessions, including timestamp ties.
do $migration$
declare definition text; needle text; replacement text;
begin
  definition:=pg_get_functiondef('private.start_resolution_session_v11_4(uuid,integer)'::regprocedure);
  needle:='order by session.created_at desc limit 1;';
  replacement:='order by (session.status not in (''FINALIZED'',''REJECTED'')) desc,session.created_at desc,session.id desc limit 1;';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected existing-session ordering'; end if;
  definition:=replace(definition,needle,replacement);
  -- Audit the actual captured actions, not an already finalized phase queue.
  needle:='''actionCount'',jsonb_array_length(current_row.action_queue)';
  replacement:='''actionCount'',jsonb_array_length(result.submitted_actions)';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected session audit count'; end if;
  execute replace(definition,needle,replacement);
end $migration$;
