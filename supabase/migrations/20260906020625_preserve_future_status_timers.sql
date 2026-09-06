-- A phase countdown cannot start before the effect's scheduled application.
-- Keep explicit expiry deadlines and pending/manual resolution semantics intact.
create or replace function private.status_timer_has_started(
  target_effect public.player_status_effects, target_cycle integer, target_phase text
) returns boolean language sql immutable security invoker set search_path='' as $function$
  select coalesce((target_effect).applied_at_cycle,target_cycle)<=target_cycle
    and not coalesce((target_effect).applied_at_cycle=target_cycle
      and (target_effect).applied_at_phase='Night' and target_phase='Day',false)
$function$;
revoke all on function private.status_timer_has_started(public.player_status_effects,integer,text) from public,anon,authenticated;

do $migration$
declare target_signature text; definition text; needle text; replacement text;
begin
  foreach target_signature in array array[
    'private.phase_advance_preview(uuid,uuid,integer)',
    'public.advance_game_phase(uuid,integer,uuid,integer,boolean,text)'
  ] loop
    definition:=pg_get_functiondef(target_signature::regprocedure);
    needle:='effect.remaining_duration=1';
    replacement:='(effect.remaining_duration=1 and private.status_timer_has_started(effect,current_row.cycle,current_row.phase))';
    if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
      raise exception 'Unexpected status expiry implementation: %',target_signature;
    end if;
    definition:=replace(definition,needle,replacement);
    needle:='effect.remaining_duration>1';
    replacement:='effect.remaining_duration>1 and private.status_timer_has_started(effect,current_row.cycle,current_row.phase)';
    if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
      raise exception 'Unexpected status countdown implementation: %',target_signature;
    end if;
    execute replace(definition,needle,replacement);
  end loop;
end
$migration$;
