# Missing AI usage reservation detection

## Defect and repair

The service-only complete_ai_usage_internal RPC previously returned success when its request ID matched no ledger row. The copilot treated any successful RPC response as recorded accounting, so a missing reservation could silently suppress its existing incomplete-accounting warning.

Migration 20260911023629_require_existing_ai_usage_record locks the matching reservation in the short accounting transaction and raises AI_USAGE_EVENT_NOT_FOUND (SQLSTATE P0002) if it does not exist. The void return contract, existing privileges, empty search path, completed-row idempotency and preservation of known failed-request charges remain unchanged. No ledger row is invented, historical costs are not rewritten, and no external call happens while the row lock is held.

## Verification

- The new local-only SQL fixture reproduced the previous silent success for a nonexistent request ID in PGlite 0.5.8 PostgreSQL.
- The repaired function passed missing-ID and null-ID rejection, completed-row retry preservation, failed-charge recovery and authenticated-client denial. The fixture rolled back all synthetic rows. Production fixture data was not created.
- Two actual-copilot handler tests confirm that the missing-record error produces the existing accounting warning for both isolated adjudication and ordinary answers, while retaining the useful result and making only one paid-request mock. The fixture uses the documented P0-class HTTP 500 mapping and exhausts the existing three bounded accounting writes, not three provider calls. These test the expected RPC error response; they are not a fresh authenticated HTTP integration test. See [PostgREST error mapping](https://docs.postgrest.org/en/v14/references/errors.html).
- Full JavaScript regression suite: **857 passed, zero failures, zero skips**, including the supplied Transformers DOCX. No paid provider calls.
- The production migration was applied and its definition and execute privileges verified. A service-role call with a null request ID confirmed P0002 without reading or changing any live game or ledger row. Anonymous and authenticated clients remain unable to execute the function.
- Security advisors remain at 43 authenticated-definer warnings, one password-protection warning and two no-policy informational findings. No new advisory was introduced.

Only the existing database function changed in production. Copilot v27, document importer v10, knowledge ingester v6, frontend 12.2.54 and engine 1.2.21 remain unchanged. The CLI-created migration was aligned to the actual migration version returned by production.

## Remaining scope

This detects a lost/missing ledger reservation; it does not recover it. Complete import/ingestion/embedding cost coverage, durable reconciliation after process or persistence failure, and in-flight spending reservations remain open. General rule execution and multi-GM browser workflows also remain incompletely audited. The full audit is **INCOMPLETE**.

[Supabase database-function documentation](https://supabase.com/docs/guides/database/functions) informed the unchanged service-only contract and explicit error handling. The existing bounded accounting retry and warning behavior is reused; no new AI request or resolution engine was introduced.
