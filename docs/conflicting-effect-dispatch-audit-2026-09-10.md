# Explicit effect / standard dispatch audit

## Result

Frontend 12.2.48, canonical engine 1.2.16. Fixed a reproduced mismatch in the existing night engine; no replacement engine, database migration, Edge deployment, or live-game changes.

An action could declare an explicit supported effect that disagreed with its mapped standard, yet execute that standard's name-based handler. For example, Personal Instant Kill with an explicit APPLY_PROTECTION effect still produced a lethal outcome. The same defect applied to accepted isolated AI adjudications. Reflection and Watch could also treat the conflicting action as executable.

## Repair

The existing behavior-normalization path now compares a supplied effect with the mapped standard's effect. A mismatch becomes review-only CUSTOM behavior while preserving sourceEffect for a precise review question. The same check applies after isolated adjudication. Existing CUSTOM safeguards prevent execution, usage consumption, Reflection triggers and counted visits. A GM can still explicitly reclassify the action; matching standard effects still execute normally. Source ability records are not rewritten.

This deliberately does not guess a different standard from effect text: several standards share one effect. It is not a generic custom-effect compiler or complete rule-precedence implementation. Same-effect parameter differences, arbitrary conditional passives, and the remaining audit items still need separate coverage.

## Evidence

The new synthetic regression file is tests/conflicting-effect-dispatch.test.mjs. Before the repair: eight failures and two passing controls. After the repair: ten passes, including kill/protect/convert/intel/block conflicts, Reflection, Watch, isolated adjudication, GM reclassification, and matching-effect execution.

Full JavaScript suite: 775 passes, zero failures, zero skips, with the supplied Transformers DOCX. No real players, action queue, game state, accounts, or paid AI requests were modified for testing. Syntax/static-build checks and post-deployment asset verification are separate from authenticated browser workflow proof.
