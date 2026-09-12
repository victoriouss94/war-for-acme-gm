-- LOCAL-ONLY synthetic fixture. Never execute against production.
begin;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111');
insert into public.games(id) values('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into public.game_members(game_id,user_id,member_role) values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','owner');
insert into public.ai_usage_limits(game_id,monthly_limit_usd,updated_by) values('22222222-2222-4222-8222-222222222222',10,'11111111-1111-4111-8111-111111111111');

do $test$
declare scenario record; blocked boolean; starts timestamptz; ends timestamptz; event_time timestamptz;
begin
  starts:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  ends:=(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC';
  for scenario in select * from (values
    ('UTC','start','COMPLETED',false,true),
    ('America/Los_Angeles','early','COMPLETED',false,true),
    ('Asia/Kolkata','before','COMPLETED',false,false),
    ('UTC','end','COMPLETED',false,false),
    ('UTC','last','COMPLETED',false,true),
    ('America/Los_Angeles','early','FAILED',false,true),
    ('UTC','start','STARTED',false,false),
    ('UTC','start','COMPLETED',true,false)
  ) as cases(zone_name,position,event_status,other_game,expected_blocked) loop
    perform set_config('TimeZone',scenario.zone_name,true);
    delete from public.ai_usage_events;
    event_time:=case scenario.position when 'early' then starts+interval '30 minutes' when 'before' then starts-interval '30 minutes' when 'end' then ends when 'last' then ends-interval '1 second' else starts end;
    insert into public.ai_usage_events(id,game_id,user_id,feature,model,status,estimated_cost_usd,created_at)
    values('44444444-4444-4444-8444-444444444444',case when scenario.other_game then '33333333-3333-4333-8333-333333333333'::uuid else '22222222-2222-4222-8222-222222222222'::uuid end,'11111111-1111-4111-8111-111111111111','assistant','synthetic-model',scenario.event_status,10,event_time);
    blocked:=false;
    begin
      perform public.reserve_ai_usage_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','assistant','synthetic-model','55555555-5555-4555-8555-555555555555','{}');
    exception when sqlstate 'P0001' then
      if sqlerrm='AI_MONTHLY_LIMIT_REACHED' then blocked:=true; else raise; end if;
    end;
    if blocked<>scenario.expected_blocked then raise exception 'UTC budget mismatch: zone=%, position=%, status=%, expected blocked=%, actual=%',scenario.zone_name,scenario.position,scenario.event_status,scenario.expected_blocked,blocked; end if;
    if (select count(*) from public.ai_usage_events)<>(case when blocked then 1 else 2 end) then raise exception 'Reservation side effect mismatch'; end if;
  end loop;
end $test$;

set local role authenticated;
do $test$ begin
  begin
    perform public.reserve_ai_usage_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','assistant','synthetic-model','66666666-6666-4666-8666-666666666666','{}');
    raise exception 'Browser role must not reserve directly';
  exception when insufficient_privilege then null; end;
end $test$;
reset role;
select jsonb_build_object('boundaryCases',8,'browserDenied',true) as verification;
rollback;
