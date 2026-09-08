-- Authenticated owner UUID and poisonResolutionFixture() JSON are substituted
-- in memory. All new game/status/membership/history rows are rolled back.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $game$
declare gid uuid:=gen_random_uuid(); fixture jsonb:='__ENGINE_FIXTURE_JSON__'::jsonb;
begin
  fixture:=replace(fixture::text,'__AUDIT_GAME_UUID__',gid::text)::jsonb;
  perform public.create_game(gid,fixture->'document');
  perform set_config('audit.game_id',gid::text,true);
end $game$;
reset role;
do $member$
declare uid uuid;
begin
  select id into uid from auth.users where id<>'__AUDIT_OWNER_UUID__'::uuid and not coalesce(is_anonymous,false) order by created_at limit 1;
  if uid is null then raise exception 'An existing second permanent account is required'; end if;
  insert into public.game_members(game_id,user_id,member_role) values(current_setting('audit.game_id')::uuid,uid,'viewer');
  perform set_config('audit.viewer',uid::text,true);
end $member$;
set local role authenticated;
do $statuses$
declare gid uuid:=current_setting('audit.game_id')::uuid; effect public.player_status_effects; denied boolean; history_count integer;
begin
  effect:=public.mutate_player_status(gid,null,'APPLY',jsonb_build_object('player_id','audit-actor','status_type','MARK','status_name','Public test marker','visibility','PUBLIC'));
  perform set_config('audit.public_status',effect.id::text,true);
  perform public.mutate_player_status(gid,null,'APPLY',jsonb_build_object('player_id','audit-actor','status_type','MARK','status_name','Private GM test marker','visibility','GM_ONLY'));
  perform public.mutate_player_status(gid,null,'APPLY',jsonb_build_object('player_id','audit-actor','status_type','MARK','status_name','Subject test marker','visibility','OWNER_VISIBLE','subject_user_id',current_setting('audit.viewer')));
  perform public.mutate_player_status(gid,null,'APPLY',jsonb_build_object('player_id','audit-actor','status_type','MARK','status_name','Other subject marker','visibility','OWNER_VISIBLE','subject_user_id',auth.uid()));
  if (select count(*) from public.player_status_effects where game_id=gid)<>4 then raise exception 'GM cannot read all status visibilities'; end if;
  select count(*) into history_count from public.player_status_history where status_id=effect.id;
  update public.player_status_effects set description='Direct write is validated and audited',updated_by=current_setting('audit.viewer')::uuid where id=effect.id;
  if (select count(*) from public.player_status_history where status_id=effect.id)<>history_count+1
    or not exists(select 1 from public.player_status_effects where id=effect.id and updated_by=auth.uid()) then raise exception 'Direct GM write bypassed history or author validation'; end if;
  denied:=false;
  begin update public.player_status_effects set created_by=current_setting('audit.viewer')::uuid where id=effect.id;
  exception when sqlstate '22023' then denied:=sqlerrm='STATUS_IDENTITY_IMMUTABLE'; end;
  if not denied then raise exception 'Status creator can be forged'; end if;
  denied:=false;
  begin update public.player_status_effects set source_player_id='missing-audit-player' where id=effect.id;
  exception when foreign_key_violation then denied:=sqlerrm='STATUS_SOURCE_PLAYER_NOT_FOUND'; end;
  if not denied then raise exception 'Unknown source player was accepted'; end if;
  denied:=false;
  begin insert into public.player_status_effects(game_id,player_id,status_type,status_name) values(gid,'missing-audit-player','MARK','Invalid test');
  exception when foreign_key_violation then denied:=sqlerrm='PLAYER_NOT_FOUND'; end;
  if not denied then raise exception 'Direct insert bypassed player validation'; end if;
end $statuses$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('audit.viewer'),'role','authenticated','is_anonymous',false)::text,true);
do $viewer$
declare gid uuid:=current_setting('audit.game_id')::uuid; denied boolean:=false; changed integer;
begin
  if (select count(*) from public.player_status_effects where game_id=gid)<>2 then raise exception 'Viewer must see only public and own-subject statuses'; end if;
  if exists(select 1 from public.player_status_history where game_id=gid) then raise exception 'Viewer can read private status history'; end if;
  update public.player_status_effects set description='Viewer must not write' where id=current_setting('audit.public_status')::uuid;
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Viewer can directly update a status'; end if;
  begin insert into public.player_status_effects(game_id,player_id,status_type,status_name) values(gid,'audit-actor','MARK','Viewer must not insert');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Viewer can directly insert a status'; end if;
end $viewer$;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
select public.remove_game_member(current_setting('audit.game_id')::uuid,current_setting('audit.viewer')::uuid);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('audit.viewer'),'role','authenticated','is_anonymous',false)::text,true);
do $removed$
declare visible_after integer; denied boolean:=false;
begin
  select count(*) into visible_after from public.player_status_effects where game_id=current_setting('audit.game_id')::uuid;
  if visible_after<>0 then raise exception 'Removed member still sees % statuses; rollback fixture %',visible_after,current_setting('audit.game_id'); end if;
  begin perform public.get_player_state(current_setting('audit.game_id')::uuid,'audit-actor');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Removed member can read player-state RPC'; end if;
  perform set_config('audit.result',jsonb_build_object('game_id',current_setting('audit.game_id'),
    'checks','GM sees all; viewer public/own only; private history denied; direct GM validation/history; creator/source/player validation; viewer insert/update denied; removed subject sees no statuses or player state')::text,true);
end $removed$;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
do $retained_subject$
declare sid uuid; saved public.player_status_effects; denied boolean:=false;
begin
  select id into sid from public.player_status_effects where game_id=current_setting('audit.game_id')::uuid and status_name='Subject test marker';
  saved:=public.mutate_player_status(current_setting('audit.game_id')::uuid,sid,'RESOLVE',jsonb_build_object('reason','Resolve retained marker after subject removal'));
  if saved.state<>'RESOLVED' or saved.subject_user_id<>current_setting('audit.viewer')::uuid then raise exception 'Historical subject blocked resolution or lost attribution'; end if;
  begin update public.player_status_effects set subject_user_id=current_setting('audit.viewer')::uuid where id=current_setting('audit.public_status')::uuid;
  exception when foreign_key_violation then denied:=sqlerrm='STATUS_OWNER_NOT_GAME_MEMBER'; end;
  if not denied then raise exception 'A newly assigned subject need not be a current member'; end if;
  perform set_config('audit.result',(current_setting('audit.result')::jsonb||jsonb_build_object('retained_subject','GM resolve works; historical subject retained; new removed-subject assignment rejected'))::text,true);
end $retained_subject$;
select current_setting('audit.result')::jsonb as verification;
rollback;
