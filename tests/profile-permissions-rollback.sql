-- Supply the permanent owner UUID in memory. Existing profile values are only
-- changed inside this transaction and must remain unchanged after ROLLBACK.
begin;
select set_config('request.jwt.claims','{"sub":"__AUDIT_OWNER_UUID__","role":"authenticated","is_anonymous":false}',true);
select set_config('audit.other_profile',(select id::text from public.profiles where id<>'__AUDIT_OWNER_UUID__'::uuid order by id limit 1),true);
set local role authenticated;

do $client$
declare col text; denied boolean; changed integer; command text;
begin
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Self profile read failed'; end if;
  update public.profiles set display_name='Isolated permission audit',last_login_at=now() where id=auth.uid();
  get diagnostics changed=row_count;
  if changed<>1 or not exists(select 1 from public.profiles where id=auth.uid() and display_name='Isolated permission audit') then raise exception 'Allowed self profile update failed'; end if;
  foreach col in array array['id','username','username_normalized','legacy_account','created_at','updated_at'] loop
    denied:=false;
    begin execute format('update public.profiles set %I=%I where id=auth.uid()',col,col);
    exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Protected profile column % can be edited',col; end if;
  end loop;
  foreach command in array array[
    'insert into public.profiles(id,username,username_normalized,display_name) select auth.uid(),''audit'',''audit'',''audit'' where false',
    'delete from public.profiles where false'
  ] loop
    denied:=false;
    begin execute command; exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Direct profile insert/delete is still granted'; end if;
  end loop;
  if nullif(current_setting('audit.other_profile'),'') is null then raise exception 'Existing second profile is needed for isolation test'; end if;
  update public.profiles set display_name='Must not change another account' where id=current_setting('audit.other_profile')::uuid;
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Self-edit grants allow another profile to be changed'; end if;
end $client$;

-- The existing validated account-identity endpoint must retain its privilege;
-- no password or authentication identity is read into test output or changed.
do $identity_rpc$
declare current_name text; denied boolean:=false;
begin
  select username into current_name from public.profiles where id=auth.uid();
  perform public.complete_legacy_account(current_name);
  if not exists(select 1 from public.profiles where id=auth.uid() and username=current_name and not legacy_account) then raise exception 'Valid account completion failed'; end if;
  begin perform public.complete_legacy_account('audit_'||substr(replace(gen_random_uuid()::text,'-',''),1,18));
  exception when sqlstate '28000' then denied:=true; end;
  if not denied then raise exception 'Account completion accepted a different authentication identity'; end if;
end $identity_rpc$;
reset role;

set local role anon;
do $anonymous$
declare denied boolean; command text;
begin
  foreach command in array array['select 1 from public.profiles limit 1','update public.profiles set display_name=display_name where false'] loop
    denied:=false;
    begin execute command; exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Anonymous profile access is still granted'; end if;
  end loop;
end $anonymous$;
reset role;

do $grants$
declare col text;
begin
  if has_table_privilege('authenticated','public.profiles','UPDATE')
    or not has_table_privilege('authenticated','public.profiles','SELECT')
    or not has_table_privilege('service_role','public.profiles','UPDATE') then raise exception 'Unexpected table grant change'; end if;
  foreach col in array array['id','display_name','created_at','updated_at','username','username_normalized','last_login_at','legacy_account'] loop
    if has_column_privilege('authenticated','public.profiles',col,'UPDATE')<>(col in ('display_name','last_login_at')) then raise exception 'Unexpected column grant on %',col; end if;
  end loop;
  if has_function_privilege('anon','public.complete_legacy_account(text)','EXECUTE') then raise exception 'Anonymous account completion is exposed'; end if;
end $grants$;
select jsonb_build_object('checks','self read; display name/last login update; six protected-column denials; no direct insert/delete; other-account isolation; valid identity completion; invalid identity rejected; anon denied; server grant preserved') as verification;
rollback;
