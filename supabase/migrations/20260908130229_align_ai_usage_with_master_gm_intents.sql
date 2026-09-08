-- Fail quickly instead of waiting on a busy production table.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Current Master GM intents evolved after the original usage reservation RPC.
-- Keep historical feature labels valid; do not enable removed create-game actions.
alter table public.ai_usage_events drop constraint ai_usage_events_feature_check;
alter table public.ai_usage_events add constraint ai_usage_events_feature_check
  check (feature in ('assistant','roster_setup','phase_control','live_status','explain_content','search_history','search_precedents','resolve_actions','plan_session','analyze_balance','create_role','create_ability','create_faction','create_rule','create_status','document_import','edit_content','ability_inventory','ability_grant','queue_action','explain_role','balance_role','knowledge_ingest','auto','create_game'));

-- Change only the validation predicate. Preserve membership, locks, monthly
-- FAILED+COMPLETED accounting, rate limits, pricing snapshots and service ACL.
do $migration$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('public.reserve_ai_usage_internal(uuid,uuid,text,text,uuid,jsonb)'::regprocedure);
  needle:='if target_feature not in (''assistant'',''resolve_actions'',''explain_role'',''plan_session'',''create_role'',''create_ability'',''balance_role'',''document_import'',''knowledge_ingest'') or char_length(target_model) not between 1 and 120 then';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected AI usage validation predicate'; end if;
  execute replace(definition,needle,'if target_feature is null or target_feature not in (''assistant'',''roster_setup'',''phase_control'',''live_status'',''explain_content'',''search_history'',''search_precedents'',''resolve_actions'',''plan_session'',''analyze_balance'',''create_role'',''create_ability'',''create_faction'',''create_rule'',''create_status'',''document_import'',''edit_content'',''ability_inventory'',''ability_grant'',''queue_action'',''explain_role'',''balance_role'',''knowledge_ingest'') or target_model is null or char_length(target_model) not between 1 and 120 then');
end $migration$;
