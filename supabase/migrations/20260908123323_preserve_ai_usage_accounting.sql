-- Keep the existing service-only accounting endpoints and caller contracts.
-- Late cleanup/retry callbacks must not erase a completed provider charge.
create or replace function public.complete_ai_usage_internal(target_request_id uuid, target_provider_response_id text, target_input_tokens integer, target_cached_input_tokens integer, target_output_tokens integer, target_estimated_cost_usd numeric, target_latency_ms integer, target_status text, target_error_code text)
returns void language plpgsql security definer set search_path=''
as $function$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  update public.ai_usage_events event set
    provider_response_id=coalesce(nullif(left(coalesce(target_provider_response_id,''),200),''),event.provider_response_id),
    input_tokens=greatest(event.input_tokens,coalesce(target_input_tokens,0),0),
    cached_input_tokens=least(greatest(event.cached_input_tokens,coalesce(target_cached_input_tokens,0),0),greatest(event.input_tokens,coalesce(target_input_tokens,0),0)),
    output_tokens=greatest(event.output_tokens,coalesce(target_output_tokens,0),0),
    estimated_cost_usd=greatest(event.estimated_cost_usd,coalesce(target_estimated_cost_usd,0),0),
    latency_ms=greatest(coalesce(event.latency_ms,0),coalesce(target_latency_ms,0),0),
    status=case when target_status='COMPLETED' then 'COMPLETED' else 'FAILED' end,
    error_code=left(coalesce(target_error_code,''),120),completed_at=now()
  where event.id=target_request_id and event.status<>'COMPLETED';
end $function$;

-- A failed application request can still have a known provider charge.
-- Preserve game-scoped locking, membership checks, rate limits and month bounds.
do $migration$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('public.reserve_ai_usage_internal(uuid,uuid,text,text,uuid,jsonb)'::regprocedure);
  needle:='and status=''COMPLETED'' and created_at>=date_trunc(''month'',now())';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected monthly usage predicate'; end if;
  execute replace(definition,needle,'and status in (''COMPLETED'',''FAILED'') and created_at>=date_trunc(''month'',now())');
end $migration$;
