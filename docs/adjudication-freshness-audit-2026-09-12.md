# Saved custom adjudication freshness

Frontend 12.2.61; existing canonical night engine 1.2.25. The full audit remains **INCOMPLETE**.

## Reproduced defect

The prior authority repair protected currently executable standard/source rules, but an action that remained CUSTOM could reuse an older AI mapping by action ID alone. Changing its source text, target, game rule, actor mode, another queued action, phase or game still applied the old lethal interpretation. GM target recalculation also reused it. Existing answers without context evidence were indistinguishable from current ones.

Nine new safety regressions reproduced unsafe reuse before this repair; two additional new signature/persistence contract tests also failed. All eleven pass after the fix.

## Existing implementation repaired

- The existing engine fingerprints its immutable normalized snapshot, including the entire submitted queue, and its engine version. It excludes capture time so otherwise unchanged replay is stable.
- Each isolated unknown-interaction request carries that compact signature. The actual Resolve Night handler binds the returned answer to the signature of the request it made and saves it in the existing adjudication JSON. No full additional snapshot is sent to AI.
- Execution requires both a matching signature and the exact interaction ID, in addition to existing status/confidence/behavior checks. The earlier standard/source authority guard remains in force.
- Missing or stale evidence leaves the custom effect unapplied, with a trace explanation and the existing GM-review result. Previously saved answers and their accounting warnings are retained, not deleted. Finalized history is not rewritten.
- Recalculation after an action/rule edit invalidates affected-context interpretations and does not itself make a new paid request. An explicit Resolve Night operation can request a fresh isolated answer. An unchanged saved session reuses its answer without another AI call.

The signature uses the engine's existing non-cryptographic hash as a cache-freshness check, **not** authorization, tamper-proof attestation or a claim that AI understood the rule. It deliberately covers the whole snapshot/queue conservatively: even another participant's context change may require renewed review. Engine upgrades invalidate old signatures. Legacy answers without signatures require fresh review when recalculated, but no stored live game is migrated or modified.

## Verification

The new tests execute the canonical engine and actual Resolve Night handler with isolated service stubs. They cover the seven context changes above, legacy answers, unchanged JSON replay, no input mutation, GM target correction, and saving/reusing a freshly bound response. Existing isolated-adjudication behavior tests now supply matching context evidence so they still test effect compatibility, normal blocking, successful custom mapping and unsupported behavior—not merely freshness rejection.

Full JavaScript suite: **949 passed, zero failed/skipped**, including the supplied Transformers DOCX. Syntax/static build checks pass. No database schema, Edge Function, model, quota, account or live-game changes were needed; no paid provider request was made.

Remaining: generic custom/on-death causal execution, durable accounting/concurrent budget behavior, and uninterrupted current two-GM browser workflow verification. A current signature does not turn an unsupported custom mechanic into a deterministic implementation.
