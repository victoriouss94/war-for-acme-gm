# Security audit — interim findings

## Repairs verified in production

- Closed anonymous read/write access to the unused legacy `game_rooms` table. Removed its three unrestricted policies and revoked client grants. The existing record is preserved, as is server access. Current application code and database functions do not reference this table.
- Removed unnecessary `TRUNCATE`, `REFERENCES`, and `TRIGGER` privileges from public/browser roles on public tables. Normal SELECT/INSERT/UPDATE/DELETE permissions and all server-role permissions were unchanged across the 903-entry before/after privilege comparison. Updated future table defaults for the application migration owner (`postgres`); platform-managed role defaults were not altered.
- SQL regression checks verify client denials and the default-privilege restriction without attempting to truncate a live table. The invitation integration still passes with viewer read-only access, owner-controlled promotion, removal, and single-use enforcement.

Migrations: `20260906013303_close_legacy_game_rooms_anonymous_access` and `20260906013822_restrict_client_table_maintenance_privileges`.

## Additional rollback integration evidence

- `tests/mutation-authorization-rollback.sql` exercised 24 public mutations as both a nonmember and a viewer: 48 permission denials. This includes game edits/deletion, rules, knowledge metadata, modes, grants, queue operations, phase operations, deterministic simulation saves, both finalization endpoints, role-assignment previews, conversation creation and membership administration. Nonmembers could not read the game, viewers could, and denied calls left the document version and open resolution session unchanged.
- `tests/invitation-lifecycle-rollback.sql` verified revoked/expired/invalid invitations are rejected, repeat revocation does not duplicate history, failed redemption consumes no uses, existing members cannot join twice, reusable viewer invitations work after removal, and pasted lowercase codes with whitespace normalize correctly. Only a newly generated fixture invitation's expiry was seeded into the past; all fixture records were rolled back and verified absent.
- These are actual database RPC tests under authenticated-role claims, not real-token browser authentication or simultaneous-client tests. No existing account membership was changed persistently.

## Document-source cleanup policies

The Storage cleanup predicates incorrectly tested registration through the caller's RLS-filtered view of import/document metadata. After a source uploader was removed from a synthetic game, both DELETE predicates returned true for a still-registered source. The Word import SELECT policy separately allows the original uploader to read their source, so the registration guard could not reliably protect that file. No real file was deleted to demonstrate this; no exploitation claim is made.

Migration `20260906030803_protect_registered_document_sources_from_cleanup` replaces the registration subqueries with one private, owner/prefix-scoped predicate. It reads registration independently of membership visibility and fails closed for unknown buckets or missing ownership. Its privileged execution is limited to this boolean check, with an empty search path and no anonymous EXECUTE. A narrow own-unregistered knowledge SELECT policy also supplies the read permission needed to clean up failed knowledge registrations. Registered knowledge access and existing Word source read behavior remain unchanged.

`tests/storage-cleanup-policies-rollback.sql` evaluates the real catalog policy expressions under authenticated claims across 14 cases: registered sources after removal, own unregistered reads/cleanup, mismatched ownership, foreign prefixes, and existing read rules. Additional null/unknown-bucket checks and helper grants pass. The pre-fix registered cleanup decisions were true; after the repair both are false. Synthetic application metadata and membership are rolled back and verified absent. This is database policy coverage, not a real Storage HTTP upload/download/delete round trip. No Storage rows, object bytes, buckets or platform-managed grants were changed; the two private buckets still contain seven objects total.

Supabase-guided review preserved the distinction between Storage policies and managed Storage data: [access control](https://supabase.com/docs/guides/storage/security/access-control), [read-only Storage schema guidance](https://supabase.com/docs/guides/storage/schema/design). Security advisors remain unchanged at 45 warnings and one informational notice.

## Profile identity permissions

The username-account migration granted column-only updates but left a default
table-wide UPDATE grant in place. Under real authenticated-role claims, an account
could change its own stored username, normalized username and legacy-account flag
directly. A rollback test demonstrated all three writes. This could desynchronize
the displayed/account-password-check username from its Auth identity; the test did
not demonstrate access to another account or an authentication-token bypass.

Migration `20260906035942_restrict_profile_identity_updates` removes client table
and column defaults, then restores SELECT and updates of `display_name` and
`last_login_at` only. Existing RLS and server privileges are unchanged. The existing
validated identity-completion function retains its postgres-owned write path.

`tests/profile-permissions-rollback.sql` verifies self reads and permitted edits,
six protected-column denials, no direct insert/delete, cross-account update denial,
valid identity completion, mismatched identity rejection, anonymous denials, and
unchanged server grants. All test edits rolled back; the tested profile's complete
row fingerprint was unchanged. No password, Auth identity, account or game was
created, deleted or changed persistently. Security advisors remain at the same
46 keys. This does not establish fresh signup or login performance.

The direct-write inventory found only profiles and player statuses with public
write policies. Status writes are intentionally invoker/RLS-controlled with
private validation/history triggers; these must not be revoked merely because
the application calls an RPC. There are no public-schema views or tables lacking
RLS, but those inventory facts are not proof that each policy is correct.

## Removed-member status access and maintenance

A removed member could still read their OWNER_VISIBLE status, while the player-state RPC correctly denied access. The retained subject reference also caused later GM resolution to fail with STATUS_OWNER_NOT_GAME_MEMBER.

Migration20260906040446_scope_status_subject_access_to_membership requires current membership for subject-specific reads. It validates subject membership when assigning or changing the subject, allowing GMs to maintain unchanged historical references afterward. No status row is rewritten by this migration.

tests/status-visibility-rollback.sql reproduced both defects and passed after repair: GM/viewer visibility, private history denial, direct-write validation and history, creator attribution, invalid player/source rejection, viewer write denial, removed-member read denial, successful GM resolution, preserved historical subject, and rejection of a new removed-subject assignment. Test games were verified absent afterward. The validator remains private, postgres-only, with an empty search path. The 46 advisor keys are unchanged.

## Remaining security limitations

The legacy policies were a real anonymous-access exposure. There is no evidence in this audit establishing whether anyone exploited it. Excess maintenance grants are defense-in-depth hardening; this audit did not demonstrate a browser REST route that could invoke TRUNCATE.

RLS being enabled is not enough to establish security: a policy that allows every row still exposes every row. Permission checks must evaluate both grants and policy expressions.

The security advisor still reports 45 warnings (44 intentionally exposed authenticated definer functions requiring individual authorization review, plus disabled leaked-password protection). One new informational notice describes the legacy table having RLS but no policies; this is intentional deny-by-default archival storage with client grants revoked. Do not add a permissive policy merely to hide this notice.

References: [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL RLS exclusions](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [no-policy advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

This is not a completed security certification or a completed full application audit. Live game records were not changed by these repairs or tests.
