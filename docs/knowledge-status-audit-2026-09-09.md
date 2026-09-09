# Knowledge ingestion status audit — September 9, 2026

## Confirmed defects

The uploader already offered Active, Approved and Draft. The database completion function saves `status=requested_status`, but the ingestion endpoint always returned ACTIVE, and the uploader always displayed an active-retrieval notice. Consequently a successfully indexed draft or approved reference appeared ready for AI retrieval even though the existing search path uses active versions.

The ingestion catch block also ignored both returned database errors and thrown network failures while recording an unsuccessful ingestion. The user saw the original ingestion error but had no indication that its failure status might not have been saved.

## Existing workflow repaired

- Load and validate the stored requested status before downloading or making paid requests. After successful completion, return that status rather than inventing ACTIVE.
- The existing uploader uses the returned status: Active retains its retrieval notice; Draft and Approved explicitly say they are not active or used for retrieval. An absent/unrecognized status asks the GM to verify the library instead of asserting authority.
- Preserve the original ingestion error and code. If failure recording errors or throws, append a fixed warning to refresh the library before retrying. Private SQL/transport diagnostics are not included. This does not repeat indexing, change authority, or claim a durable failure-reconciliation queue exists.

## Evidence and deployment

Eight new regressions failed before the fix; four controls passed. All twelve now pass through actual Edge and uploader handlers with external boundaries mocked: all three statuses, invalid-status no-provider guard, returned/thrown failure-recording errors, ordinary failure, viewer denial, active/nonactive UI notices and unknown response status.

The full suite passes **625 tests, zero failures, zero skips**, with the supplied Transformers DOCX included. JavaScript syntax lint/typecheck, static build and diff checks pass; typecheck is not full TypeScript analysis. The existing embedding tests were updated to provide the real requested-status field in their synthetic database row.

**gm-knowledge-ingest v4** is ACTIVE with JWT verification enabled. Both deployed files were read back and matched exactly. Only the entrypoint changed; the actual older shared helper (including the previous embedding-validation fix) was preserved byte-for-byte. gm-copilot v26 and gm-document-import v10 were not redeployed. All fifteen live HTTP negative-auth/preflight checks pass; they do not establish a paid, authenticated import end-to-end.

Frontend **12.2.39**, canonical engine still **1.2.8**. Only the uploader behavior changed in browser code. The engine import cache URL follows the app release convention; the engine implementation and other module versions are unchanged. No schema migration, production fixture, paid AI request or live game mutation was needed. Supabase/Postgres instructions guided current function-definition and authorization verification; Sites hosting instructions were consulted while preserving the existing GitHub Pages target.

## Remaining boundaries

This verifies truthful lifecycle reporting, not complete import/embedding cost accounting, exactly-once ingestion, concurrent budget enforcement or recovery after a crashed worker. The status response follows the stored requested status used by the existing atomic completion RPC; it is not a new post-response database read or a guarantee against later GM changes. The failure warning reports uncertainty, not proof the library is still PROCESSING.

Full audit remains **INCOMPLETE**. Browser runtime access, generic passive/on-death/reward and late-intel behavior, rule/precedent execution, shared-runtime compatibility and retired inventory remain in the [current coverage index](AUDIT_COVERAGE_2026-09-08.md). No native browser retry was made in this background pass.
