# Tracker recalculation and manual review workflow

Frontend 12.2.63; canonical engine unchanged at 1.2.26. Full audit **INCOMPLETE**.

## Reproduced problems

1. The tracker-side Recalculate button called `recalculateEditedNight`, which does not exist. The separate form button used the correct existing handler. Executing the real tracker binding reproduced a ReferenceError.
2. Changing only the standardized ability type did not enter the existing difference list, so recalculation silently kept the old classification.
3. Direct player-outcome edits were recorded as correction metadata but were not executable recalculation inputs. Recalculation saved the engine's old consequences over the proposed manual change.
4. Earlier review reports tested draft/payload support, but the actual form had no controls to change final review status or resolve its questions. It also lacked input/change handling to refresh the disabled approval button after corrections. This report corrects that earlier UI assumption.

## Repairs to existing paths

The tracker button now calls the same canonical handler as the form button. The existing difference collector records standardized-type changes, and the existing GM-classification adapter performs the recalculation. A real handler test cancels an attack, removes both its death and generated Counterattack death, updates Watch to no visitors, and saves one proposal with the existing session ID/lock version. It makes no AI call and does not mutate the input session.

Recalculation now stops before saving when non-action sections were manually changed. A specific message identifies those sections and preserves the editor. The GM can correct the causative action or finalize the reviewed manual ruling. This is a repair for silent edit loss, **not** automatic support for arbitrary manual player/passive/status/grant dependency overrides. Action-level fields beyond the existing correction adapter still need further coverage.

The existing form now exposes final review status and remaining questions. It loads and captures those fields, and their changes enter the existing correction history. Removing a question is an explicit GM edit; the source ruling and consequences must be recorded. Input/change events update approval availability without rebuilding the form or saving/applying anything.

The shared validator has an opt-in `forApproval` check. Form display, input validation and final submission use it, so an unresolved review cannot become approvable merely because its draft is structurally valid. Ordinary draft validation remains available for saving review-required proposals. Existing role permission, finalized-session, confirmation, server authorization and transaction checks remain in place.

## Verification and limits

Seven new tests failed before their corresponding repairs and now pass. They execute actual tracker event binding, recalculation, form load/capture, approval-state handler, and shared editor validation with isolated DOM/service stubs. They cover finalized/rejected guards, owner permission loss, unchanged source, review persistence, explicit decisions and no automatic application.

Full suite: **967 passed, zero failed/skipped**, including supplied Transformers DOCX. Syntax, static build and diff checks pass. The app loads the updated resolution editor with a new cache tag; unchanged classifier modules retain their verified tags.

No Supabase schema/Edge deployment, production test rows, live-game mutation or paid provider call was needed. Native browser visuals, uninterrupted two-GM workflow, general custom/on-death causality and accounting durability/concurrency remain unverified or incomplete.
