-- LOCAL TEST DATABASE ONLY. Entirely synthetic metadata and usage rows; no providers/accounts/Storage.
begin;
-- __CANDIDATE_DDL__
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $setup$
declare gid uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); item uuid;
begin
  foreach item in array array[gid,other_id] loop
    perform public.create_game(item,jsonb_build_object('game',jsonb_build_object('id',item,'name','Rollback monthly usage audit','status','SETUP','currentDay',0,'currentPhase','Night'),'data',jsonb_build_object('gameId',item,'players','[]'::jsonb,'roles','[]'::jsonb,'abilities','[]'::jsonb,'factions','[]'::jsonb,'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb)));
  end loop;
  perform set_config('audit.game_id',gid::text,true);perform set_config('audit.empty_game_id',other_id::text,true);
end $setup$;
reset role;
do $seed$
declare gid uuid:=current_setting('audit.game_id')::uuid; starts timestamptz:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'; ends timestamptz:=(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC';
begin
  insert into public.ai_usage_events(id,game_id,user_id,feature,model,input_tokens,output_tokens,estimated_cost_usd,status,created_at)
    select gen_random_uuid(),gid,'__AUDIT_OWNER_UUID__','assistant','synthetic-model',10,2,0.01,'COMPLETED',starts+interval '1 millisecond' from generate_series(1,500);
  insert into public.ai_usage_events(id,game_id,user_id,feature,model,input_tokens,output_tokens,estimated_cost_usd,status,created_at) values
    (gen_random_uuid(),gid,'__AUDIT_OWNER_UUID__','assistant','synthetic-model',20,3,0.02,'FAILED',starts+interval '1 hour'),
    (gen_random_uuid(),gid,'__AUDIT_OWNER_UUID__','assistant','synthetic-model',0,0,0,'STARTED',starts+interval '2 hours'),
    (gen_random_uuid(),gid,'__AUDIT_OWNER_UUID__','assistant','synthetic-model',100,100,1000,'COMPLETED',starts-interval '1 millisecond'),
    (gen_random_uuid(),gid,'__AUDIT_OWNER_UUID__','assistant','synthetic-model',100,100,1000,'COMPLETED',ends);
end $seed$;
set local role authenticated;
do $verify$
declare gid uuid:=current_setting('audit.game_id')::uuid; result jsonb; zone text;
begin
  foreach zone in array array['Pacific/Auckland','America/Los_Angeles'] loop
    perform set_config('TimeZone',zone,true);
    result:=public.get_ai_usage_month_summary(gid);
    if (result->>'requests')::integer<>502 or (result->>'input_tokens')::integer<>5020
      or (result->>'output_tokens')::integer<>1003 or (result->>'estimated_cost_usd')::numeric<>5.02
      or (result->>'pending_requests')::integer<>1 or (result->>'failed_requests')::integer<>1
      or (result->>'month_start')::timestamptz is distinct from (date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')
      then raise exception 'Wrong full-month total in timezone %: %',zone,result; end if;
  end loop;
  result:=public.get_ai_usage_month_summary(current_setting('audit.empty_game_id')::uuid);
  if (result->>'requests')::integer<>0 or (result->>'estimated_cost_usd')::numeric<>0 then raise exception 'Other-game data leaked or empty month missing'; end if;
  if public.get_ai_usage_month_summary(gen_random_uuid()) is not null then raise exception 'Unowned game disclosed totals'; end if;
end $verify$;
reset role;
-- Demote only the synthetic fixture membership to test a genuine GM, not owner.
update public.game_members set member_role='gm' where game_id=current_setting('audit.game_id')::uuid and user_id='__AUDIT_OWNER_UUID__';
set local role authenticated;
do $gm$
begin
  if public.get_ai_usage_month_summary(current_setting('audit.game_id')::uuid) is not null then raise exception 'Nonowner GM saw totals'; end if;
end $gm$;
reset role;
do $acl$
begin
  if has_function_privilege('anon','public.get_ai_usage_month_summary(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.get_ai_usage_month_summary(uuid)','EXECUTE')
    or (select prosecdef from pg_proc where oid='public.get_ai_usage_month_summary(uuid)'::regprocedure)
    then raise exception 'Unsafe summary function ACL or definer'; end if;
end $acl$;
select jsonb_build_object('game_id',current_setting('audit.game_id'),'empty_game_id',current_setting('audit.empty_game_id'),'requests',502,'input_tokens',5020,'output_tokens',1003,'cost',5.02,'checks','all rows beyond display cap; UTC boundary in two timezones; failed/pending; empty game; cross-game isolation; nonowner GM denied; invoker ACL') as verification;
rollback;
