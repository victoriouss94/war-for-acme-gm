# Complex night audit — September 8, 2026

## Scope and defects

The existing canonical resolveNightDeterministically engine was tested with an independently specified 40-player, 35-action synthetic night. No live game was simulated or changed.

Three of four initial focused tests failed: blocked, cancelled and inaccessible-mode actions were counted as visits by raw target scans. Watch/Track reported nonexistent visits, and Omega Kill killed a blocked visitor. The existing engine now shares a pure block-reason check between execution and visit eligibility. Execution-start tracking retains real completed visits when an actor is disabled later. Intel and Omega share that predicate.

Actual engine → editor → tracker tests also reproduced two display defects: an explicitly removed role reverted to the original role, and a blocked kill's target appeared as attacked-but-survived. Nullish role fallback now preserves explicit removal, and blocked/cancelled/ineligible/pending attempts are excluded from that summary.

## Exact large-night outcome

40 alive → 32 alive. Dead IDs: p8, p12, p15, p17, p20, p26, p39, p40.

| Interaction | Verified consequence |
| --- | --- |
| Block + Guarantee + Protect + PIK | p1 executes; p4 survives protection |
| Place Swap + Ask + PIK | p7 destinations become p8; p8 dies |
| Redirect + Guard + PIK | p10 → p11 → guarding p12; p12 dies |
| Reflection + Mark | p14 safe; reflected Mark applies to p13 |
| Super Protect + Super Kill + Omega | p16 survives; unprotected visitors p15 and p17 die |
| Poison + Heal | p18 Poison removed |
| Convert + PIK | p20 becomes Den, loses role, dies |
| PIK + Save | p22 survives |
| Death Immunity + Super Kill | p24 survives |
| PIK + Counterattack + Bulletproof | p26 dies; p25 survives retaliation |
| Current-mode immunity + Den Kill | p28 survives |
| Control + PIK | Stored roll chooses Protect, saving p30 |
| Steal + Additional Uses | Original p32 grant 3→2; p31 gains1 use; p32 separately gains2 |
| Blocked granted PIK | p32 cannot attack p38 and consumes no use |
| Amplify + Protect + PIK | PIK becomes Super Kill; p39 dies |
| Satisfied Mark | One child kill; p40 dies |

The source encyclopedia explicitly says Super Protect stops Omega on its primary target; visitors are individually evaluated. The initial test expectation that p16 would die was corrected from that definition. No change was made to the engine's existing Super Protect behavior.

The result has exactly35 original action rows, three generated effects, and zero AI adjudications. JSON replay preserves random/player outcomes. GM correction of the p26 attack to FAILURE removes p26's death and the dependent Counterattack without rerolling Control. Input players, roles and grant counts remain unchanged.

## Verification and limitations

Five large-night tests and seven visit tests pass, including pending blocked KILLS during INTEL, guaranteed visitation, completed Protect followed by Capture, and failed target defense remaining a real visit. All488 tests pass, zero skipped, with the supplied Transformers DOCX; syntax/static build/diff checks pass. Engine1.2.1/frontend12.2.24. No database migration or Edge change is required.

The original large-fixture check was application-function integration, not a browser/approval roundtrip. Its generated-attack survivor omission is repaired below. Full large-fixture persistence, approval/advance, browser rendering, later-stage Intel dependency handling and the broader audit remain incomplete.

## Generated lethal attempt projection — frontend 12.2.25 / engine 1.2.2

The engine listed seven attack survivors but the tracker listed six: it inferred attacks only from submitted KILLS rows and omitted p25, who survived a generated Counterattack. The existing engine now emits an ID-based lethal_attempts ledger from actual KILL_ATTEMPTED events. Entries retain exact target, actor, child/parent/root action IDs, generation flag and kill/protection tiers. This also describes secondary targets without relying on display names.

The editor preserves that ledger through final payload creation. The tracker uses it when present and excludes attempts rooted in blocked, cancelled, ineligible or pending actions. An explicit empty ledger is authoritative. Legacy saved rulings without the field retain their existing inference fallback; they must be recalculated to obtain complete generated-attack coverage. No live historical ruling was rewritten.

Eight focused tests pass, including seven exact survivor IDs, generated lineage, cancellation/recalculation, payload roundtrip, explicit empty data, duplicate player names, legacy fallback and an actual engine-generated cloud fixture. Full suite: 496 passed, zero skipped, using the supplied Transformers DOCX.

An isolated two-player fixture exercised authenticated public create/start/queue/start-resolution/save/approve/readback/advance calls inside BEGIN/ROLLBACK. Both proposal and finalized ruling retained the exact ledger, no death occurred before approval, the Counterattack target survived Bulletproof and the original target died. The actual returned final_resolution was passed back through buildTrackerResolutionReview and correctly displayed the surviving attacker. The first fixture lacked passive encyclopedia entries and was correctly rejected by existing approval validation; adding those entries allowed approval without a warning override.

Fixture e8279aff-d373-4c9f-acc6-59bdc0b83edf was verified absent after rollback. Live Transformers remains Night 1/version 192 with 44 alive. No database migration, Edge deployment, paid AI request or live-game mutation was needed. This verifies authenticated database functions and application projection, not native browser approval interaction or the full 40-player cloud workflow.
