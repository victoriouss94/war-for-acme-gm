# Legacy resolution entry-point audit — September 8, 2026

## Existing paths found

| Entry point | Actual role |
| --- | --- |
| app.js resolveSelectedNight → night-engine.js resolveNightDeterministically | Current canonical simulation; known mechanics do not call AI |
| cloud.js finalizeResolutionSession → public.approve_and_apply_resolution | Current browser approval; complete atomic application |
| public.finalize_resolution_session | Old client signature, no current frontend/Edge caller |
| public.finalize_resolution_with_grants | Old client signature, no current frontend/Edge caller |
| private finalization helpers | Still called by the canonical approval transaction for history, learning and consumption; not dead code |

Source searches covered frontend and Edge functions, and the production function catalog confirmed the private helper dependency. No helper was deleted, and no alternate resolver was introduced. The exported cloud API is also checked against every GMCloud method referenced by the current frontend, including separately exported adjudicateInteraction.

## Reproduced defect and repair

An authenticated GM could call either old public endpoint with a valid engine-generated death ruling. Both returned FINALIZED with a DEAD outcome while the corresponding game player remained alive. Those endpoints finalized metadata without the outer canonical state-application transaction. The current frontend did not call them, but they remained callable by old clients.

Migration 20260908181612 preserves both public signatures as SECURITY INVOKER compatibility wrappers. They now delegate to public.approve_and_apply_resolution, retaining authorization, warning, source-version and atomic application checks. Direct authenticated execution of private.finalize_resolution_session is revoked; its definer-owned internal callers continue working. Existing records are not rewritten.

APPROVE selects the saved engine proposal, with legacy AI proposal fallback. Raw saved override metadata is normalized to the same object/string representation used by the existing editor; the initial bridge test caught a JSON-null check-constraint failure before deployment. MODIFY uses the supplied final ruling. REJECT applies no player state or consumption. The oldest signature derives consumed grant actions from its structured ruling because it lacks a consumption parameter. Explicit arrays in the grant-capable signature still undergo canonical consistency validation. Unstructured obsolete rulings fail validation rather than falsely finalize.

## Verification

Before repair, two isolated rollback fixtures returned FINALIZED while leaving the target alive. After repair, both applied the actual death.

A six-case authenticated rollback matrix covers both signatures × APPROVE/MODIFY/REJECT, using the real deterministic engine/editor fixture with a one-use granted kill. Every case verifies nonmember denial, direct-private-helper denial, malformed-ruling rejection and stale-source rejection. Approvals apply death and consume exactly one use; rejection preserves life and the use. The full matrix passed before deployment inside a rolled-back schema test and again against the deployed migration. All fixture games were verified absent afterward.

Security advisors went from46 to45 underlying findings: the old grant-capable public definer warning disappeared, and no new finding appeared.43 definer notices,1 leaked-password warning and1 intentional RLS/no-policy notice remain; this is not a complete security certification.

The existing48-case mutation authorization matrix was rerun after the privilege change and passed. Its legacy endpoint assertion now accepts missing-session only for that endpoint: the existing resolution_sessions_read_gm RLS policy hides sessions from both viewers and nonmembers, so the invoker wrapper reports not found instead of the old definer wrapper's permission error. All other unexpected errors still fail the test. Fixture f7f348ac-5431-43d7-b1d7-5af19fd065cd was rolled back and verified absent.

Four new JavaScript checks pass, and the full suite has506 passing tests, zero skipped, using the actual Transformers DOCX. Syntax/static-build/diff checks pass. These syntax checks are not full TypeScript static analysis.

No frontend version change, Edge deployment, paid AI request, live-game mutation, or historical result rewrite was needed. Transformers remained Night1/version192/44 alive.

## Remaining audit limitations

Browser testing could not resume: both initial CUA startup and one reset/retry failed before obtaining any tab state with a sandbox deny-read ACL error. No alternate browser control or authorization bypass was attempted. Native approval/advance UI remains unverified; the database/application tests do not substitute for it. Fresh account/Storage HTTP workflows, other dead paths, review identity parity, mode renames, AI spending boundaries and the broader audit remain open.
