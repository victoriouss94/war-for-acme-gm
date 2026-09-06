-- Replace __AUDIT_OWNER_UUID__ with an authorized fixture account.
-- Requires a second existing permanent account; no accounts are created.
-- Every fixture change, including the test-only expiry seed, is rolled back.
begin;
select set_config('audit.guest',(select id::text from auth.users where id<>'__AUDIT_OWNER_UUID__' and not coalesce(is_anonymous,false) limit 1),true);
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $test$
declare gid uuid:=gen_random_uuid(); doc jsonb; inv record; expired_inv record; revoked_inv record; reusable_inv record; revokes integer; guest uuid:=nullif(current_setting('audit.guest',true),'')::uuid; denied boolean;
begin
if guest is null then raise exception 'Second fixture account unavailable'; end if;
doc:=jsonb_build_object('game',jsonb_build_object('id',gid,'name','Rollback approval audit','status','SETUP','currentDay',0,'currentPhase','Night'),'data',jsonb_build_object('gameId',gid,'players',jsonb_build_array(jsonb_build_object('id','audit-actor','gameId',gid,'name','Audit Actor','alive',true,'roleId','audit-role','currentFactionId','audit-town'),jsonb_build_object('id','audit-target','gameId',gid,'name','Audit Target','alive',true,'roleId','audit-role','currentFactionId','audit-town')),'roles',jsonb_build_array(jsonb_build_object('id','audit-role','gameId',gid,'name','Audit Investigator','roleType','STANDARD','factionId','audit-town','tags',jsonb_build_array('Ask'),'enabled',true)),'abilities',jsonb_build_array(jsonb_build_object('id','audit-ask','gameId',gid,'name','Ask','phase','Night','definition','Investigate one player.','enabled',true)),'factions',jsonb_build_array(jsonb_build_object('id','audit-town','gameId',gid,'name','Audit Town','class','VILLAGER')),'actions','[]'::jsonb,'rules','[]'::jsonb,'history','[]'::jsonb));
perform public.create_game(gid,doc);


select * into revoked_inv from public.generate_game_invite(gid,'viewer',86400,1);
perform public.revoke_game_invite(revoked_inv.id);
select count(*) into revokes from public.change_history where game_id=gid and entity_id=revoked_inv.id::text and action='Invite Revoked';
perform public.revoke_game_invite(revoked_inv.id);
if (select count(*) from public.change_history where game_id=gid and entity_id=revoked_inv.id::text and action='Invite Revoked')<>revokes then raise exception 'Repeated revocation duplicated audit event'; end if;
select * into expired_inv from public.generate_game_invite(gid,'viewer',86400,1);
select * into reusable_inv from public.generate_game_invite(gid,'viewer',null,null);
perform set_config('audit.fixture',jsonb_build_object('game_id',gid,'expired_id',expired_inv.id,'expired_code',expired_inv.code,'revoked_code',revoked_inv.code,'reusable_id',reusable_inv.id,'reusable_code',reusable_inv.code)::text,true);
end $test$;
reset role;
-- Seed only this freshly generated fixture invitation into the past; never wait
-- for a live invitation or modify an existing game's invitation.
update public.game_invites set expires_at=statement_timestamp()-interval '1 minute'
where id=(current_setting('audit.fixture')::jsonb->>'expired_id')::uuid
  and game_id=(current_setting('audit.fixture')::jsonb->>'game_id')::uuid;
set local role authenticated;
do $test$
declare
  fixture jsonb:=current_setting('audit.fixture')::jsonb;
  gid uuid:=(fixture->>'game_id')::uuid;
  guest uuid:=current_setting('audit.guest')::uuid;
  rejected boolean; candidate record; checked integer:=0;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',guest,'role','authenticated','is_anonymous',false)::text,true);
  for candidate in select * from (values
    (fixture->>'revoked_code','INVITE_REVOKED'),
    (fixture->>'expired_code','INVITE_EXPIRED'),
    ('','INVITE_NOT_FOUND'),
    ('INVALID-AUDIT-CODE','INVITE_NOT_FOUND'),
    (repeat('A',41),'INVITE_NOT_FOUND')
  ) cases(code,expected_error) loop
    rejected:=false;
    begin perform public.redeem_game_invite(candidate.code);
    exception when raise_exception then
      if sqlerrm<>candidate.expected_error then raise; end if;
      rejected:=true;
    end;
    if not rejected then raise exception 'Invalid invite accepted: %',candidate.expected_error; end if;
    checked:=checked+1;
  end loop;
  if public.is_game_member(gid) then raise exception 'Failed redemption granted membership'; end if;
  perform public.redeem_game_invite(' '||lower(fixture->>'reusable_code')||chr(9)||chr(10));
  rejected:=false;
  begin perform public.redeem_game_invite(fixture->>'reusable_code');
  exception when raise_exception then
    if sqlerrm<>'ALREADY_JOINED' then raise; end if; rejected:=true;
  end;
  if not rejected then raise exception 'Duplicate membership accepted'; end if;
  perform set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
  if exists(select 1 from public.game_invites where game_id=gid and id<>(fixture->>'reusable_id')::uuid and use_count<>0) then raise exception 'Failed redemption consumed an invite'; end if;
  if (select use_count from public.game_invites where id=(fixture->>'reusable_id')::uuid)<>1 then raise exception 'Duplicate redemption consumed an extra use'; end if;
  perform public.remove_game_member(gid,guest);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',guest,'role','authenticated','is_anonymous',false)::text,true);
  perform public.redeem_game_invite(fixture->>'reusable_code');
  if not public.is_game_member(gid) or public.can_edit_game(gid) then raise exception 'Reusable viewer invite incorrect'; end if;
  perform set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
  if (select use_count from public.game_invites where id=(fixture->>'reusable_id')::uuid)<>2 then raise exception 'Reusable invitation count incorrect'; end if;
  perform set_config('audit.result',jsonb_build_object('game_id',gid,'rejected_code_cases',checked,'checks','revoked and expired denied; invalid inputs denied; repeated revoke idempotent; failed join consumes nothing; duplicate membership denied; reusable invite can rejoin as viewer; whitespace normalized')::text,true);
end $test$;
select current_setting('audit.result')::jsonb as verification;
rollback;
