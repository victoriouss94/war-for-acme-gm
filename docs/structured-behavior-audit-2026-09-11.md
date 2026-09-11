# Structured behavior and runtime Capture audit

## Reproduced defects

Heal ignored explicit statusTypes subsets and still removed other standard statuses. Ability Amplify ignored explicit upgrades mappings and used its fixed upgrade. Runtime Capture, which has no global encyclopedia standard, could ignore a conflicting effect, status type or capture window. Isolated Capture adjudication had the same compatibility gap.

The fifteen synthetic tests were added during the interrupted September 10 audit: twelve failed and three controls passed. The interrupted implementation did not reach the source file. September 11 continuation verified that state before applying the repair.

## Repair

Frontend 12.2.53 / engine 1.2.21 extends the existing compatibility guard. statusTypes is checked as a string set, allowing equivalent reordering; upgrades is checked as the exact existing flat mapping. Malformed or differing explicit values require review instead of being silently ignored. Runtime Capture has a shared validation contract for its existing current-night behavior; its runtime classification is retained, not inserted into the global encyclopedia. Both ordinary normalization and isolated adjudication validate against it. Review messages name Capture rather than an undefined standard.

No custom rules were invented or compiled. Matching Heal/Amplify/Capture behavior still executes; unsupported variants use the existing GM-review path. Existing nullable adjudication-field filtering and missing-field fallback semantics are unchanged.

## Verification and limits

All fifteen new tests pass. Full suite: 838 passes, zero failures and zero skips, including the supplied Transformers DOCX. JavaScript syntax, static-build and diff checks passed. No live game was read or changed; no database, Edge Function, account, Storage or paid-provider changes were needed.

This is not complete validation of unknown fields or arbitrary custom rules/passive rewards. Rule-priority execution, durable AI accounting, and authenticated concurrent-GM workflows remain open audit items. Historical proposals are not retroactively recalculated.
