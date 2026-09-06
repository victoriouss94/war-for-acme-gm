-- Align implicit grant expiration with Day N -> Night N -> Day N+1.
-- Filename aligned with the production migration ledger.
-- No existing game or grant records are rewritten.
do $migration$
declare
  definition text;
  needle text;
  replacement text;
begin
  definition:=pg_get_functiondef('private.grant_player_ability(uuid,integer,text,text,text,text,text,integer,text,timestamptz,integer,text,text[],jsonb,boolean,boolean,jsonb)'::regprocedure);
  needle:=$old$then target_expires_cycle:=current_cycle; end if;$old$;
  replacement:=$new$then target_expires_cycle:=current_cycle+case when duration_value='UNTIL_END_OF_DAY' and current_phase='Night' then 1 else 0 end; end if;$new$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected grant expiration cycle implementation'; end if;
  definition:=replace(definition,needle,replacement);
  needle:=$old$if duration_value='UNTIL_END_OF_PHASE' and coalesce(target_expires_phase,'')='' then target_expires_phase:=current_phase; end if;$old$;
  replacement:=$new$if coalesce(target_expires_phase,'')='' then
    if duration_value='UNTIL_END_OF_PHASE' then target_expires_phase:=current_phase;
    elsif duration_value='UNTIL_END_OF_DAY' then target_expires_phase:='Day';
    elsif duration_value in ('UNTIL_END_OF_NIGHT','UNTIL_END_OF_CYCLE') then target_expires_phase:='Night';
    end if;
  end if;$new$;
  if strpos(definition,needle)=0 then raise exception 'Unexpected grant expiration phase implementation'; end if;
  execute replace(definition,needle,replacement);

  definition:=pg_get_functiondef('private.grant_is_current(public.player_ability_grants,integer,text)'::regprocedure);
  needle:=$old$and not (grant_record.duration_type='UNTIL_END_OF_DAY' and (current_cycle>coalesce(grant_record.granted_cycle,current_cycle) or (current_cycle=coalesce(grant_record.granted_cycle,current_cycle) and grant_record.granted_phase='Day' and current_phase='Night')))$old$;
  replacement:=$new$and not (grant_record.duration_type='UNTIL_END_OF_DAY' and (
    current_cycle>coalesce(grant_record.granted_cycle,current_cycle)+case when grant_record.granted_phase='Night' then 1 else 0 end
    or (current_cycle=coalesce(grant_record.granted_cycle,current_cycle)+case when grant_record.granted_phase='Night' then 1 else 0 end and current_phase='Night')))$new$;
  if strpos(definition,needle)=0 then raise exception 'Unexpected grant availability implementation'; end if;
  execute replace(definition,needle,replacement);
end
$migration$;
