-- Initial Word analysis happens before a game exists. Reuse the same ledger,
-- allowing only that feature without a game; all game-scoped policy is retained.
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.ai_usage_events alter column game_id drop not null;
alter table public.ai_usage_events add constraint ai_usage_events_pregame_feature
  check (game_id is not null or feature='document_import');

do $migration$
declare definition text; needle text; replacement text;
begin
  definition:=pg_get_functiondef('public.reserve_ai_usage_internal(uuid,uuid,text,text,uuid,jsonb)'::regprocedure);
  needle:='  if not exists(select 1 from public.game_members where game_id=target_game_id and user_id=actor_user_id and member_role in (''owner'',''gm'')) then raise exception using errcode=''42501'',message=''GM_ACCESS_REQUIRED''; end if;';
  replacement:=$branch$  if target_game_id is null then
    if target_feature is distinct from 'document_import' or target_request_id is null or target_model is null or char_length(target_model) not between 1 and 120 then
      raise exception using errcode='22023',message='INVALID_AI_USAGE_REQUEST';
    end if;
    if actor_user_id is null or not exists(select 1 from auth.users u where u.id=actor_user_id) then
      raise exception using errcode='42501',message='AUTH_REQUIRED';
    end if;
    -- Match the import handler's existing four-per-minute user limit across workers.
    -- Reuse ai_usage_events_user_created_idx; no extra table or index is needed.
    perform pg_advisory_xact_lock(hashtextextended(actor_user_id::text,9318));
    select count(*) into recent_count from public.ai_usage_events e
      where e.game_id is null and e.user_id=actor_user_id and e.created_at>=now()-interval '1 minute';
    if recent_count>=4 then raise exception using errcode='P0001',message='AI_RATE_LIMIT_REACHED'; end if;
    insert into public.ai_usage_events(id,game_id,user_id,feature,model,pricing_snapshot)
      values(target_request_id,null,actor_user_id,target_feature,target_model,coalesce(target_pricing_snapshot,'{}'::jsonb));
    return target_request_id;
  end if;
$branch$||needle;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Unexpected AI usage authorization predicate';
  end if;
  execute replace(definition,needle,replacement);
end $migration$;

-- RLS, service-only RPC privileges and the existing owner-only SELECT policy
-- are unchanged. Pre-game rows are not exposed by the game-owner policy.
-- There is no game monthly limit before a game exists. No hard dollar cap
-- or durable provider reconciliation is claimed by this migration.
