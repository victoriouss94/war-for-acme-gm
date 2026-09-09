-- Aggregate all recorded rows; the recent-history display cap is not a budget total.
create function public.get_ai_usage_month_summary(target_game_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $function$
  select case when public.is_game_owner(target_game_id) then (
    with period as (
      select date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' as starts,
        (date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC' as ends
    )
    select jsonb_build_object(
      'month_start',p.starts,'month_end',p.ends,
      'requests',count(e.id),'input_tokens',coalesce(sum(e.input_tokens),0),
      'cached_input_tokens',coalesce(sum(e.cached_input_tokens),0),
      'output_tokens',coalesce(sum(e.output_tokens),0),
      'estimated_cost_usd',coalesce(sum(e.estimated_cost_usd),0),
      'pending_requests',count(e.id) filter(where e.status='STARTED'),
      'failed_requests',count(e.id) filter(where e.status='FAILED')
    ) from period p left join public.ai_usage_events e
      on e.game_id=target_game_id and e.created_at>=p.starts and e.created_at<p.ends
    group by p.starts,p.ends
  ) else null end
$function$;
revoke all on function public.get_ai_usage_month_summary(uuid) from public,anon;
grant execute on function public.get_ai_usage_month_summary(uuid) to authenticated;
comment on function public.get_ai_usage_month_summary(uuid) is 'Owner-only UTC calendar-month aggregation of saved AI usage, including failed and unfinished requests; not total provider-account spending.';
