-- A timed death needs real, same-game, currently due status evidence.
-- Preserve all other warnings and the GM's existing explicit override path.
do $migration$
declare definition text; needle text:=$needle$and not exists(select 1 from jsonb_array_elements(final_value->'action_results') action where action->>'result'='SUCCESS' and exists(select 1 from jsonb_array_elements_text(action->'affected_player_ids') affected where affected=outcome->>'player_id'))$needle$; replacement text:=$replacement$and not exists(select 1 from jsonb_array_elements(final_value->'action_results') action where action->>'result'='SUCCESS' and exists(select 1 from jsonb_array_elements_text(action->'affected_player_ids') affected where affected=outcome->>'player_id')) and not exists(
    select 1 from jsonb_array_elements(final_value->'other_effects') consequence
    join public.player_status_effects effect on effect.id::text=consequence->>'target_id'
    where consequence->>'type'='STATUS_CONSEQUENCE' and consequence->>'value'='DEAD'
      and consequence->>'player_id'=outcome->>'player_id'
      and effect.game_id=session_row.game_id and effect.player_id=outcome->>'player_id'
      and private.poison_due_at_phase_end(effect,session_row.cycle,session_row.phase)
      and exists(select 1 from jsonb_array_elements(final_value->'status_effects') removal
        where removal->>'operation'='REMOVE' and removal->>'status_id'=effect.id::text and removal->>'player_id'=effect.player_id)
  )$replacement$;
begin
  definition:=pg_get_functiondef('private.approve_and_apply_resolution_v11_5(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected death evidence guard'; end if;
  execute replace(definition,needle,replacement);
end $migration$;
