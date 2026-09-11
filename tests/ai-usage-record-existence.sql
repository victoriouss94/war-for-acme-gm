-- LOCAL-ONLY fixture. No production game, user, or usage records are required.
begin;
insert into public.games values('11111111-1111-4111-8111-111111111111');
insert into auth.users values('22222222-2222-4222-8222-222222222222');
insert into public.ai_usage_events(id,game_id,user_id,feature,model) values
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','assistant','synthetic-model'),
('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','assistant','synthetic-model');
set local role service_role;
do $test$
declare rejected boolean:=false;
begin
  begin
    perform public.complete_ai_usage_internal('99999999-9999-4999-8999-999999999999','synthetic',10,2,3,0.01,10,'COMPLETED','');
  exception when no_data_found then
    if sqlerrm<>'AI_USAGE_EVENT_NOT_FOUND' then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'Missing usage reservation silently reported as recorded'; end if;
  rejected:=false;
  begin perform public.complete_ai_usage_internal(null,'synthetic',10,2,3,0.01,10,'FAILED','TEST');
  exception when no_data_found then rejected:=true; end;
  if not rejected then raise exception 'Null usage request silently reported as recorded'; end if;
  perform public.complete_ai_usage_internal('33333333-3333-4333-8333-333333333333','synthetic-first',100,20,50,0.08,100,'COMPLETED','');
  perform public.complete_ai_usage_internal('33333333-3333-4333-8333-333333333333','synthetic-late',999,10,999,0.9,200,'FAILED','LATE_CALLBACK');
  perform public.complete_ai_usage_internal('44444444-4444-4444-8444-444444444444','synthetic-failed',100,20,50,0.04,100,'FAILED','TEST');
  perform public.complete_ai_usage_internal('44444444-4444-4444-8444-444444444444','',0,0,0,0,120,'FAILED','RETRY');
  perform public.complete_ai_usage_internal('44444444-4444-4444-8444-444444444444','',0,0,0,0,150,'COMPLETED','');
end $test$;
reset role;
do $test$
declare first_event public.ai_usage_events%rowtype; second_event public.ai_usage_events%rowtype;
begin
  select * into first_event from public.ai_usage_events where id='33333333-3333-4333-8333-333333333333';
  select * into second_event from public.ai_usage_events where id='44444444-4444-4444-8444-444444444444';
  if first_event.status<>'COMPLETED' or first_event.input_tokens<>100 or first_event.estimated_cost_usd<>0.08 or first_event.provider_response_id<>'synthetic-first' then raise exception 'Completed accounting changed on retry'; end if;
  if second_event.status<>'COMPLETED' or second_event.input_tokens<>100 or second_event.cached_input_tokens<>20 or second_event.output_tokens<>50 or second_event.estimated_cost_usd<>0.04 or second_event.provider_response_id<>'synthetic-failed' then raise exception 'Known failed charge lost during recovery'; end if;
end $test$;
set local role authenticated;
do $test$
declare rejected boolean:=false;
begin
  begin perform public.complete_ai_usage_internal('33333333-3333-4333-8333-333333333333','',0,0,0,0,0,'COMPLETED','');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Authenticated client can write accounting'; end if;
end $test$;
reset role;
select jsonb_build_object('missingRejected',true,'nullRejected',true,'completedRetryPreserved',true,'failedUsageRecoveryPreserved',true,'browserDenied',true) as verification;
rollback;
