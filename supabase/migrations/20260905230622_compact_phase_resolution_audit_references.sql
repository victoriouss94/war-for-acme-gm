-- Keep the full ruling in resolution_sessions; phase history stores a stable reference.
-- Filename aligned to the production migration ledger after MCP deployment.
-- Do not enlarge limits or remove any approval/permission/usage safeguards.
do $migration$
declare
  definition text:=pg_get_functiondef('private.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[])'::regprocedure);
  needle text:=$old$'finalResolution',result.final_resolution$old$;
  replacement text:=$new$'resolutionSessionId',result.id,'finalResolutionStoredIn','resolution_sessions.final_resolution','finalResolutionBytes',octet_length(result.final_resolution::text)$new$;
begin
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
    raise exception 'Unexpected finalization implementation: expected exactly two full-ruling phase copies';
  end if;
  execute replace(definition,needle,replacement);
end
$migration$;
