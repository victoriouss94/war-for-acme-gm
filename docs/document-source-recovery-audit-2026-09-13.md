# Document source recovery audit — September 13, 2026

## Finding and scope

The existing cloud functions `createImportedGame`, `reimportGame`, and `uploadKnowledgeDocument` uploaded a private source, called the registration RPC, then deleted the source on **every** registration exception. If registration committed but its response was lost, that cleanup deleted the file referenced by the saved game/document. A later lookup with no rows would not safely prove rollback either: the original request could still complete.

The knowledge path also swallowed cleanup failures. The import screen described every error as “failed safely,” even when the save outcome was unknown.

## Repair in the existing paths

- Keep exact-object cleanup only for explicitly recognized database rejection codes: 22023, 23502, 23503, 23505, 23514, 42501, P0001, 40001, 40P01, and 57014.
- Treat all other failures conservatively, including fetch/connection errors, gateway timeouts, malformed responses that throw, and SQLSTATE 40003 (statement completion unknown). Retain the uploaded source, preserve the original error metadata/cause, and tell the GM to check Saved Games/the library before retrying.
- Do not automatically retry registration, perform a racy existence probe, or invoke paid ingestion after uncertain registration.
- Surface a cleanup-confirmation warning if removal fails after a definite rejection. Keep the original rejection details.
- The actual import screen now says “Import could not be confirmed” for unknown outcomes, not “failed safely.” Both import previews and the selected knowledge source remain available.
- Successful registrations and subsequent ingestion failures retain their existing behavior and source files.

This is a conservative data-loss repair, not an automatic reconciliation system. An upload can remain orphaned when registration did not commit but its outcome is uncertain. No background deletion was introduced. Successful-but-semantically-malformed registration payloads are not fully schema-validated by this change.

## Evidence

`tests/document-source-recovery.test.mjs` executes the complete existing cloud module with a mock authenticated transport and Storage, plus the actual initial import, reimport, and knowledge-upload app handlers. It does not call production.

The first 24 cases reproduced **14 failures before the repair**, with ten existing-behavior controls already passing. All **25 final tests pass**, including:

- committed registration followed by a thrown lost-response error, for all three paths;
- returned connection/unknown-completion/gateway errors and malformed-response exceptions;
- conservative retention when an uncertain registration did not commit;
- exact new-path cleanup for the rejection allowlist, preserving an unrelated object;
- returned and thrown cleanup failures with visible warnings and original details;
- failed uploads never reaching registration or cleanup;
- successful return contracts and exactly one registration;
- ingestion failure after registration retaining its source;
- actual app error display, preview/file preservation, and released pending controls.

Full suite: **1,007 passing, zero failures, zero skips**, with the supplied Transformers DOCX. JavaScript syntax and static deployment validation pass. This is runtime/transport-mock evidence, **not** newly observed native browser or production lost-response testing.

Release target: frontend **12.2.65**. Canonical engine remains **1.2.26**; no Supabase migration or Edge Function change. Cloud script cache advances to 12.2.65; resolution-editor remains 12.2.64.

## Security and deployment boundaries

Existing authenticated ownership checks, private buckets, RLS, RPC permissions, file naming, and `upsert:false` uploads are unchanged. Cleanup remains limited to the exact newly uploaded path. No secrets or privileged client were added. No live game, account, Storage object, ledger row, or paid AI request was changed to test this repair.

The full audit remains incomplete: uninterrupted browser/two-GM verification, broader custom passive/dependency behavior, and durable accounting/concurrent budget boundaries remain open.

## Documentation checked

The Supabase changelog was checked; the listed recent breaking changes do not change this existing client Storage/RPC flow. Current [Supabase RPC](https://supabase.com/docs/reference/javascript/rpc) and [upload](https://supabase.com/docs/reference/javascript/file-buckets-upload) contracts were retrieved.

The conservative distinction is grounded in [PostgREST transaction behavior](https://postgrest.org/en/stable/references/transactions.html): a database failure rolls back the request transaction, while a successful transaction commits. A missing client response alone is not evidence of database failure. [PostgreSQL error codes](https://www.postgresql.org/docs/current/errcodes-appendix.html) explicitly distinguish 40003 from serialization/deadlock rejection.
