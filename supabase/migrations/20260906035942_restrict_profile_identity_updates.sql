-- A table-wide UPDATE grant overrides a column-only UPDATE grant. Remove both
-- table defaults and any old column grants, then restore the intended client API.
revoke all on table public.profiles from public,anon,authenticated;
revoke all(id,display_name,created_at,updated_at,username,username_normalized,last_login_at,legacy_account)
  on table public.profiles from public,anon,authenticated;
grant select on table public.profiles to authenticated;
grant update(display_name,last_login_at) on table public.profiles to authenticated;
-- Existing self/shared-read RLS and self-update RLS are unchanged. Account
-- creation and validated legacy completion still run through postgres-owned
-- definer functions. No profile data or service_role privileges are changed.
