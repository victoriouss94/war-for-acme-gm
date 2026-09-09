# Late-stage Intel causality — September 9, 2026

Frontend 12.2.42, canonical engine 1.2.10. No database migrations, Edge Function changes, paid AI calls or live game mutations. Full technical audit remains **INCOMPLETE**.

## Reproduced defect

Watch, Track and Action Check rendered cycle-wide results during the INTEL stage, before KILLS. Consequently they omitted Counterattack effects generated later in KILLS and retained a Duel destination that could subsequently change when the winner was chosen. Seven initial regressions failed; ordinary pre-conversion faction Intel and blocked-observer controls passed.

This conflicts with the existing encyclopedia's definitions: Watch reports who visited during the cycle, Track reports destinations, and Action Check reports received actions. It is not a request to move faction or role investigations after conversions.

## Repair in the existing engine

A shared visit-answer calculation now serves the existing INTEL handler and final answer reconciliation. After all stages finish, successful Watch/Track/Action Check answers are finalized using the existing executed-action eligibility and final destinations, including generated effects. Blocked observers receive no answer. Completed visits remain real even if their actor dies or is disabled later.

Reconciliation changes text on the same action and its existing ABILITY_USED event, with a trace explaining the finalized answer. It does not execute another action, spend another use, add a duplicate event, reroll random results or change the canonical stage order. Ordinary faction/role/mode investigations retain their original stage timing. GM recalculation naturally rebuilds these dependent answers from the corrected immutable input.

## Verification

- **672 JavaScript tests passed, zero failures/skips**, including actual Transformers DOCX extraction.
- Fourteen added regressions cover all three late-Intel types, Duel target changes, cancellation removing a generated retaliation, event/morning/editor payload consistency, blocked privacy, pre-conversion faction checks, surviving protection, deduplicated visitors, stable random replay and reflected observation targets.
- The actual frontend Resolve Night handler was executed with the real engine and mocked persistence/UI boundaries. It saved the final answer against the expected session/version, made zero AI calls, cleared its busy flag and left the session snapshot unchanged. This is runtime integration evidence, not a native-browser or real-database approval test.
- Existing visit-eligibility regressions still pass, including completed-before-capture visits, blocked kills, protection failures, Guarantee, canceled attempts and inaccessible modes.
- JavaScript syntax scripts, static build checks and diff validation passed. Only the app-to-engine cache chain changed; unchanged cloud and other module versions were preserved.

## Limits

The fix covers existing standardized cycle-wide visit Intel, not every custom information rule, passive trigger or on-death reward. It preserves existing generated-effect visit semantics and Action Check behavior rather than defining new game rules. Unknown mechanics remain reviewable. Full live-browser approval/advance, durable AI accounting and remaining authority/retired-endpoint work are still open. The live Transformers game was not restarted, simulated or edited.
