-- Keep legacy RPC signatures, but route all browser approval through the canonical transaction.
-- Private finalize helpers remain implementation delegates, not client APIs.
create or replace function public.finalize_resolution_with_grants(
  target_session_id uuid, expected_lock_version integer, target_decision text,
  target_manual_resolution jsonb, target_gm_explanation text, target_teach_ai boolean,
  target_teach_scope text default 'GLOBAL', target_consumed_action_ids text[] default '{}'
) returns public.resolution_sessions
language plpgsql security invoker set search_path=''
as $function$
declare
  decision text:=upper(btrim(coalesce(target_decision,'')));
  final_value jsonb:=coalesce(target_manual_resolution,'{}'::jsonb);
  session_row public.resolution_sessions;
  normalized_actions jsonb;
  consumed text[]:=target_consumed_action_ids;
begin
  if decision not in ('APPROVE','MODIFY','REJECT') then
    raise exception using errcode='22023',message='INVALID_GM_DECISION';
  end if;
  select * into session_row from public.resolution_sessions where id=target_session_id;
  if not found then raise exception using errcode='P0002',message='RESOLUTION_SESSION_NOT_FOUND'; end if;
  if not public.can_edit_game(session_row.game_id) then raise exception using errcode='42501',message='GM_ACCESS_REQUIRED'; end if;
  if decision='APPROVE' then
    final_value:=coalesce(nullif(session_row.engine_proposal,'{}'::jsonb),session_row.ai_proposal->'resolution',session_row.ai_proposal);
    -- Match the existing editor's override metadata representation for raw saved proposals.
    if jsonb_typeof(final_value->'action_results')='array' then
      select coalesce(jsonb_agg(case when jsonb_typeof(item->'gm_override') in ('object','string') then item else jsonb_set(item,'{gm_override}','{}'::jsonb) end order by ordinal),'[]'::jsonb)
      into normalized_actions from jsonb_array_elements(final_value->'action_results') with ordinality a(item,ordinal);
      final_value:=jsonb_set(final_value,'{action_results}',normalized_actions);
    end if;
  end if;
  -- The oldest signature has no consumption parameter. Derive it from the
  -- same final structured ruling; the canonical validator still checks it.
  if consumed is null then
    select coalesce(array_agg(item->>'action_id'),'{}'::text[]) into consumed
    from jsonb_array_elements(case when jsonb_typeof(final_value->'action_results')='array' then final_value->'action_results' else '[]'::jsonb end) item
    where decision<>'REJECT' and item->>'use_disposition'='CONSUMED' and coalesce(item->>'player_ability_grant_id','')<>'';
  end if;
  return public.approve_and_apply_resolution(
    target_session_id,expected_lock_version,final_value,target_gm_explanation,
    target_teach_ai,target_teach_scope,consumed,gen_random_uuid(),false,decision='REJECT'
  );
end
$function$;
create or replace function public.finalize_resolution_session(
  target_session_id uuid, expected_lock_version integer, target_decision text,
  target_manual_resolution jsonb, target_gm_explanation text, target_teach_ai boolean,
  target_teach_scope text default 'GLOBAL'
) returns public.resolution_sessions
language sql security invoker set search_path=''
as $function$
  select public.finalize_resolution_with_grants(target_session_id,expected_lock_version,target_decision,target_manual_resolution,target_gm_explanation,target_teach_ai,target_teach_scope,null::text[])
$function$;
revoke all on function private.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text) from public,anon,authenticated;
revoke all on function public.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text),public.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[]) from public,anon;
grant execute on function public.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text),public.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[]) to authenticated;
comment on function public.finalize_resolution_session(uuid,integer,text,jsonb,text,boolean,text) is 'Legacy signature delegates to canonical atomic approval. No independent finalization path.';
comment on function public.finalize_resolution_with_grants(uuid,integer,text,jsonb,text,boolean,text,text[]) is 'Legacy signature delegates to canonical atomic approval. Warnings and stale source versions cannot be bypassed.';
