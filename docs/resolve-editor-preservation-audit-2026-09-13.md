# Protect current GM edits before Resolve — September 13, 2026

## Finding and repair

After the saved-correction replay repair, Resolve still ignored the currently open editor. Unsaved cancellations, survival corrections, manual ruling text and review questions could be replaced by a new engine proposal.

The existing handler now captures only the editor belonging to the selected session and compares it to the saved engine/AI draft using the existing structured difference function. When manual edits are present, it stops before rendering, simulation, AI or persistence and explains that the GM should use Recalculate for supported action corrections or review/finalize the manual ruling. It does not apply, discard or silently save the edits.

An unchanged editor still permits Resolve. An editor belonging to another session is not captured. This complements [saved correction preservation](resolve-again-corrections-audit-2026-09-13.md); it does not create an autosave or a second resolution path.

## Evidence

Four new actual-handler regressions failed before the guard: cancellation, player survival, manual ruling and unresolved questions. Two controls passed. All six now pass, including unchanged editor/session identity and no save on the guarded path.

The tracker workflow file has 32 passing tests. The full JavaScript suite has **1,052 passes, zero failures and zero skips**, including the supplied Transformers DOCX. Tests execute the actual handler with real draft/difference/engine modules and mocked editor capture/save boundaries; they are not a native DOM/browser or two-GM test.

Frontend **12.2.69**; engine **1.2.26** and backend functions unchanged. No live game, account, Storage, ledger or database schema was changed. No paid AI requests.

## Remaining limits

Only the Resolve transition is covered. Switching sessions, refreshing the page and concurrent remote edits still require separate unsaved/stale-editor verification. The guard is not durable draft storage, generic manual-override execution or automatic custom-passive support. The full audit remains **INCOMPLETE**; see the [coverage index](AUDIT_COVERAGE_2026-09-08.md).
