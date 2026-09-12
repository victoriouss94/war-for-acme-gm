-- LOCAL-ONLY synthetic fixture. Never execute against production.
begin;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111'),('77777777-7777-4777-8777-777777777777');
insert into public.games(id) values('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into public.game_members(game_id,user_id,member_role) values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','owner');
create function pg_temp.expect_failure(statement text,expected_code text,expected_message text default null) returns void language plpgsql as $$
declare caught boolean:=false;
begin
  begin execute statement;
  exception when others then
    if sqlstate<>expected_code or (expected_message is not null and sqlerrm<>expected_message) then raise; end if;
    caught:=true;
  end;
  if not caught then raise exception 'Expected failure: %',expected_message; end if;
end $$;

-- Four initial requests can be reserved without manufacturing a game/membership.
set local role service_role;
select public.reserve_ai_usage_internal(null,'11111111-1111-4111-8111-111111111111','document_import','synthetic-model','44444444-4444-4444-8444-444444444444','{}');
reset role;
select public.complete_ai_usage_internal('44444444-4444-4444-8444-444444444444','synthetic-response',100,20,50,.000955,10,'COMPLETED','');
do $test$ begin
  if not exists(select 1 from public.ai_usage_events where id='44444444-4444-4444-8444-444444444444' and game_id is null and status='COMPLETED' and estimated_cost_usd=.000955) then raise exception 'Initial usage was not recorded'; end if;
  for counter in 1..3 loop
    perform public.reserve_ai_usage_internal(null,'11111111-1111-4111-8111-111111111111','document_import','synthetic-model',gen_random_uuid(),'{}');
  end loop;
end $test$;
select pg_temp.expect_failure($q$select public.reserve_ai_usage_internal(null,'11111111-1111-4111-8111-111111111111','document_import','synthetic-model',gen_random_uuid(),'{}')$q$,'P0001','AI_RATE_LIMIT_REACHED');
-- A different user has their own initial-import window.
select public.reserve_ai_usage_internal(null,'77777777-7777-4777-8777-777777777777','document_import','synthetic-model',gen_random_uuid(),'{}');
-- Window expiry permits a later request; FAILED and STARTED reservations both count.
update public.ai_usage_events set created_at=now()-interval '61 seconds' where user_id='11111111-1111-4111-8111-111111111111';
select public.reserve_ai_usage_internal(null,'11111111-1111-4111-8111-111111111111','document_import','synthetic-model',gen_random_uuid(),'{}');
select pg_temp.expect_failure($q$select public.reserve_ai_usage_internal(null,'11111111-1111-4111-8111-111111111111','assistant','synthetic-model',gen_random_uuid(),'{}')$q$,'22023','INVALID_AI_USAGE_REQUEST');
select pg_temp.expect_failure($q$select public.reserve_ai_usage_internal(null,'11111111-1111-4111-8111-111111111111',null,'synthetic-model',gen_random_uuid(),'{}')$q$,'22023','INVALID_AI_USAGE_REQUEST');
select pg_temp.expect_failure($q$select public.reserve_ai_usage_internal(null,'11111111-1111-4111-8111-111111111111','document_import',null,gen_random_uuid(),'{}')$q$,'22023','INVALID_AI_USAGE_REQUEST');
select pg_temp.expect_failure($q$select public.reserve_ai_usage_internal(null,'11111111-1111-4111-8111-111111111111','document_import','synthetic-model',null,'{}')$q$,'22023','INVALID_AI_USAGE_REQUEST');
select pg_temp.expect_failure($q$select public.reserve_ai_usage_internal(null,'99999999-9999-4999-8999-999999999999','document_import','synthetic-model',gen_random_uuid(),'{}')$q$,'42501','AUTH_REQUIRED');
select pg_temp.expect_failure($q$select public.reserve_ai_usage_internal(null,null,'document_import','synthetic-model',gen_random_uuid(),'{}')$q$,'42501','AUTH_REQUIRED');
select pg_temp.expect_failure($q$insert into public.ai_usage_events(id,game_id,user_id,feature,model) values(gen_random_uuid(),null,'11111111-1111-4111-8111-111111111111','assistant','synthetic-model')$q$,'23514');
-- Game membership and game budgets have not been weakened by the initial path.
select pg_temp.expect_failure($q$select public.reserve_ai_usage_internal('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','document_import','synthetic-model',gen_random_uuid(),'{}')$q$,'42501','GM_ACCESS_REQUIRED');
select public.reserve_ai_usage_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','document_import','synthetic-model','55555555-5555-4555-8555-555555555555','{}');
insert into public.ai_usage_limits(game_id,monthly_limit_usd,updated_by) values('22222222-2222-4222-8222-222222222222',0,'11111111-1111-4111-8111-111111111111');
select pg_temp.expect_failure($q$select public.reserve_ai_usage_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','document_import','synthetic-model',gen_random_uuid(),'{}')$q$,'P0001','AI_MONTHLY_LIMIT_REACHED');
-- No browser role gains direct write access or visibility of pre-game rows.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
do $test$ begin
  if (select count(*) from public.ai_usage_events)<>1 then raise exception 'Owner must see only their game row'; end if;
  begin perform public.reserve_ai_usage_internal(null,'11111111-1111-4111-8111-111111111111','document_import','synthetic-model',gen_random_uuid(),'{}');raise exception 'Browser reserved usage';exception when insufficient_privilege then null;end;
  begin insert into public.ai_usage_events(id,game_id,user_id,feature,model) values(gen_random_uuid(),null,'11111111-1111-4111-8111-111111111111','document_import','synthetic-model');raise exception 'Browser inserted usage';exception when insufficient_privilege then null;end;
end $test$;
reset role;
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
set local role authenticated;
do $test$ begin if exists(select 1 from public.ai_usage_events) then raise exception 'Nonmember saw usage';end if;end $test$;
reset role;
set local role anon;
do $test$ begin
  if exists(select 1 from public.ai_usage_events) then raise exception 'Anonymous user saw usage';end if;
  begin perform public.reserve_ai_usage_internal(null,'11111111-1111-4111-8111-111111111111','document_import','synthetic-model',gen_random_uuid(),'{}');raise exception 'Anonymous reservation';exception when insufficient_privilege then null;end;
end $test$;
reset role;
select jsonb_build_object('initialCompletion',true,'fourRequestLimit',true,'userIsolation',true,'expiry',true,'invalidInputs',6,'featureConstraint',true,'membership',true,'monthlyLimit',true,'rls',true,'browserWritesDenied',true) as verification;
rollback;
