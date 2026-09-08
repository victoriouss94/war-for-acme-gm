# Derived mechanics review audit — September 8, 2026

## Reproduced problems

Authenticated create-game and review-query calls in two rolled-back synthetic games reproduced unstable IDs: an idless ability changed from suffix 6 in a single-game query to suffix 11 or 13 in the all-games query. Role mechanics also changed IDs with query scope.

The original seven-row response had the wrong membership: null and empty mechanic entries became warnings, blank unresolved-component lists produced a false warning, and legacy field aliases and an unknown interpretation state hid legitimate reviews. An additional malformed confidence value failed the entire query with PostgreSQL error 22P02.

## Repair

The existing review RPC now recognizes legacy mechanic fields, preserves original array ordinals, filters empty entries, and validates numeric confidence before conversion. Oversized exponents, invalid text, NaN and Infinity cannot crash the review list. Source-evidence warnings retain their existing independent rules.

For mechanics without stored IDs, the RPC returns an owner-scoped transport identity and the original source context. The client reuses the existing mechanic normalizer and review-item builder for canonical IDs, details and filtering. It does not introduce a second hash algorithm. Existing stored IDs remain unchanged; older server responses and synthetic source warnings remain compatible.

Only the read-only projection and UI merge changed. No roles, abilities, source documents, saved resolutions, player state or live-game progress were rewritten.

## Verification

- Seven new JavaScript regressions, including actual database-returned fixture rows and the app's real merge expression.
- Exact canonical cloud/local ID and detail parity for 12 synthetic reviews, including malformed confidence; two-game UI merge retains 24 entries without duplicating the current game's local overlay.
- Authenticated SQL fixtures with two games: seven ordinary reviews or twelve with malformed confidence in each game, with identical scoped/all-game responses. Missing and unrelated identities see no data.
- Previous source-warning regression still produces its exact six warnings; previous shared-ID ownership regression still returns four per game and eight across two games.
- Fixtures passed against transactional candidate DDL and after the production migration. All 15 successful fixture game IDs were verified absent after rollback.
- Full suite: **534 passed, zero skipped**, including the real Transformers DOCX. Syntax, static-build and diff checks passed. The project's typecheck is syntax checking, not a separate TypeScript compiler.
- Production migration: `20260908202623_align_derived_mechanic_review_projection.sql`. Function remains SECURITY INVOKER with empty search path and unchanged EXECUTE privileges; anonymous execution is denied. Security advisors are unchanged.
- Live Transformers remains Night 1, document version 192: 47 players, 44 alive.
- Frontend 12.2.30; existing night engine remains 1.2.3. No Edge Function changes, paid AI requests or accounts created.

## Limits and remaining audit work

These are SQL/application integration tests, not a newly verified browser-native approval flow. Browser approval/advance, fresh login and Storage HTTP flows, AI-budget reservations/accounting, and remaining passive/custom-interaction coverage still belong to the wider unfinished audit.
