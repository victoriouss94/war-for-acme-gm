-- Substitute __AUDIT_OWNER_UUID__ and 4 in memory.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $audit$
declare gids uuid[]:=array[gen_random_uuid(),gen_random_uuid()]; gid uuid; payload jsonb; result jsonb; combined jsonb; m jsonb; roles jsonb; abilities jsonb;
begin
  m:='{"id":"shared-review","type":"ACTIVE_ABILITY","originalText":"Synthetic unresolved source","requiresReview":true,"sourceAbilityId":"ability-one"}'::jsonb;
  roles:=jsonb_build_array(
    jsonb_build_object('id','role-one','name','One','roleType','STANDARD','slotCount',1,'factionId','faction','activeAbilityId','ability-one','tags',jsonb_build_array('One'),'understanding',jsonb_build_object('mechanics',jsonb_build_array(m))),
    jsonb_build_object('id','role-two','name','Two','roleType','STANDARD','slotCount',1,'factionId','faction','activeAbilityId','ability-one','tags',jsonb_build_array('One'),'understanding',jsonb_build_object('mechanics',jsonb_build_array(m))));
  abilities:=jsonb_build_array(jsonb_build_object('id','ability-one','name','One','understanding',jsonb_build_object('mechanics',jsonb_build_array(m))),jsonb_build_object('id','ability-two','name','Two','understanding',jsonb_build_object('mechanics',jsonb_build_array(m))));
  foreach gid in array gids loop
    payload:=jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback review identity audit','status','SETUP','currentDay',0,'currentPhase','Night'),
      'data',jsonb_build_object('gameId',gid,'roles',roles,'abilities',abilities,'factions',jsonb_build_array(jsonb_build_object('id','faction','name','Faction','class','VILLAGER')),'players','[]'::jsonb,'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb));
    perform public.create_game(gid,payload);
    result:=public.get_mechanics_review_queue(gid);
    if jsonb_array_length(result) is distinct from 4 then raise exception 'Expected % reviews, got %',4,jsonb_array_length(result); end if;
    if exists(select 1 from jsonb_array_elements(result) r where r->>'id'<>'shared-review') then raise exception 'Original review IDs changed'; end if;
  end loop;
  select jsonb_agg(r) into combined from jsonb_array_elements(public.get_mechanics_review_queue(null)) r where (r->>'gameId')::uuid=any(gids);
  if jsonb_array_length(combined) is distinct from (4*2) then raise exception 'Cross-game count mismatch'; end if;
  perform set_config('audit.review_ids',to_jsonb(gids)::text,true);
  perform set_config('audit.review_rows',combined::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  if public.get_mechanics_review_queue(gids[1]) is distinct from '[]'::jsonb then raise exception 'Unrelated caller saw fixture'; end if;
  perform set_config('request.jwt.claims','{}',true);
  if public.get_mechanics_review_queue(gids[1]) is distinct from '[]'::jsonb then raise exception 'Missing identity saw fixture'; end if;
end $audit$;
select current_setting('audit.review_ids')::jsonb as fixture_ids,current_setting('audit.review_rows')::jsonb as reviews;
rollback;
