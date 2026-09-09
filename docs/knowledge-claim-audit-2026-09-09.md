# Knowledge ingestion worker claims — September 9, 2026

Backend repair: gm-knowledge-ingest v5; migration `20260909180259_claim_knowledge_ingestion_once`. Browser frontend remains 12.2.40, canonical engine 1.2.9. Full technical audit is **INCOMPLETE**.

## Reproduced defect

Two requests could read the same PROCESSING version and both download the document, call the structured-output provider and request embeddings. Only the final persistence step locked the version. A characterization of the actual deployed v4 entrypoint reproduced two provider/embedding calls, one successful response and one save-error response, both within one handler and across independently initialized handlers. External services were mocked; no real API charges were incurred.

## Repair

The existing endpoint now claims a document version atomically before downloading or calling a provider. A small private, RLS-enabled claim table uses the version ID as its unique key; short version-row locks serialize claim acquisition. A duplicate request receives a clear conflict response without paid work or failure recording. Returned errors, malformed responses and uncertain transport failures stop before paid work rather than retrying a potentially acquired claim.

Completion and failure RPCs verify both the claim identity and its owning GM. A stale or legacy caller cannot overwrite a claimed attempt. A late failure cannot downgrade an already completed document. Existing unclaimed pre-deployment workers retain compatibility. Three new public service-only bridges delegate to private implementations with empty search paths; no authenticated or anonymous execution grant was added. No broad private-schema access was granted.

Claims intentionally do not expire or automatically replay provider work. If a worker is interrupted, the message tells the GM to check the library and upload a new version if processing was interrupted. This is a conservative single-attempt-per-version protocol, **not** an exactly-once provider guarantee, a durable resume system, a billing ledger, or automatic crash recovery. Existing processing was empty before rollout. Separate newly uploaded versions can still incur separate indexing charges.

## Verification and limits

- **651 tests passed, zero failed, zero skipped**, including the supplied Transformers DOCX. Seven new runtime tests cover shared/independent handlers, one paid path, duplicate rejection, returned/thrown/malformed claim results, interrupted claims, and claim-bound failure recording. Existing lifecycle and embedding suites retain coverage through the new RPC names.
- Candidate and deployed SQL passed rollback-only tests for exclusive acquisition, same-token replay rejection, current GM authorization, stale/legacy fencing, one completion, late-failure safety, independent versions, failed-version rejection, compatibility, service-only function ACLs and private-table access restrictions.
- Synthetic document metadata was seeded only inside rolled-back transactions; no Storage bytes or accounts were created. Cleanup queries found zero fixture games/versions/claims.
- A proposed extra two-connection production test requiring committed temporary metadata was rejected by automatic safety review before execution. It was not bypassed. Real simultaneous database-connection behavior remains unmeasured; concurrency evidence consists of independent handler tests with an atomic-claim stub, actual sequential database claim/locking tests, and the unique-key/row-lock implementation. No persistent fixture was created.
- Deployed entrypoint readback matches the tested source exactly; its existing older shared runtime was preserved byte-for-byte. JWT verification remains enabled. All 15 real negative-authentication/origin/preflight checks across the three existing Edge Functions passed.
- Security advisors retain the existing 43 authenticated-definer warnings and disabled leaked-password warning. The additional no-policy INFO identifies the intentionally inaccessible private claim table; it has RLS, no client/service direct table privileges, and no access policies. See [advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). No exposed writable table was introduced.

The [Supabase function guidance](https://supabase.com/docs/guides/database/functions) and least-privilege skill informed the service-only bridges and fixed search paths. No AI model, price, budget, prompt, live game, role or phase was changed. Browser upload/resume and complete provider accounting remain outside this repair. Continue from the [coverage index](AUDIT_COVERAGE_2026-09-08.md).
