# Submitted passive accounting — September 9, 2026

Frontend 12.2.43, canonical engine 1.2.11. No database migration or Edge Function deployment. Full technical audit remains **INCOMPLETE**.

## Reproduced defect

The canonical engine used only the ordered active half of the existing classifier's output. A legacy/imported submitted action classified as passive disappeared from action results, submitted counts and analyzed IDs. A night containing only such a record could be reported as resolved with zero actions. Eight initial isolated regressions reproduced this across standard and locally defined passive records.

## Repair

The engine retains both classifier outputs for submitted-action accounting, without changing the shared classifier or introducing a new resolver. A passive-labelled submission receives one visible INELIGIBLE_EFFECT result explaining that it is not an ordinary active action. It spends no ability use and adds a GM-review question; normal automatic passive processing remains separate.

These known submission errors are not unknown mechanics and are not sent to AI. A supplied AI adjudication cannot silently turn a queued passive into a kill. The GM may cancel an erroneous submission or explicitly reclassify a mislabelled active ability after reviewing its source. Cancellation retains the record and clears this review reason. Later inaccessible-mode checks no longer overwrite already resolved/canceled records or emit duplicate results.

## Verification

- **685 JavaScript tests passed, zero failures/skips**, including extraction of the supplied Transformers DOCX.
- Thirteen new regressions cover Reflection, Counterattack, Death Immunity, Bulletproof, local passive metadata, mixed valid/invalid submissions, editor payload preservation, cancellation, real automatic trigger deduplication, inaccessible modes, explicit GM reclassification, rejection of passive-to-active AI reinterpretation and tracker approval gating.
- The actual Resolve Night frontend handler ran with the real engine and mocked UI/persistence boundaries. It saved the visible invalid submission and review state without calling AI. This is runtime integration evidence, not a native-browser or production approval transaction.
- Existing active-action and automatic-passive regressions remained green. JavaScript syntax scripts, static build and diff validation passed. The changed app-to-engine cache chain was versioned; unchanged cloud/modules were preserved.

## Limits and safety

Normal submission controls should already exclude automatic passives; this repair protects imported/legacy or otherwise invalid snapshots instead of silently losing their history. It does not implement all custom optional-passive triggers, conditional mechanics or prose-rule execution. Those still require explicit supported semantics or GM review.

No live game was loaded for simulation, restarted or edited. No users, Storage objects, production fixtures or paid AI requests were created. Remaining full-audit work includes custom rule/precedent execution, passive rewards/on-death dependencies, complete cost accounting and native multi-GM browser flows.
