# Security audit — interim findings

## Repairs verified in production

- Closed anonymous read/write access to the unused legacy `game_rooms` table. Removed its three unrestricted policies and revoked client grants. The existing record is preserved, as is server access. Current application code and database functions do not reference this table.
- Removed unnecessary `TRUNCATE`, `REFERENCES`, and `TRIGGER` privileges from public/browser roles on public tables. Normal SELECT/INSERT/UPDATE/DELETE permissions and all server-role permissions were unchanged across the 903-entry before/after privilege comparison. Updated future table defaults for the application migration owner (`postgres`); platform-managed role defaults were not altered.
- SQL regression checks verify client denials and the default-privilege restriction without attempting to truncate a live table. The invitation integration still passes with viewer read-only access, owner-controlled promotion, removal, and single-use enforcement.

Migrations: `20260906013303_close_legacy_game_rooms_anonymous_access` and `20260906013822_restrict_client_table_maintenance_privileges`.

## Important limitations

The legacy policies were a real anonymous-access exposure. There is no evidence in this audit establishing whether anyone exploited it. Excess maintenance grants are defense-in-depth hardening; this audit did not demonstrate a browser REST route that could invoke TRUNCATE.

RLS being enabled is not enough to establish security: a policy that allows every row still exposes every row. Permission checks must evaluate both grants and policy expressions.

The security advisor still reports 45 warnings (44 intentionally exposed authenticated definer functions requiring individual authorization review, plus disabled leaked-password protection). One new informational notice describes the legacy table having RLS but no policies; this is intentional deny-by-default archival storage with client grants revoked. Do not add a permissive policy merely to hide this notice.

References: [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL RLS exclusions](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [no-policy advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

This is not a completed security certification or a completed full application audit. Live game records were not changed by these repairs or tests.
