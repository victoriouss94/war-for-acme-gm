# Resolution accounting warning display audit

## Reproduced defect

The isolated AI interaction handler already returns `accounting_warning` when its bounded usage-write retries fail. The engine preserves the adjudication, but the resolution screen normalizes the result into a tracker draft that omits this metadata. The screen therefore displayed the ruling without telling the GM that recorded cost totals might be incomplete.

Four tests executing the actual `resolutionOutputHtml` function failed before the repair. The no-warning control passed.

## Repair

Frontend 12.2.34 adds one notice before the existing tracker output. It reads warning-bearing adjudications from the displayed result and saved session/engine proposal, so the warning remains visible after approval even when the approved draft omits engine metadata. Multiple sources produce one notice. Malformed metadata is ignored; provider text and arbitrary markup are never rendered. The notice explicitly discourages rerunning a resolution merely to repair accounting, because another run could incur another charge.

No game outcomes, approval permissions, AI retries, engine rules, costs, database schema or Edge Functions changed. Engine implementation remains 1.2.4 and gm-copilot remains v25. No live-game writes, QA accounts, migrations or paid AI calls were made in this continuation.

## Verification and limits

- Five new runtime renderer tests cover preview, approved-session fallback, engine-proposal fallback, duplicate/untrusted warnings, and known-only/successful/malformed metadata.
- Full suite: 565 passing, zero failing, zero skipped, using the supplied Transformers DOCX.
- Both syntax-check scripts, static build and diff validation pass. The script called typecheck is not full static type analysis.
- Browser control was retried and again exited before returning tab state. Runtime renderer tests are not native-browser evidence; current login, two-GM realtime and approval/advance browser workflows remain incomplete.
- This repair makes failed recording visible. It does not create durable reconciliation or a hard spending cap, and does not certify document-ingestion/embedding accounting.
- Deployment must additionally pass the existing live Pages module checker before publication is reported complete.

The overall technical audit remains incomplete; see the current coverage index.
