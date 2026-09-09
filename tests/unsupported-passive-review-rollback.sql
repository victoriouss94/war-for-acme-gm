-- Substitute owner UUID and SQL-escaped unsupportedPassiveFixture() JSON in memory.
-- Existing authenticated public RPCs only. All synthetic state is rolled back.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); fixture jsonb:='__ENGINE_FIXTURE_JSON__'::jsonb;
  ver integer; session_row public.resolution_sessions; queued jsonb; before_document jsonb;
begin
  fixture:=replace(fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,fixture->'document');
  select version into ver from public.game_documents where game_id=gid;
  perform public.start_game_phase(gid,ver,'NIGHT_0','Unsupported passive review audit');
  for queued in select value from jsonb_array_elements(fixture->'actions') loop
    select version into ver from public.game_documents where game_id=gid;
    perform public.queue_player_action(gid,ver,queued,null);
  end loop;
  select version into ver from public.game_documents where game_id=gid;
  session_row:=public.start_resolution_session(gid,ver);
  if not exists(select 1 from jsonb_array_elements(session_row.pre_resolution_state->'roles') r
    where r->>'id'='audit-passive-role' and r->'roleWidePassiveAbilityIds' ? 'audit-last-gift')
    then raise exception 'Custom passive missing from cloud snapshot'; end if;
  select document into before_document from public.game_documents where game_id=gid;
  session_row:=public.save_deterministic_resolution(session_row.id,session_row.lock_version,fixture->'proposal');
  if session_row.status<>'GM_REVIEW' or session_row.engine_status<>'GM_REVIEW_REQUIRED'
    or session_row.engine_proposal->'unresolved_questions' is distinct from fixture#>'{proposal,unresolved_questions}'
    or jsonb_array_length(session_row.engine_proposal->'unresolved_questions')<>1
    then raise exception 'Unsupported passive review not retained'; end if;
  if (select document from public.game_documents where game_id=gid) is distinct from before_document
    then raise exception 'Saving review mutated the game document'; end if;
  if not exists(select 1 from public.resolution_simulation_revisions r where r.session_id=session_row.id
    and r.proposal->'unresolved_questions'=fixture#>'{proposal,unresolved_questions}')
    then raise exception 'Saved simulation revision lost the review'; end if;
  perform set_config('audit.result',jsonb_build_object('game_id',gid,'session_id',session_row.id,
    'engine_status',session_row.engine_status,'questions',session_row.engine_proposal->'unresolved_questions',
    'checks','authenticated create/queue/snapshot/save; custom passive retained; review persisted in proposal and revision; no game-document mutation; no approval or AI calls')::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
