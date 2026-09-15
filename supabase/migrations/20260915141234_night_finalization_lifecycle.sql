-- Repair the existing lifecycle; no new engine/controller or status columns.
do $migration$
declare definition text; needle text:=$needle$  if jsonb_array_length(current_row.action_queue)=0 and not exists(select 1 from public.player_status_effects effect where effect.game_id=target_game_id and private.poison_due_at_phase_end(effect,current_row.cycle,current_row.phase)) then raise exception using errcode='22023',message='ACTION_QUEUE_EMPTY'; end if;$needle$; replacement text:=$replacement$  -- Empty phases use the same immutable snapshot and finalization transaction.$replacement$;
begin
 definition:=pg_get_functiondef('private.start_resolution_session_v11_4(uuid,integer)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Expected one lifecycle patch site: private.start_resolution_session_v11_4(uuid,integer)'; end if;
 execute replace(definition,needle,replacement);
end $migration$;

do $migration$
declare definition text; needle text:=$needle$  target_action:=private.validate_player_runtime_action(target_game_id,target_action);$needle$; replacement text:=$replacement$  if current_row.resolution_summary->>'status'='FINALIZED' and current_row.resolution_summary->>'official'='true' then raise exception using errcode='55000',message='NIGHT_FINALIZED_USE_ADMIN_CORRECTION'; end if;
  target_action:=private.validate_player_runtime_action(target_game_id,target_action);$replacement$;
begin
 definition:=pg_get_functiondef('private.queue_player_action(uuid,integer,jsonb,text)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Expected one lifecycle patch site: private.queue_player_action(uuid,integer,jsonb,text)'; end if;
 execute replace(definition,needle,replacement);
end $migration$;

do $migration$
declare definition text; needle text:=$needle$  result:=private.remove_queued_action_document_v11_2$needle$; replacement text:=$replacement$  if current_row.resolution_summary->>'status'='FINALIZED' and current_row.resolution_summary->>'official'='true' then raise exception using errcode='55000',message='NIGHT_FINALIZED_USE_ADMIN_CORRECTION'; end if;
  result:=private.remove_queued_action_document_v11_2$replacement$;
begin
 definition:=pg_get_functiondef('private.remove_queued_action(uuid,integer,text,text,uuid,integer)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Expected one lifecycle patch site: private.remove_queued_action(uuid,integer,text,text,uuid,integer)'; end if;
 execute replace(definition,needle,replacement);
end $migration$;

do $migration$
declare definition text; needle text:=$needle$  preview_value:=private.phase_advance_preview$needle$; replacement text:=$replacement$  if current_row.phase='Night' and not (coalesce(current_row.resolution_summary->>'status','')='FINALIZED' and coalesce(current_row.resolution_summary->>'official','')='true') then raise exception using errcode='55000',message='FINALIZE_NIGHT_BEFORE_ADVANCE'; end if;
  preview_value:=private.phase_advance_preview$replacement$;
begin
 definition:=pg_get_functiondef('public.advance_game_phase(uuid,integer,uuid,integer,boolean,text)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Expected one lifecycle patch site: public.advance_game_phase(uuid,integer,uuid,integer,boolean,text)'; end if;
 execute replace(definition,needle,replacement);
end $migration$;

do $migration$
declare definition text; needle text:=$needle$declare result public.resolution_sessions%rowtype;$needle$; replacement text:=$replacement$declare checked_session public.resolution_sessions%rowtype; checked_phase public.game_phases%rowtype; result public.resolution_sessions%rowtype;$replacement$;
begin
 definition:=pg_get_functiondef('public.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Expected one lifecycle patch site: public.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)'; end if;
 execute replace(definition,needle,replacement);
end $migration$;

do $migration$
declare definition text; needle text:=$needle$  result:=private.approve_and_apply_resolution($needle$; replacement text:=$replacement$  select * into checked_session from public.resolution_sessions where id=target_session_id;
  if not found then raise exception using errcode='P0002',message='RESOLUTION_SESSION_NOT_FOUND'; end if;
  if auth.uid() is null or not public.can_edit_game(checked_session.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  -- Serialize finalization with queue edits and phase advance on the phase row.
  if checked_session.phase_id is not null then
    select * into checked_phase from public.game_phases where id=checked_session.phase_id for update;
    select * into checked_session from public.resolution_sessions where id=target_session_id;
    if checked_session.status not in ('FINALIZED','REJECTED') and checked_phase.resolution_summary->>'status'='FINALIZED' and checked_phase.resolution_summary->>'official'='true' then raise exception using errcode='55000',message='NIGHT_ALREADY_FINALIZED'; end if;
    if checked_session.status not in ('FINALIZED','REJECTED') and (checked_phase.status<>'CURRENT' or checked_phase.queue_version<>checked_session.source_phase_version) then raise exception using errcode='PT422',message='PHASE_VERSION_CONFLICT'; end if;
  end if;
  if not coalesce(target_reject,false) and checked_session.status not in ('FINALIZED','REJECTED') then
    if coalesce(target_override_warnings,false) and char_length(btrim(coalesce(target_gm_explanation,'')))<3 then raise exception using errcode='22023',message='GM_OVERRIDE_REASON_REQUIRED'; end if;
    if not coalesce(target_override_warnings,false) and (target_final_resolution->>'resolution_status'='GM_REVIEW_REQUIRED' or jsonb_array_length(coalesce(target_final_resolution->'unresolved_questions','[]'))>0) then raise exception using errcode='22023',message='BLOCKING_RULING_REQUIRES_GM_DECISION'; end if;
  end if;
  if not coalesce(target_reject,false) and checked_session.status not in ('FINALIZED','REJECTED') and checked_session.phase='Night' then
    target_final_resolution:=jsonb_set(target_final_resolution,'{status_effects}',coalesce((
      select jsonb_agg(case when value->>'operation'='APPLY' and value->>'state'='PENDING'
        and value->>'status_type' in ('DRUNK','SOBER') and lower(value->>'duration')='until hanging'
        then value||jsonb_build_object('state','ACTIVE') else value end order by ordinality)
      from jsonb_array_elements(coalesce(target_final_resolution->'status_effects','[]')) with ordinality effect(value,ordinality)
    ),'[]'),true);
  end if;
  result:=private.approve_and_apply_resolution($replacement$;
begin
 definition:=pg_get_functiondef('public.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Expected one lifecycle patch site: public.approve_and_apply_resolution(uuid,integer,jsonb,text,boolean,text,text[],uuid,boolean,boolean)'; end if;
 execute replace(definition,needle,replacement);
end $migration$;

do $migration$
declare definition text; needle text:=$needle$  select * into stored from public.game_documents document_row where document_row.game_id=target_game_id for update;$needle$; replacement text:=$replacement$  perform 1 from public.game_phases where id=target_phase_id and game_id=target_game_id for update;
  select * into stored from public.game_documents document_row where document_row.game_id=target_game_id for update;$replacement$;
begin
 definition:=pg_get_functiondef('public.advance_game_phase(uuid,integer,uuid,integer,boolean,text)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Expected one lifecycle patch site: public.advance_game_phase(uuid,integer,uuid,integer,boolean,text)'; end if;
 execute replace(definition,needle,replacement);
end $migration$;
