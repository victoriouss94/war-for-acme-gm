begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $audit$
declare gids uuid[]:=array[gen_random_uuid(),gen_random_uuid()];gid uuid;doc jsonb:=$fixture$__DERIVED_REVIEW_FIXTURE_JSON__$fixture$::jsonb;reviews jsonb;all_reviews jsonb;observations jsonb:='[]';
begin
  foreach gid in array gids loop
    perform public.create_game(gid,replace(doc::text,'__DERIVED_GAME_UUID__',gid::text)::jsonb);
  end loop;
  foreach gid in array gids loop
  reviews:=public.get_mechanics_review_queue(gid);
  select coalesce(jsonb_agg(r order by r->>'id'),'[]') into all_reviews from jsonb_array_elements(public.get_mechanics_review_queue(null)) r where r->>'gameId'=gid::text;
  if __EXPECT_REPAIRED__ and all_reviews is distinct from (select jsonb_agg(r order by r->>'id') from jsonb_array_elements(reviews) r) then raise exception 'Review identity changes with query scope'; end if;
  observations:=observations||jsonb_build_array(jsonb_build_object('fixture_id',gid,'reviews',reviews,'all_reviews',all_reviews));
  end loop;
  perform set_config('audit.derived_reviews',jsonb_build_object('games',observations)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  if public.get_mechanics_review_queue(gid)<>'[]'::jsonb then raise exception 'Unrelated identity saw reviews'; end if;
  perform set_config('request.jwt.claims','{}',true);
  if public.get_mechanics_review_queue(gid)<>'[]'::jsonb then raise exception 'Missing identity saw reviews'; end if;
end $audit$;
select current_setting('audit.derived_reviews')::jsonb verification;
rollback;
