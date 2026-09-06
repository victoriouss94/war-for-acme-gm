-- Read-only assertions against the migrated catalog; no live table truncation.
begin;
do $test$
declare
  client_role text;
  operation text;
  target record;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    for target in select c.oid, c.relname from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r', 'p')
    loop
      foreach operation in array array['TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(client_role, target.oid, operation) then
          raise exception 'Unexpected maintenance privilege: % % %', client_role, target.relname, operation;
        end if;
      end loop;
    end loop;
    if to_regclass('public.game_rooms') is not null then
      foreach operation in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(client_role, 'public.game_rooms', operation) then
          raise exception 'Legacy room client access remains: % %', client_role, operation;
        end if;
      end loop;
    end if;
  end loop;
  if exists (
    select 1 from pg_default_acl d
    join pg_namespace n on n.oid=d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole and n.nspname='public' and d.defaclobjtype='r'
      and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
      and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) then raise exception 'New application tables would inherit client maintenance access'; end if;
end $test$;
set local role anon;
do $test$ begin
  if to_regclass('public.game_rooms') is not null then
    begin
      perform count(*) from public.game_rooms;
      raise exception 'Anonymous legacy read unexpectedly succeeded';
    exception when insufficient_privilege then null;
    end;
  end if;
end $test$;
reset role;
set local role authenticated;
do $test$ begin
  if to_regclass('public.game_rooms') is not null then
    begin
      perform count(*) from public.game_rooms;
      raise exception 'Authenticated legacy read unexpectedly succeeded';
    exception when insufficient_privilege then null;
    end;
  end if;
end $test$;
reset role;
select 'Client maintenance and legacy room restrictions verified' as verification;
rollback;
