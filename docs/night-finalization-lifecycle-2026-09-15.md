# Night finalization and phase advancement — v12.2.71

## Required findings and verification

1. **Existing finalization:** `finalizeSelectedResolution` calls `GMCloud.finalizeResolutionSession`, then the existing `approve_and_apply_resolution` RPC and private transactional implementation. Reused, not replaced.
2. **Existing phase controller:** `js/phase-controller.js` and `advance_game_phase`. The existing controller supports Day/Night; no configurable subphase system was found or removed.
3. **Why Finalize was unavailable:** misleading Approve & Apply labels, empty-queue UI/backend gates, and an empty payload rejected by the legacy validator. Finalization errors were not consistently visible beside the button.
4. **Why Advance was unreliable:** review and advancement controls were disconnected, finalization was not a consistent prerequisite, and proposal events could be counted as official results.
5. **Changes:** `index.html`, `js/app.js` (review controls, blockers, optional AI, finalization/advance handlers), `js/phase-controller.js` (official finalization detection and eligibility), `js/resolution-editor.js` (empty payload and override validation), release/build checks, regression tests, and migration `20260915141234_night_finalization_lifecycle.sql`.
6. **Before:** proposed review, ambiguously labelled approval, then a separately accessible advance operation with inconsistent empty-night and official-result handling.
7. **After:** Resolve → review/edit/recalculate → Finalize Night → official results → Advance Phase. Existing session FINALIZED and phase resolution_summary FINALIZED/official fields remain canonical. The phase stays CURRENT until advancement, then becomes COMPLETED.
8. **Duplicate systems:** historical versioned SQL wrappers exist but route through the existing canonical transaction. No second engine or controller was introduced.
9. **Consolidation:** clearer Finalize Night/Finalize Empty Night/Finalize With Override labels and an Advance Phase control in finalized review. The existing advanced reject/close-without-applying option remains separate.
10. **Normal night:** PASS in rollback database fixture with three actual deterministic-engine actions and a GM-edited result. Fixture uses Night 0 → Day 1; the separate controller test checks Night 2 → Day 3.
11. **Empty night:** PASS through proposal, validation, finalization, and advancement without invented actions.
12. **Death commit:** PASS; live fixture state unchanged before finalization, death committed after it, duplicate replay does not reapply events.
13. **Conversion commit:** PASS; GM-edited faction unchanged before finalization, committed afterward.
14. **Double finalization:** PASS; identical idempotency replay preserves version/event counts; different-key stale finalization is rejected. Ordinary action addition/removal after finalization is rejected.
15. **Rollback:** PASS; an intentionally invalid mode change fails late in the transaction and leaves no partial document version, finalization, status, or history commit.
16. **Multi-GM:** stale-review database checks and frontend pending/version guards PASS. Two simultaneous independent logged-in browser sessions were NOT tested. Database row locking and existing version/idempotency checks provide the concurrency safeguards; sequential stale-request testing is not a substitute for a true concurrent browser test.
17. **Advance:** PASS; unfinalized Night is rejected, finalized Night advances exactly once, the new queue is empty, historical results remain, and stale duplicate advancement is rejected.
18. **Build/tests:** 1,070 tests passed; zero failures/skips. Static build, JavaScript syntax checks, and git whitespace checks passed. No new typecheck tooling or dependencies added.

## Behavioral details

- Finalized review hides ordinary editing/finalization and shows NIGHT FINALIZED, the finalizing GM when available, recorded override reason, and Advance Phase.
- Proposed results are not official phase statistics. Morning Preview becomes Morning Result after finalization.
- Known scheduled effects are not the same as unresolved action outcomes. Override requires a reason, preserves unresolved questions, and still rejects missing/invalid action outcomes.
- Drunk/Sober APPLY effects scheduled until Hanging activate at finalization and survive advancement. Existing structured poison, protection, mode, use, grant, and duration handling is retained; this release does not claim support for every possible prose-defined mechanic or add a Hanging subphase.
- Finalization and advancement make zero AI calls. Optional AI assistance for unknown interactions is off by default during recalculation.
- Existing game refresh reloads tracker state after commit. A native browser confirmation of that refresh remains outstanding.
- Supabase lifecycle migration deployed successfully. No Edge Function change was required. Synthetic database fixtures were rolled back; the live Transformers game was not changed.

## Limitations

Browser automation failed before tab access with a Windows sandbox ACL error. Authenticated UI end-to-end and true two-GM concurrency checks remain unverified. The broader technical audit is not complete. Existing security-advisor findings remain unchanged (43 public security-definer warnings, one leaked-password-protection warning, and two informational no-policy findings).
