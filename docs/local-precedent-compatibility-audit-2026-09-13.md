# Current-game precedent compatibility audit — September 13, 2026

## Finding and existing-path repair

The existing gm-copilot evaluatePrecedentCompatibility function returned early for every non-GLOBAL precedent. Consequently, a current-game ruling retained its compatibility level even when a referenced active official ability changed version or a required historical status was absent.

Three production lines changed: non-GLOBAL SQL reason flags are accumulated instead of returning early, while cross-game role and concept-mapping restrictions remain GLOBAL-only. The existing status and official-version comparisons now also run for GAME_SPECIFIC, ROLE_SPECIFIC, ABILITY_SPECIFIC and GENERAL scopes. Matching local rulings keep their scope, authority and reason flags without requiring global concept mappings.

This changes reference compatibility, not game state or deterministic resolution. No permission, SQL, model, quota or prompt changes were made.

## Evidence

- Twelve new cases execute the actual Edge handler with mocked provider/database boundaries: changed version, missing status, and matching local context for each of four scopes.
- Before the repair, eight new cases failed and four matching-context controls passed.
- After repair, the handler test file has 76 passing cases. The full JavaScript suite has **1,039 passes, zero failures and zero skips**, including the supplied Transformers DOCX.
- These are runtime fault-injection tests, not fresh authenticated browser sessions or paid AI calls.

## Deployment verification

gm-copilot **v32** is ACTIVE with JWT verification enabled. All seven deployed files match the candidate after line-ending normalization; the six shared files are unchanged from v31. An unauthenticated POST is rejected with HTTP 401. Frontend **12.2.66**, engine **1.2.26**, knowledge ingestion **v8**, and Word import **v11** are unchanged.

No live game, account, Storage, usage-ledger data or database schema was modified. No paid provider request was made.

## Boundaries and remaining work

This verifies matched active official ability versions and presence of required status types, not arbitrary historical/current rule equivalence, player-specific status relationships, or missing source-version semantics. Compatibility is not proof that a precedent should override current explicit rules.

A separate local SQL/RLS characterization reproduced a cross-game retrieval limitation: an invited GM cannot retrieve the same owner's GLOBAL rulings from a source game they have not joined. Source-game membership makes those GLOBAL rulings visible; game-specific rulings remain excluded. Permissions are unchanged pending the user's sharing decision. This limitation is not repaired by v32.

The full audit remains **INCOMPLETE**, including uninterrupted native browser/two-GM workflows, durable usage accounting/concurrent spending safeguards, and general custom passive/on-death execution. See the [coverage index](AUDIT_COVERAGE_2026-09-08.md).
