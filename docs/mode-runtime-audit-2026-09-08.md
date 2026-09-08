# Role reassignment and temporary-mode audit — September 8, 2026

## Reproduced failures

An authenticated rollback fixture created a game, initialized one player's old-role mode, granted temporary access, changed their role through `save_game_document`, and tried a new-role grant/action. The grant returned an **old-role** runtime row; the queue rejected the newly granted action with `INACTIVE_MODE`. Its event was attributed to the old role.

The same production snapshot function included old-role runtime and temporary access after reassignment. Where two roles shared a mode ID, the existing deterministic engine could execute the new-role action or activate its defense using that obsolete access. The frontend also inherited old locks and cooldowns. Five of the first seven executable regressions failed before repair.

A separate normal, same-role grant with no expiry was rejected. SQL `NOT (nullable expiry comparison)` produced NULL rather than false. Both bounded and unlimited grants are now covered.

The engine additionally rejected a valid starting-mode action when no runtime row existed, despite the queue/UI accepting the role's default. It now uses the existing mode normalizer, including for starting-mode defenses.

## Existing paths repaired

- `normalizePlayerModeState` ignores role-tagged runtime from another role, supporting snake_case and camelCase fields while preserving legacy unscoped/current-role data.
- The canonical `resolveNightDeterministically` shares current/default mode normalization and excludes obsolete temporary access, including older saved snapshots. No second resolver was created.
- `mutate_temporary_mode_access` initializes current-role state before grant/revoke if the persisted row belongs to the old role. The existing transition helper resets obsolete access, locks and cooldowns and retains history.
- `validate_player_action_mode_context` handles unlimited expiry correctly and does not report another role's lock.
- `start_resolution_session` includes only current-role runtime/access and tags flattened access with its owner role. Existing saved sessions are not rewritten.
- Relevant frontend module cache versions advanced together to 12.2.27; engine version is 1.2.3.

Migration: `20260908185356_scope_mode_runtime_and_temporary_access_to_current_role.sql`. Supabase CLI is unavailable in this environment; the local filename uses the version returned by the production migration ledger. Existing ownership, ACLs and empty search paths were preserved; no tables or new privileged endpoints were added.

## Verification

- Nine new runtime/engine tests cover stale locks/access/cooldowns, both role field conventions, legacy/current runtime, default-mode actions/defenses, and stale-versus-current temporary defenses. Full suite: **515 passed, zero skipped**, including the actual Transformers DOCX fixture.
- Authenticated application SQL workflow: create/start, initialize/grant, save role reassignment, grant/revoke, queue, create immutable snapshot. NONE, GRANT, and REVOKE cases passed with scoped assertions; nonmember mutations were denied. The no-expiry grant was separately reproduced before repair and passed after repair.
- Actual cloud-normalized actions/snapshots returned by those transactions were resolved by the real JS engine: 1/2/1 successful control-and-granted actions, zero AI calls.
- All fixture transactions use `ROLLBACK`; no account creation, external file mutation, paid AI, or live game simulation.
- Production migration applied; postdeployment NONE/GRANT/REVOKE and unlimited-after-reassignment cases passed. All 14 fixture game IDs were verified absent. Live Transformers remained Night 1, version 192, with 44 alive.
- Security advisors remained unchanged in count: 43 authenticated-definer warnings, one leaked-password-protection warning, and one RLS informational finding. No new endpoints or privileges were introduced.
- Syntax checks and static production build passed. The project's `typecheck` is syntax checking, not a separate TypeScript compiler.

This pass tests authenticated SQL/application integration, **not a fresh-login HTTP or browser end-to-end session**. The wider audit remains incomplete, including native browser approval/advance, account and Storage HTTP flows, review-queue parity, identity-preserving mode rename, and remaining AI-budget reservations.
