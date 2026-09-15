-- Run only through scripts/test-precedent-rls.mjs in isolated PGlite 0.5.8.
-- Regression for explicitly approved invited-GM GLOBAL sharing.
begin;
insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444'),
 ('55555555-5555-4555-8555-555555555555');
insert into public.profiles(id) select id from auth.users;
insert into public.games values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Current'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','Same owner source'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','Different owner');
insert into public.game_members values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','owner'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','owner'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','gm'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','gm'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','viewer');
insert into public.gm_precedents(game_id,title,interaction_signature,signature_tokens,final_outcome,scope,status,approved_for_global_use,role_ids,ability_ids,created_by,approved_by)
select game_id::uuid,title,'nova',array['ability:nova'],jsonb_build_object('ruling',title),scope,status,scope='GLOBAL',roles,abilities,
 '11111111-1111-4111-8111-111111111111'::uuid,'11111111-1111-4111-8111-111111111111'::uuid
from (values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Current ruling','GAME_SPECIFIC','ACTIVE','{}'::text[],'{}'::text[]),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Private other game','GAME_SPECIFIC','ACTIVE','{}'::text[],'{}'::text[]),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Shared global','GLOBAL','ACTIVE','{}'::text[],'{}'::text[]),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Other owner global','GLOBAL','ACTIVE','{}'::text[],'{}'::text[]),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','One time','ONE_TIME','ACTIVE','{}'::text[],'{}'::text[]),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Superseded global','GLOBAL','SUPERSEDED','{}'::text[],'{}'::text[]),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Archived global','GLOBAL','ARCHIVED','{}'::text[],'{}'::text[]),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Conflicting global','GLOBAL','CONFLICTING','{}'::text[],'{}'::text[]),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Matching role','ROLE_SPECIFIC','ACTIVE',array['role-one'],'{}'::text[]),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Unmatched role','ROLE_SPECIFIC','ACTIVE',array['role-two'],'{}'::text[]),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Matching ability','ABILITY_SPECIFIC','ACTIVE','{}'::text[],array['nova']),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Unmatched ability','ABILITY_SPECIFIC','ACTIVE','{}'::text[],array['beam'])
) as seed(game_id,title,scope,status,roles,abilities);

do $$ begin
 begin
  insert into public.gm_precedents(game_id,title,interaction_signature,signature_tokens,final_outcome,scope,status,approved_for_global_use,created_by,approved_by)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Unapproved global','nova',array['ability:nova'],'{}','GLOBAL','ACTIVE',false,'11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111');
  raise exception 'Unapproved GLOBAL insert accepted';
 exception when check_violation then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","is_anonymous":false}',true);
do $$
declare names text[];
begin
 select array_agg(title order by title) into names from public.search_gm_precedents('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['ability:nova','role:role_one'],'',50);
 if names is distinct from array['Conflicting global','Current ruling','Matching ability','Matching role','Shared global'] then raise exception 'Owner scoped retrieval mismatch: %',names;end if;
 if exists(select 1 from public.search_gm_precedents('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['ability:beam'],'',50) where title in ('Matching role','Matching ability')) then raise exception 'Role/ability scoping failed';end if;
end $$;
select jsonb_build_object('ownerNamespaceScope','PASS','oneTimeAndInactiveExcluded','PASS','roleAndAbilityFilters','PASS','otherOwnerExcludedDespiteMembership','PASS') as audit_result;

select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","is_anonymous":false}',true);
do $$
begin
 if not public.can_edit_game('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'GM must edit current game';end if;
 if exists(select 1 from public.games where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Private source game metadata leaked';end if;
 if not exists(select 1 from public.search_gm_precedents('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['ability:nova'],'',50) where title='Current ruling') then raise exception 'GM current-game search failed';end if;
 if not exists(select 1 from public.search_gm_precedents('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['ability:nova'],'',50) where title='Shared global') then raise exception 'Approved GLOBAL ruling missing for invited GM';end if;
 if exists(select 1 from public.gm_precedents where title in ('Private other game','Other owner global','Unapproved global')) then raise exception 'Private, unapproved or foreign-owner ruling leaked';end if;
 begin perform * from public.search_gm_precedents('cccccccc-cccc-4ccc-8ccc-cccccccccccc',array['ability:nova'],'',50);raise exception 'Unauthorized target accepted';exception when insufficient_privilege then null;end;
end $$;
select jsonb_build_object('gmCurrentGameSearch','PASS','privateSourceMetadataIsolation','PASS','gmCrossGameGlobalWithoutSourceMembership','PASS') as audit_result;

reset role;
update public.game_members set member_role='viewer' where user_id='33333333-3333-4333-8333-333333333333';
set local role authenticated;
do $$ begin
 if exists(select 1 from public.gm_precedents) then raise exception 'Revoked GM retained global access';end if;
end $$;
reset role;
update public.game_members set member_role='gm' where user_id='33333333-3333-4333-8333-333333333333';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","is_anonymous":true}',true);
do $$ begin
 if exists(select 1 from public.gm_precedents) then raise exception 'Anonymous account retained access';end if;
end $$;
select set_config('request.jwt.claims','{}',true);
do $$ begin
 if exists(select 1 from public.gm_precedents) then raise exception 'Missing identity retained access';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","is_anonymous":false}',true);
select jsonb_build_object('revocationImmediate','PASS','anonymousAccountDenied','PASS','missingIdentityDenied','PASS','unapprovedGlobalDenied','PASS','unauthorizedTargetDenied','PASS') as audit_result;

reset role;
insert into public.game_members values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','viewer');
set local role authenticated;
do $$
begin
 if not exists(select 1 from public.search_gm_precedents('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['ability:nova'],'',50) where title='Shared global') then raise exception 'Source-visible GM control did not retrieve global';end if;
 if exists(select 1 from public.search_gm_precedents('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['ability:nova'],'',50) where title='Private other game') then raise exception 'Private ruling leaked';end if;
end $$;
select jsonb_build_object('gmSourceVisibleGlobalControl','PASS','privateOtherGameRulingExcluded','PASS') as audit_result;

select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","is_anonymous":false}',true);
do $$
begin
 begin perform * from public.search_gm_precedents('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['ability:nova'],'',50);raise exception 'Viewer accepted';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.gm_precedents) then raise exception 'Viewer precedent rows leaked';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"55555555-5555-4555-8555-555555555555","is_anonymous":false}',true);
do $$
begin
 begin perform * from public.search_gm_precedents('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['ability:nova'],'',50);raise exception 'Nonmember accepted';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.gm_precedents) then raise exception 'Nonmember precedent rows leaked';end if;
end $$;
select jsonb_build_object('viewerDenied','PASS','nonmemberDenied','PASS','directSelectIsolation','PASS') as audit_result;
reset role;
rollback;
