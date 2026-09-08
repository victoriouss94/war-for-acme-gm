-- Substitute an existing permanent owner UUID in memory. No paid AI calls.
-- All rows are synthetic and the transaction always rolls back.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $fixture$
declare gid uuid:=gen_random_uuid();
begin
  perform public.create_game(gid,jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback AI intent contract','status','SETUP'),'data',jsonb_build_object('gameId',gid,'players','[]'::jsonb,'roles','[]'::jsonb,'abilities','[]'::jsonb,'factions','[]'::jsonb,'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb)));
  perform public.set_ai_usage_limit(gid,null,120);
  perform set_config('audit.game_id',gid::text,true);
end $fixture$;
reset role;
select set_config('audit.nonmember',(select id::text from auth.users where id<>'__AUDIT_OWNER_UUID__'::uuid and not coalesce(is_anonymous,false) order by created_at limit 1),true);
set local role service_role;
do $valid$
declare feature_name text; rid uuid; gid uuid:=current_setting('audit.game_id')::uuid;
begin
  foreach feature_name in array array['assistant','roster_setup','phase_control','live_status','explain_content','search_history','search_precedents','resolve_actions','plan_session','analyze_balance','create_role','create_ability','create_faction','create_rule','create_status','document_import','edit_content','ability_inventory','ability_grant','queue_action','explain_role','balance_role','knowledge_ingest'] loop
    rid:=gen_random_uuid();
    perform public.reserve_ai_usage_internal(gid,'__AUDIT_OWNER_UUID__',feature_name,'audit-model',rid,'{"synthetic":true}');
    if not exists(select 1 from public.ai_usage_events where id=rid and game_id=gid and user_id='__AUDIT_OWNER_UUID__' and feature=feature_name and model='audit-model' and status='STARTED' and pricing_snapshot='{"synthetic":true}'::jsonb) then raise exception 'Incorrect reservation for %',feature_name; end if;
  end loop;
  if (select count(*) from public.ai_usage_events where game_id=gid)<>23 then raise exception 'Unexpected reservation count'; end if;
end $valid$;
do $invalid$
declare feature_name text; model_name text; denied boolean; gid uuid:=current_setting('audit.game_id')::uuid;
begin
  foreach feature_name in array array['unknown_intent','','auto','create_game',null] loop
    denied:=false;
    begin perform public.reserve_ai_usage_internal(gid,'__AUDIT_OWNER_UUID__',feature_name,'audit-model',gen_random_uuid(),'{}');
    exception when invalid_parameter_value then denied:=sqlerrm='INVALID_AI_USAGE_REQUEST'; end;
    if not denied then raise exception 'Invalid feature accepted: %',feature_name; end if;
  end loop;
  foreach model_name in array array['',repeat('x',121),null] loop
    denied:=false;
    begin perform public.reserve_ai_usage_internal(gid,'__AUDIT_OWNER_UUID__','create_faction',model_name,gen_random_uuid(),'{}');
    exception when invalid_parameter_value then denied:=sqlerrm='INVALID_AI_USAGE_REQUEST'; end;
    if not denied then raise exception 'Invalid model accepted'; end if;
  end loop;
  if (select count(*) from public.ai_usage_events where game_id=gid)<>23 then raise exception 'Invalid request left a reservation'; end if;
  if nullif(current_setting('audit.nonmember'),'') is null then raise exception 'Second permanent fixture account required'; end if;
  denied:=false;
  begin perform public.reserve_ai_usage_internal(gid,current_setting('audit.nonmember')::uuid,'ability_grant','audit-model',gen_random_uuid(),'{}');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Nonmember reservation accepted'; end if;
end $invalid$;
reset role;
set local role authenticated;
do $client_denial$
declare denied boolean:=false;
begin
  begin perform public.reserve_ai_usage_internal(current_setting('audit.game_id')::uuid,auth.uid(),'phase_control','audit-model',gen_random_uuid(),'{}');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Browser may invoke internal reservation'; end if;
end $client_denial$;
reset role;
select current_setting('audit.game_id') as fixture_game,23 as supported_features_verified,'invalid labels/models denied; member/service boundary retained; no invalid rows' as checks;
rollback;
