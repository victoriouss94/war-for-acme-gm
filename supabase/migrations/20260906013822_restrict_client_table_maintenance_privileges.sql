-- Browser roles never perform whole-table or schema maintenance.
-- Keep existing row-level SELECT/INSERT/UPDATE/DELETE grants and policies intact.
revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;

-- New application tables are created by postgres through migrations.
-- Supabase-managed role defaults are intentionally left to the platform.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from public, anon, authenticated;
