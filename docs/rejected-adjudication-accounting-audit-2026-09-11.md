# Accounting warnings on rejected adjudications

## Finding and repair

The actual Resolve Night handler retained only accepted high/medium-confidence executable adjudications. A rejected or low-confidence response could still report that its paid usage failed to save, but that warning was discarded before saving the proposal. The existing warning renderer therefore never received it.

Frontend 12.2.54 preserves responses with a nonempty string accounting_warning as well as accepted responses. Existing engine eligibility checks still reject low-confidence, unresolved and review-required effects. The existing renderer displays its fixed safe accounting notice, not raw provider diagnostics. Engine 1.2.21 is unchanged.

## Evidence

Four new tests execute the actual Resolve Night handler with mocked Edge responses, then the actual warning renderer. Three failed before the fix and all four pass after it; combined with existing warning-rendering tests, nine pass. The unresolved ruling stays review-required, no deaths are applied, one mocked provider call occurs, and the saved proposal retains the warning. Ordinary rejection without a warning retains existing behavior.

Full suite: 842 passes, zero failures and zero skips, including the supplied Transformers DOCX. JavaScript syntax, static-build and diff checks passed. No paid AI, account, database, Edge Function, Storage or live-game changes were needed.

This repairs warning retention, not durable usage accounting or provider spending limits. Warnings already discarded from historic proposals are not recoverable by this change.

## Browser audit boundary

A renewed browser availability check after the desktop runtime update still failed before returning tab state: the node_repl kernel exited during Windows sandbox deny-read ACL setup. No login or live-game interaction occurred. This is an environment limitation, not evidence that application login failed. Native two-GM approval/advance testing remains incomplete; no hidden-session workaround was used.
