# AI draft approval audit — September 8, 2026

## Reproduced defect

The content-draft Approve & Add handler appended a role, ability, faction or rule to browser state and called the debounced save function, then immediately marked the draft APPROVED using a separate request. The save was neither awaited nor atomic with review. A save failure could leave an approved draft without saved content; a review failure could leave added content with a still-pending draft. Stale/cross-game draft objects and repeated clicks also lacked early checks.

Nine of ten initial actual-handler VM regression cases failed against the original function. These tests mock network/UI boundaries, not browser rendering. No live game was used to reproduce the failure.

## Repair

The existing frontend normalizers still build the proposed entity, but no longer append it optimistically or schedule a separate save. A new narrow approve_and_add_ai_draft RPC invokes the existing save_game_document and private.review_ai_draft delegates in one transaction. It derives the destination collection and game from the saved draft; clients cannot provide an arbitrary game document.

The server validates current GM access, draft state, expected document version, entity ownership/shape/size/name, duplicate names/IDs and required content. Standard Roles must reference existing Encyclopedia abilities and an existing faction; Basic Roles cannot acquire active/passive ability assignments. Only ROLE, ABILITY, FACTION and RULE content additions use this route. Status/import drafts retain review-only behavior and require their separate application workflows. Whole-game generation remains disabled.

The server appends one content record and a readable history entry, then reviews the draft. Failure of either delegated operation rolls back both. Already-reviewed draft retries are rejected without adding duplicates. The public wrapper is SECURITY INVOKER; the private implementation is SECURITY DEFINER with an empty search path, explicit GM checks and authenticated-only execution. Anonymous and service-role execution are not granted. Existing tables, review-only RPCs and save contracts remain intact.

The client prevents simultaneous approval clicks and requires prior edits to finish synchronizing. It only applies the returned server document after success, never overwrites another selected game, and preserves newer unsynchronized local edits made during the request.

## Verification

- Twelve actual-handler/bridge tests cover all four content types, failed requests, pending local edits, game switches, edits during a request, review-only statuses, stale records and double-click rejection.
- The production rollback fixture exercises all four content types through the public RPC with real database constraints, permission checks, version increments, exact appended data and audit history. It also rejects duplicate/replayed/stale/cross-game requests, unmapped role abilities, viewers, nonmembers and anonymous callers. A valid Basic Role is accepted without abilities; a Basic Role with active abilities is rejected.
- A fixture-only temporary trigger forces draft review to fail after the game-save delegate. The document, version, draft status and audit row counts remain unchanged, proving transaction rollback. The trigger and all four synthetic test games were verified absent after rollback.
- Full JavaScript suite: 417 passed, zero failed/skipped, including the supplied Transformers DOCX. Package syntax checks, static build and whitespace checks passed. Security advisors remain at 46 underlying findings in three categories; no clean security certification is claimed.

Migration 20260908134136_atomically_approve_and_add_ai_drafts is applied and verified. Frontend release 12.2.15 uses the new cloud bridge; the deterministic engine and Edge Functions were not changed. No paid AI calls, user/account changes, live Transformers edits or historical draft backfill were performed.

Browser-rendered approval and authenticated HTTP end-to-end verification remain distinct work. The broader audit and the documented AI spending-coverage gaps are still incomplete.
