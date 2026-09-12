-- Match the existing owner usage summary's UTC half-open calendar month.
-- Preserve membership, service-only access, locks, prices and limit values.
set local lock_timeout='5s';
set local statement_timeout='30s';

do $migration$
declare definition text; needle text; replacement text;
begin
  definition:=pg_get_functiondef('public.reserve_ai_usage_internal(uuid,uuid,text,text,uuid,jsonb)'::regprocedure);
  needle:='and status in (''COMPLETED'',''FAILED'') and created_at>=date_trunc(''month'',now())';
  replacement:='and status in (''COMPLETED'',''FAILED'') and created_at>=(date_trunc(''month'',now() at time zone ''UTC'') at time zone ''UTC'') and created_at<((date_trunc(''month'',now() at time zone ''UTC'')+interval ''1 month'') at time zone ''UTC'')';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected AI usage month predicate'; end if;
  execute replace(definition,needle,replacement);
end $migration$;
