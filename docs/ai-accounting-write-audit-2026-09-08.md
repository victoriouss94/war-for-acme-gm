# AI usage-write reliability — September 8, 2026

## Reproduced problem

The existing gm-copilot handler awaited complete_ai_usage_internal but ignored its returned error. A transient database failure therefore left usage unrecorded while the request appeared fully successful. If the same persistence call threw inside the provider-error handler, it also replaced the original useful provider error with an unhandled exception.

Five new actual-handler tests failed before repair. All provider and network boundaries in these tests are mocked; no real paid request was made.

## Repair to the existing path

A small helper in the existing gm-copilot entrypoint now checks the result of the existing usage-completion RPC. It retries transient connection/pool/server failures at most three times, with 100/200 ms backoff, using exactly the same request ID and measured amounts. Permission, validation and other nontransient failures are not retried. It never repeats the Responses request, embeddings, draft creation or usage reservation.

On exhausted retries, useful AI results remain available. Main assistant results include an ordinary visible warning that recorded totals may be incomplete and that the AI request should not be repeated just to fix accounting. Error responses preserve their original code and append the accounting warning. Every affected response includes explicit accounting metadata. An isolated adjudication additionally retains accounting_warning in its returned/stored adjudication; a dedicated native resolution-screen notice for that field is not yet implemented.

Server diagnostics contain request/response identifiers, measured counts, estimated cost, status, attempt count and error code. They do not contain prompts, provider output, passwords, API keys or access tokens. This is reconciliation evidence, not a durable retry queue.

Main-response accounting is attempted before saving the conversation exchange, so an accounting warning is included in that exchange when its existing persistence call succeeds. Existing failures in other run/trace/conversation bookkeeping paths are not all repaired by this change.

No schema, quota, model, price, normal deterministic resolution or approval policy changed. Reported token usage remains distinct from the application's estimated price; see the [official Responses usage fields](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create).

## Verification

- Six new behavioral regressions cover main/adjudication retry success, exact retry payload identity, permanent rejection, exhausted retries, original-provider-error retention and failed-main-validation accounting.
- All 29 provider-accounting tests pass, exercising actual handler code with mocked service boundaries. Paid generation is called exactly once in the new single-response cases.
- Full suite: **545 passed, zero failed/skipped**, including the supplied Transformers DOCX. JavaScript syntax checks, static build and whitespace checks pass.
- The existing production rollback accounting fixture reconfirmed completed-row immutability, repeated failure retention, monthly failed-charge inclusion, rejected reservation atomicity, membership/service-only checks, month boundaries and rate limits. Its temporary game and usage rows were verified absent.
- Deployed gm-copilot **v24 ACTIVE**, with **verify_jwt=true**. All six deployed source files were retrieved and matched the tested bundle; five shared dependencies are unchanged.
- All 15 real HTTP negative-auth/CORS checks passed across the three existing Edge Functions. These do not claim fresh-authenticated provider E2E coverage.

## Remaining limitations

Retries are bounded to the current request. Worker termination, sustained database outages and responses never received from the provider can still leave missing accounting. There is no new durable reconciliation worker or historical backfill. The monthly check still does not reserve maximum in-flight spend, and import/ingestion/embedding accounting and configured-price validation remain separate open work. This is not a hard spending-cap guarantee.

Frontend remains 12.2.30 and canonical engine 1.2.3. The live Transformers game was not changed.
