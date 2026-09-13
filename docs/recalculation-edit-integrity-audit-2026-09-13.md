# Recalculation edit integrity

Frontend 12.2.64; canonical engine remains 1.2.26. Full audit **INCOMPLETE**.

## Findings and repairs

The prior workflow repair preserved non-action edits, but action-level edits could still be silently replaced by recalculation. Twelve real-handler cases reproduced this for usage disposition, immunity/protection/reflection/redirect flags, affected players, order, timing, cooldown, authority references and a reason-only change. Some fields were missing from the difference collector entirely.

The existing difference collector now includes the remaining captured action metadata plus title, summary and resolution order. After the canonical engine recalculates, the existing handler compares each requested changed field with the resulting draft. If any requested edit was not honored, it does not save the replacement proposal, retains the editor and identifies the unapplied fields. It does not override the engine's result merely to make the requested edit appear successful. The existing manual-review/finalization path remains available.

Two additional adapter bugs were reproduced and fixed:

- GM target changes could be ignored when the queued record contained original/effective-target aliases. The correction now preserves original submitted targets and explicitly updates the effective destination only when the GM actually changed it.
- Reclassifying an action across categories retained the old category. The adapter now derives the selected standard's category through the existing classifier. Changing a kill into Protect therefore runs the protection stage.

A reflection regression found during this repair also demonstrated why an unchanged final target must not be copied back into the submitted target. Changing reflected Mark into Poison now retains the original recipient, actual Reflection event and reflected destination. Untouched targets are left to the canonical transformation pipeline.

## Verification

The tracker workflow test file now has 20 passing tests. Fourteen added cases failed before the first repair; the additional reflection case failed before the conditional-target correction. All pass after the final changes. The actual tracker binding/recalculation handler invokes the real engine and editor modules with isolated save/DOM stubs. Successful target correction preserves its source session, original target and expected final death; incompatible requested fields are not saved. No AI call occurs.

Full suite: **982 passed, zero failed/skipped**, including the supplied Transformers DOCX. JavaScript syntax, static build and diff checks pass.

## Boundaries

This does not implement arbitrary forced immunity/reflection, usage overrides, custom timing or on-death dependency rules inside the deterministic engine. It prevents unsupported requested changes from being silently discarded and fixes the concrete target/classification adapters. Recalculation may refuse a manual override that needs the existing direct GM ruling workflow. Native two-GM browser verification and accounting durability/concurrency remain outstanding.

No database, Edge Function, live-game, account, Storage or paid-provider changes were made.
