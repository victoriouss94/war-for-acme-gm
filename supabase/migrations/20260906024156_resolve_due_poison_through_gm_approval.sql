-- Keep delayed consequences in the existing resolution/approval workflow.
-- No historical status or live player rows are rewritten by this migration.
create or replace function private.poison_due_at_phase_end(
  target_effect public.player_status_effects,target_cycle integer,target_phase text
) returns boolean language sql immutable security invoker set search_path='' as $function$
  select coalesce(
    (target_effect).status_type='POISON' and (target_effect).state='ACTIVE'
    and private.status_timer_has_started(target_effect,target_cycle,target_phase)
    and (
      target_cycle>coalesce((target_effect).expires_at_cycle,(target_effect).applied_at_cycle+2)
      or (target_cycle=coalesce((target_effect).expires_at_cycle,(target_effect).applied_at_cycle+2)
        and (coalesce((target_effect).expires_at_phase,'Day')<>'Night' or target_phase='Night'))
    ),false)
$function$;
revoke all on function private.poison_due_at_phase_end(public.player_status_effects,integer,text) from public,anon,authenticated;

do $migration$
declare definition text; signature text; needle text; replacement text;
begin
  foreach signature in array array['private.phase_advance_preview(uuid,uuid,integer)','public.advance_game_phase(uuid,integer,uuid,integer,boolean,text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    needle:='effect.state in (''ACTIVE'',''PENDING'') and';
    -- Only the two expiration/countdown statements. Other status lists are intact.
    replacement:='effect.state in (''ACTIVE'',''PENDING'') and effect.status_type<>''POISON'' and';
    if signature like 'private.%' then
      -- The third match is the read-only timers list, which must retain Poison.
      if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>3 then raise exception 'Unexpected preview status clauses'; end if;
      definition:=replace(definition,needle,replacement);
      definition:=replace(definition,replacement||' (effect.remaining_duration is not null',needle||' (effect.remaining_duration is not null');
      needle:='''pending_effects'',coalesce(';
      replacement:='''due_status_consequences'',coalesce((select jsonb_agg(to_jsonb(effect) order by effect.created_at) from public.player_status_effects effect where effect.game_id=target_game_id and private.poison_due_at_phase_end(effect,current_row.cycle,current_row.phase)),''[]''::jsonb), '||needle;
    else
      if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then raise exception 'Unexpected advance status clauses'; end if;
      definition:=replace(definition,needle,replacement);
      needle:='preview_value:=private.phase_advance_preview(target_game_id,current_row.id,current_row.queue_version);';
      replacement:=needle||' if jsonb_array_length(preview_value->''due_status_consequences'')>0 then raise exception using errcode=''55000'',message=''TIMED_CONSEQUENCES_REQUIRE_RESOLUTION''; end if;';
    end if;
    if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected timed-consequence insertion: %',signature; end if;
    execute replace(definition,needle,replacement);
  end loop;

  signature:='private.start_resolution_session_v11_4(uuid,integer)';
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:='if jsonb_array_length(current_row.action_queue)=0 then';
  replacement:='if jsonb_array_length(current_row.action_queue)=0 and not exists(select 1 from public.player_status_effects effect where effect.game_id=target_game_id and private.poison_due_at_phase_end(effect,current_row.cycle,current_row.phase)) then';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected empty-queue guard'; end if;
  definition:=replace(definition,needle,replacement);
  -- If actions were already finalized, new due effects get a status-only review.
  -- Never replay those already-approved submitted actions.
  needle:='declare current_row public.game_phases%rowtype;';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected session declaration'; end if;
  definition:=replace(definition,needle,'declare status_only boolean:=false;current_row public.game_phases%rowtype;');
  needle:='if found then return existing; end if;';
  replacement:='if found then if existing.status in (''FINALIZED'',''REJECTED'') and exists(select 1 from public.player_status_effects effect where effect.game_id=target_game_id and private.poison_due_at_phase_end(effect,current_row.cycle,current_row.phase)) then status_only:=existing.status=''FINALIZED''; else return existing; end if; end if;';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected session reuse guard'; end if;
  definition:=replace(definition,needle,replacement);
  needle:='submitted_actions=current_row.action_queue';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected session action capture'; end if;
  definition:=replace(definition,needle,'submitted_actions=case when status_only then ''[]''::jsonb else current_row.action_queue end');
  execute definition;
end $migration$;
