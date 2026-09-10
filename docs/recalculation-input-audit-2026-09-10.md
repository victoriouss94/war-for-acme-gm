# Recalculation input preservation audit

## Reproduced defects

The existing recalculateNight API did not follow the same input precedence as resolveNightDeterministically:

- Added correction.rules were ignored when input.snapshot.rules was present.
- Only the latest correction's rules survived successive recalculations.
- Actions stored only in snapshot.submitted_actions disappeared on recalculation, producing a zero-action proposal.

These are API-level defects. The current UI supplies top-level actions and does not submit correction.rules, so these tests do not establish that the ordinary UI previously lost these inputs. Existing original-game rule interpretation and the complete precedence hierarchy remain separate, open work.

## Repair

Frontend 12.2.49 / engine 1.2.17 retains the existing engine. Recalculation now uses the resolver's nested/flat source precedence, carries cumulative rule_additions alongside action_overrides, and restores rules from legacy correction metadata where available. Explicitly empty top-level actions remain authoritative. Rule additions retain the existing append semantics; the change does not compile prose, invent rule effects, or merge same-ID rules into replacements.

Replays are based on the original immutable source, not a previous proposed-state snapshot. The frontend's persistableNightProposal retains recalculation metadata while omitting the starting snapshot. Earlier corrections already discarded by historical proposals cannot be recovered automatically.

## Validation and limits

Seven new synthetic runtime tests cover nested rule context, flat and nested cumulative replay, legacy rule metadata, snapshot-only actions, explicit empty actions, and input immutability. Before repair: six failures and one passing control (one failure was missing new metadata, not source mutation). After repair: seven passes. Combined with existing engine regression tests: 27 passes.

Full JavaScript suite: 782 passes, zero failures, zero skips, including the supplied Transformers DOCX. Syntax checks and static build validation passed. No live-game, database, account, Storage, Edge, or paid-provider changes were used. This is not authenticated browser or full rule-priority certification.
