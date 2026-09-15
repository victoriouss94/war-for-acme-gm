# Invited GM GLOBAL ruling access

User explicitly approved cross-game GLOBAL ruling access on September 15, 2026. Production migration `invited_gm_global_precedent_access` applied successfully.

The original source-game inner join and SELECT policy hid GLOBAL precedents when an invited GM had not joined the source game. A private boolean helper now checks current authenticated GM membership within the source owner's namespace. The public search remains SECURITY INVOKER, with its existing target-game authorization, ranking and compatibility filters. The source-game join is now optional. No games SELECT policy, write permission, account, live-game state or Edge Function changed.

Only approved GLOBAL records cross game boundaries. Source-game private rows remain restricted. Membership removal takes effect on the next query. GLOBAL records may carry their existing source-name snapshot; the helper does not expose source-game rows or names.

## Verification

- Isolated PostgreSQL/RLS fixture fails before the migration with missing GLOBAL ruling, and passes after it.
- Owner/current-game search, invited GM without source membership, direct private/foreign-owner exclusions, target-game authorization, viewer/nonmember/anonymous/missing-identity denials, revoked GM membership, role/ability filters, ONE_TIME/inactive search exclusions and rollback all passed.
- Existing constraint rejects unapproved GLOBAL inserts; this was tested as an expected rejection, not weakened.
- Production catalog confirms public search is invoker, helper is in private with empty search_path, and anon cannot execute either. Read-only production transaction confirms missing-identity helper/search denials.
- Full JavaScript suite: 1,064 passed, zero failures/skips, including supplied Transformers document.
- Security advisor counts unchanged: 2 informational no-policy findings, 43 existing public definer warnings, 1 existing password-protection warning. No new public definer endpoint was introduced. This is not a claim that all existing advisories are resolved.

Run `scripts/test-precedent-rls.mjs` with PGlite 0.5.8 available as `@electric-sql/pglite`, or set `PGLITE_MODULE_URL` to its installed module URL. `--baseline` intentionally fails the corrected requirement without applying the migration. Synthetic local auth scaffold is not real-browser/JWT verification.

Frontend remains 12.2.70; no frontend or Edge redeployment is necessary. Full audit remains incomplete: browser-control ACL error and separately documented usage/custom-passive limitations remain.
