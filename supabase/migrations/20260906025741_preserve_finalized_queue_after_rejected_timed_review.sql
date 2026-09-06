-- Rejecting a status-only follow-up cannot make an approved phase queue runnable.
-- Keep the existing session lock, version checks, authorization and snapshot path.
do $migration$
declare definition text;
  needle text:='status_only:=existing.status=''FINALIZED'';';
  replacement text:='status_only:=exists(select 1 from public.resolution_sessions approved_session where approved_session.phase_id=current_row.id and approved_session.source_phase_version=current_row.queue_version and approved_session.status=''FINALIZED'');';
begin
  definition:=pg_get_functiondef('private.start_resolution_session_v11_4(uuid,integer)'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected status-only replay guard'; end if;
  execute replace(definition,needle,replacement);
end $migration$;
