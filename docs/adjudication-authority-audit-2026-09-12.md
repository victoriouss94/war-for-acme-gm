# Saved AI adjudication authority — runtime repair

Release: frontend 12.2.57 / canonical engine 1.2.24. Full technical audit: **INCOMPLETE**.

## Reproduction

The existing resolver reapplied saved AI adjudications to any matching action ID, even when the current snapshot already supplied executable standard or role behavior. Four synthetic cases failed before the fix: Basic Ask became a kill; a kill became Mark; Protect became Poison; an explicit role kill was replaced by Intel. The unresolved-custom-action control passed.

This was a runtime priority defect, not just incorrect priority labels. Saved sessions pass their `ai_adjudications` back through the actual Resolve Night handler, so an old interpretation could overrule subsequently executable source data.

## Existing implementation repaired

The adjudication loop now accepts an AI interpretation only when the current action is unclassified or has a CUSTOM primitive. A currently executable source rule or standard keeps its existing handler, strength, category and targets. Ignored saved answers are explained in the resolution trace and are not counted as applied AI adjudications.

No saved answer or source record is deleted. Genuinely unresolved custom interactions still use the existing isolated adjudication path, with its existing behavior-compatibility checks. Explicit GM reclassification remains separate and retains its earlier precedence.

## Verification

- Six focused tests pass: three standard conflicts, explicit role kill strength versus protection, an unresolved-custom control, and the actual frontend saved-session Resolve Night path.
- The frontend test verifies that the source result is saved with the original session/version, without another AI call or mutation of the input session.
- Two earlier behavior-compatibility tests now declare CUSTOM source effects, accurately exercising the isolated-unknown path they were intended to test. Their assertions still reject conflicting Poison/Capture behavior.
- Full suite: 885 passing tests, zero failures/skips, including the supplied Transformers DOCX. JavaScript syntax/static-build/diff checks accompany release verification.

All cases use local synthetic data and mocked persistence. No production game, account, database, Edge Function or provider request was changed by testing.

## Remaining limits

This enforces executable source/standard rules above saved AI answers. It does not compile arbitrary game-rule prose or implement generic precedent execution. Snapshot freshness for answers that remain CUSTOM, arbitrary passive rewards and predicates, durable AI accounting and full native two-GM browser verification remain open. It does not certify the entire priority matrix or audit.
