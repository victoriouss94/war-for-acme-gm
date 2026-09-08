# Passive event target projection audit — September 8, 2026

## Reproduced defect

The finalized passive result and the official event's target columns identified the right player. However, the event's nested `outcome.original_target_ids` and `outcome.final_target_ids` could identify the triggering action's target instead. The canonical approval wrapper first enriched every event sharing an action ID with the submitted action's metadata. Its later passive-specific enrichment restored the effective targets but omitted the original/final target arrays.

For a Counterattack, this meant the event's target columns pointed to the attacker being retaliated against, while the nested outcome pointed back to the Counterattack owner. An authenticated create/queue/simulate/save/approve rollback fixture failed with `PASSIVE_TARGET_PROJECTION_MISMATCH` before the repair. This was inconsistent official event metadata, not a new lethal-outcome or use-consumption defect.

## Narrow repair

The existing private canonical approval wrapper now also restores those two outcome arrays from the passive result during its existing passive-enrichment step. Its signature, security mode, grants, approval delegates, life-state application and submitted-action validation are unchanged. No new table, engine or endpoint was added. There is no historical-event backfill.

Production migration: `20260908220624_fix_passive_event_target_projection`. It guards the previous function-definition fingerprint before replacement to prevent overwriting an unexpected concurrent implementation. The Supabase CLI was unavailable; the checked-in filename uses the actual applied migration-ledger version returned by Supabase, not a guessed timestamp.

## Verification

- The original projection failed the exact target-consistency assertion; the repaired definition passed in a rolled-back transaction before deployment.
- Both normal Counterattack/Bulletproof and temporary Role Swap fixtures passed strengthened authenticated public-RPC workflows before and after deployment. Independent expected targets match official columns and nested original/final/effective arrays. Passive attempts remain false; exact source role/version, analytics counts, life state and permanent role identity remain correct.
- Repeated approval does not duplicate events or corrupt target arrays. No player dies before approval.
- All five successful disposable fixture games and their session/event rows were verified absent after rollback. The live Transformers game remains Night 1, version 192, 47 players and 44 alive.
- The deployed function was read back and matched the repaired definition. Security advisor counts are unchanged: 43 callable-definer warnings, one leaked-password warning and one RLS-without-policy informational notice. This is not a clean security certificate.
- Full JavaScript suite: **560 passed, zero failed/skipped**, including the supplied Transformers DOCX. Frontend stays **12.2.33**, engine **1.2.4**, gm-copilot **v25**; no Edge deployment was needed.

## Investigation ruled out

A separate suspicion was that isolated AI context omitted the actor because it did not read `sourcePlayerId`. Actual normalized public-queue records from the saved 40-player rollback workflow contain both `actorId` and `sourcePlayerId`. The existing context filter already reads `actorId`. A new actual-handler regression confirms actor/target roles and the exact ability are included, unrelated players/roles/abilities are excluded, and input state is not mutated. No speculative production change was made for that suspicion.

## Limits

This corrects two official passive-event target arrays. It does not establish arbitrary custom passive execution, on-death rewards, every causal field, or full native-browser approval coverage. Other audit work remains open in the current coverage index.
