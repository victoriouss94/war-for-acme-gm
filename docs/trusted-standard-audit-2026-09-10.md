# Trusted standard dispatch boundary audit

## Reproduction

Imported or action-level engineBehavior could contain a nested standard object. behaviorFor spread that metadata after its locally classified standard, allowing the nested object to replace the handler identity after compatibility validation.

Synthetic reproductions changed Basic Ask into exact-role intel, Protect into Poison, and Personal Instant Kill into an attack with Omega visitor collateral. This was data-driven handler shadowing, not arbitrary JavaScript execution or evidence of an authentication bypass.

## Repair and verification

Frontend 12.2.51 / canonical engine 1.2.19 assigns the locally classified standard after spreading behavior metadata. Reserved nested standard data can no longer choose the handler. Explicit effect/field compatibility safeguards and normal classification remain intact. The isolated-adjudication path already assigned its classified standard last and did not need this change.

Seven tests in tests/trusted-standard-dispatch.test.mjs cover ability, action, understanding and snake-case metadata, status substitution, visitor collateral, and ordinary explicit behavior. Before the repair, the corrected suite had six failures and one passing control; after repair, all seven pass. Source objects remain unchanged.

Full suite: 810 passes, zero failures, zero skips, including the supplied Transformers DOCX. JavaScript syntax/static-build/diff checks passed. No live game, accounts, database, Edge Functions, Storage, or paid AI calls were changed or used.

This does not complete arbitrary custom-rule execution, passive rewards, cost accounting, or authenticated browser/concurrent-GM verification. Historical proposals are not retroactively modified.
