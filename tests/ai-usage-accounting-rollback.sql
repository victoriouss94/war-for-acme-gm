-- Supply an existing permanent owner UUID in memory. No OpenAI call is made.
-- All monetary values below are synthetic ledger fixtures, not real charges.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $fixture$
declare gid uuid:=gen_random_uuid();
begin
  perform public.create_game(gid,jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback AI accounting test','status','SETUP'),'data',jsonb_build_object('gameId',gid,'players','[]'::jsonb,'roles','[]'::jsonb,'abilities','[]'::jsonb,'factions','[]'::jsonb,'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb)));
  perform public.set_ai_usage_limit(gid,0.10,120);
  perform set_config('audit.game_id',gid::text,true);
end $fixture$;
reset role;
select set_config('audit.nonmember',(select id::text from auth.users where id<>'__AUDIT_OWNER_UUID__'::uuid and not coalesce(is_anonymous,false) order by created_at limit 1),true);
set local role service_role;
do $accounting$
declare gid uuid:=current_setting('audit.game_id')::uuid; first_id uuid:=gen_random_uuid(); failed_id uuid:=gen_random_uuid(); original jsonb; denied boolean; row_count integer;
begin
  perform public.reserve_ai_usage_internal(gid,'__AUDIT_OWNER_UUID__','assistant','audit-model',first_id,'{}');
  perform public.complete_ai_usage_internal(first_id,'audit-completed-response',100,20,50,0.08,100,'COMPLETED','');
  select to_jsonb(e) into original from public.ai_usage_events e where id=first_id;
  perform public.complete_ai_usage_internal(first_id,'',0,0,0,0,120,'FAILED','LATE_CALLBACK');
  perform public.complete_ai_usage_internal(first_id,'different-retry',999,0,999,0.9,200,'COMPLETED','');
  if (select to_jsonb(e) from public.ai_usage_events e where id=first_id)<>original then raise exception 'Completed charge changed on a late/repeated callback'; end if;
  perform public.reserve_ai_usage_internal(gid,'__AUDIT_OWNER_UUID__','assistant','audit-model',failed_id,'{}');
  perform public.complete_ai_usage_internal(failed_id,'audit-failed-response',100,20,50,0.04,100,'FAILED','AFTER_PROVIDER_FAILURE');
  perform public.complete_ai_usage_internal(failed_id,'',0,0,0,0,120,'FAILED','REPEATED_FAILURE');
  if not exists(select 1 from public.ai_usage_events where id=failed_id and estimated_cost_usd=0.04 and input_tokens=100 and cached_input_tokens=20 and output_tokens=50 and provider_response_id='audit-failed-response') then raise exception 'Failure retry erased known usage'; end if;
  denied:=false;
  begin perform public.reserve_ai_usage_internal(gid,'__AUDIT_OWNER_UUID__','assistant','audit-model',gen_random_uuid(),'{}');
  exception when sqlstate 'P0001' then denied:=sqlerrm='AI_MONTHLY_LIMIT_REACHED'; end;
  if not denied then raise exception 'Known failed charge excluded from monthly limit'; end if;
  if (select count(*) from public.ai_usage_events where game_id=gid)<>2 then raise exception 'Denied request left a reservation'; end if;
  if nullif(current_setting('audit.nonmember'),'') is null then raise exception 'A second existing permanent account is required'; end if;
  denied:=false;
  begin perform public.reserve_ai_usage_internal(gid,current_setting('audit.nonmember')::uuid,'assistant','audit-model',gen_random_uuid(),'{}');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Service reservation accepted a nonmember actor'; end if;
  -- A failed request may receive its valid completion later, but known charges
  -- and token counts must not be lost when that callback omits usage.
  perform public.complete_ai_usage_internal(failed_id,'',0,0,0,0,150,'COMPLETED','');
  if not exists(select 1 from public.ai_usage_events where id=failed_id and status='COMPLETED' and estimated_cost_usd=0.04 and input_tokens=100) then raise exception 'Failed-to-completed callback lost known usage'; end if;
  perform set_config('audit.first_request',first_id::text,true);
end $accounting$;
reset role;
set local role authenticated;
do $client_denials$
declare denied boolean; gid uuid:=current_setting('audit.game_id')::uuid;
begin
  denied:=false;
  begin perform public.reserve_ai_usage_internal(gid,auth.uid(),'assistant','audit-model',gen_random_uuid(),'{}');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Browser caller can reserve internal usage'; end if;
  denied:=false;
  begin perform public.complete_ai_usage_internal(current_setting('audit.first_request')::uuid,'',0,0,0,0,0,'FAILED','');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Browser caller can rewrite usage accounting'; end if;
  perform public.set_ai_usage_limit(gid,0.13,120);
end $client_denials$;
reset role;
set local role service_role;
do $month_boundary$
declare gid uuid:=current_setting('audit.game_id')::uuid;
begin
  insert into public.ai_usage_events(id,game_id,user_id,feature,model,status,estimated_cost_usd,created_at)
    values(gen_random_uuid(),gid,'__AUDIT_OWNER_UUID__','assistant','audit-model','FAILED',1,date_trunc('month',now())-interval '1 second');
  perform public.reserve_ai_usage_internal(gid,'__AUDIT_OWNER_UUID__','assistant','audit-model',gen_random_uuid(),'{}');
end $month_boundary$;
reset role;
set local role authenticated;
select public.set_ai_usage_limit(current_setting('audit.game_id')::uuid,null,2);
reset role;
set local role service_role;
do $rate_limit$
declare denied boolean:=false;
begin
  begin perform public.reserve_ai_usage_internal(current_setting('audit.game_id')::uuid,'__AUDIT_OWNER_UUID__','assistant','audit-model',gen_random_uuid(),'{}');
  exception when sqlstate 'P0001' then denied:=sqlerrm='AI_RATE_LIMIT_REACHED'; end;
  if not denied then raise exception 'Existing request rate limit stopped working'; end if;
end $rate_limit$;
reset role;
select jsonb_build_object('fixture_game',current_setting('audit.game_id'),'checks','completed callback immutability; failure known-usage retention; monthly failed charges; no failed reservation row; actor membership; service-only grants; failed-to-completed retention; prior-month exclusion; rate limit') as verification;
rollback;
