-- Rollback-only boundary regression; no game records or stored rulings are mutated.
begin;
create temporary table audit_phase_payload (
  payload jsonb check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=100000)
) on commit drop;
do $$
declare
  full_ruling jsonb:=jsonb_build_object('final_ruling',repeat('x',290000));
  rejected boolean:=false;
begin
  begin
    insert into audit_phase_payload values(jsonb_build_object('finalResolution',full_ruling));
  exception when check_violation then rejected:=true;
  end;
  if not rejected then raise exception 'Old duplicated payload unexpectedly accepted'; end if;
  insert into audit_phase_payload values(jsonb_build_object('status','FINALIZED','decision','MODIFY','resolutionSessionId','test-session','finalResolutionStoredIn','resolution_sessions.final_resolution','finalResolutionBytes',octet_length(full_ruling::text)));
  if octet_length(full_ruling::text)>300000 then raise exception 'Fixture exceeds ruling cap'; end if;
  if not exists(select 1 from audit_phase_payload where payload->>'finalResolutionStoredIn'='resolution_sessions.final_resolution') then raise exception 'Missing full ruling reference'; end if;
end $$;
select 'PASS: oversized history copy rejected; full ruling reference accepted' as verification;
rollback;
