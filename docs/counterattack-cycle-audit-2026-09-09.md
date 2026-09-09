# Counterattack cycle and generated identity audit — September 9, 2026

## Result

Fixed in frontend 12.2.46 / existing canonical engine 1.2.14. The full technical audit remains **incomplete**.

A synthetic two-player night reproduced a defect: mutual Counterattack generated 18 child effects with repeated truncated IDs, then reported RESOLVED without a review question. Its apparent termination depended on action-ID length, not a game rule. Long root IDs could also collide with their own generated child, and a child ID could collide with an independent submitted action.

## Repair

The existing kill stage now tracks directed retaliation edges per generated causal branch. Before repeating an edge, it stops expansion and adds a named GM-review question and trace entry. Existing executed outcomes remain provisional; this is not a new once-per-night rule or a declaration of the final winner. Independent submitted attacks keep separate lineages and can each trigger retaliation.

Ordinary short child IDs retain their existing format. Overlong or already-used IDs receive a bounded, deterministic, collision-checked fallback. Original parent IDs remain attached.

Cycle warnings use the existing saved review gate, not the unknown-ability AI fallback. Cancelling the submitted root and recalculating removes dependent effects and the warning. No second resolution engine, schema change, AI call, production game simulation or live game edit was introduced.

## Evidence

Ten runtime regressions in tests/counterattack-cycle.test.mjs; six failed before the fix:

- Mutual retaliation and immunity-protected cycles require review.
- Normal one-way retaliation and separate submitted attacks retain their effects.
- Separate mutual chains are independently reviewed.
- Long parent IDs and existing submitted-ID collisions produce unique child IDs.
- Cancellation removes the dependent chain; replay preserves its identities.
- The review warning survives editor normalization and prevents complete tracker approval.

Full suite: **728 passed, zero failed, zero skipped**, with the supplied Transformers DOCX available. This is synthetic runtime and editor/review integration evidence, not a new authenticated browser or production-approval test.

## Boundaries

The GM must supply a stopping ruling for cyclic custom interactions. No arbitrary retaliation cap is presented as a game rule. The pre-existing 500-item kill work guard is unchanged; remaining unprocessed actions continue to require review. General custom passive rewards, executable rule precedence, complete cost accounting and native multi-GM browser coverage remain separate open audit work.

