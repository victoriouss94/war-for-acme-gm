-- Applied as 20260911023629; preserve service-only privileges and idempotency.
create or replace function public.complete_ai_usage_internal(target_request_id uuid, target_provider_response_id text, target_input_tokens integer, target_cached_input_tokens integer, target_output_tokens integer, target_estimated_cost_usd numeric, target_latency_ms integer, target_status text, target_error_code text)
returns void language plpgsql security definer set search_path=''
as $function$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  -- Lock the existing reservation before acknowledging its completion. A missing
  -- row must not be reported as a successful accounting write.
  perform 1 from public.ai_usage_events event where event.id=target_request_id for update;
  if not found then
    raise exception using errcode='P0002',message='AI_USAGE_EVENT_NOT_FOUND';
  end if;
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
