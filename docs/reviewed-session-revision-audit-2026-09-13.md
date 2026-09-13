# Reviewed session revision audit — September 13, 2026

## Reproduced defect

The resolution form was keyed only by session ID. Refreshing the same session could update its lock_version while leaving the old editor intact. Finalization then sent that newer version with the stale draft, so the request did not identify the revision the GM had actually reviewed.

Actual form-fill/capture/finalize tests reproduced stale MODIFY and REJECT requests reaching the persistence boundary. A separate confirmation-time mutation showed the submitted expected version could change from 4 to 5 after review.

## Existing workflow repair

The form now records its loaded session revision independently. Finalization requires a matching session ID and valid matching revision, captures that expected revision before confirmation, and sends that fixed value to the existing RPC. It does not adopt a later version merely because the background session list refreshed.

Resolve and Recalculate also stop when the current editor is stale. The resolution panel shows a concurrency notice and disables its workflow buttons; subsequent input cannot re-enable stale approval. The draft is preserved for the GM to copy before explicitly reopening the session. Reopening loads the new revision for review.

No RPC signature, database locking, permissions, automatic merge or second state store was added. The server's existing version check remains authoritative for a race after the client check.

## Verification and limits

Twelve new cases cover stale approval/rejection, reviewed-version capture, current and explicitly reopened forms, missing/invalid revision, disabled approval after input, and stale Resolve/Recalculate. Three behavioral failures were reproduced before the fix after correcting the test harness's missing role lookup stub; fixture setup failures are not counted as application defects.

Tests execute actual form fill/capture, finalization and workflow handlers with real draft/difference/final-payload helpers. Network persistence, confirmation, rendering refresh and legacy manual-payload validation are mocked. They prove which expected revision is sent or rejected locally, not a fresh two-GM browser session or a database transaction race.

Full JavaScript suite: **1,064 passed, zero failed, zero skipped**, including the supplied Transformers DOCX. Frontend **12.2.70**, canonical engine **1.2.26**, backend functions unchanged. No live game, account, Storage, database schema or ledger row was changed; no paid AI request occurred.

Native end-to-end/two-GM realtime testing, durable draft recovery/merge, custom on-death execution and accounting durability remain open. The complete audit remains **INCOMPLETE**. See the [coverage index](AUDIT_COVERAGE_2026-09-08.md).
