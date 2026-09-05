-- A retry may return an already finalized session. Apply only its stored effects,
-- Filename matches the production migration ledger.
-- never new effects supplied in the retry request.
do $migration$
declare
  definition text:=pg_get_functiondef('public.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)'::regprocedure);
  needle text:=$old$coalesce(target_final_resolution->'other_effects','[]'::jsonb)$old$;
  replacement text:=$new$coalesce(result.final_resolution->'other_effects','[]'::jsonb)$new$;
begin
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Unexpected approval wrapper: expected exactly one request-owned mode effect source';
  end if;
  execute replace(definition,needle,replacement);
end
$migration$;
