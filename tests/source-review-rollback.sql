begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $audit$
declare gid uuid:=gen_random_uuid();doc jsonb:=$fixture$__SOURCE_REVIEW_FIXTURE_JSON__$fixture$::jsonb;reviews jsonb;actual jsonb;
begin
  doc:=replace(doc::text,'__REVIEW_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,doc);
  reviews:=public.get_mechanics_review_queue(gid);
  select coalesce(jsonb_agg(jsonb_build_array(r->>'roleId',r->>'mechanicType') order by r->>'roleId',r->>'mechanicType'),'[]') into actual from jsonb_array_elements(reviews) r;
  if __EXPECT_REPAIRED__ and actual is distinct from '__EXPECTED_SOURCE_REVIEWS__'::jsonb then raise exception 'Source review mismatch: %',actual; end if;
  perform set_config('audit.source_reviews',jsonb_build_object('fixture_id',gid,'actual',actual,'reviews',reviews)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  if public.get_mechanics_review_queue(gid)<>'[]'::jsonb then raise exception 'Unrelated account saw source review'; end if;
  perform set_config('request.jwt.claims','{}',true);
  if public.get_mechanics_review_queue(gid)<>'[]'::jsonb then raise exception 'Missing identity saw source review'; end if;
end $audit$;
select current_setting('audit.source_reviews')::jsonb verification;
rollback;
