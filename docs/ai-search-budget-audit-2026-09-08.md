# AI document-search budget gate — September 8, 2026

## Reproduced defect

The actual `gm-copilot` handler performed its document-search embedding request before calling the existing AI usage reservation RPC. Tests with mocked provider endpoints confirmed one embedding request was attempted even when the reservation subsequently reported an exhausted monthly limit, a rate limit, or an accounting-service failure.

A thrown context-preparation error also escaped the handler's final error/accounting block.

## Narrow repair

Moved the existing reservation and denial response ahead of the first paid request, including embeddings. Context assembly now runs inside the same guarded block as generation, so a thrown preparation failure closes the reservation as failed and returns a visible error. Deterministic database-answer paths remain before the reservation.

No new quota policy, prices, model selection, usage schema, or resolution engine was introduced.

## Verification

- Four new baseline failures reproduced: three premature embedding calls and one unhandled context failure.
- Five added actual-handler regressions now pass, including successful embedding retrieval followed by generation.
- All 23 provider-accounting tests pass with provider, authentication and persistence boundaries mocked; **no real provider calls or charges**.
- Full JavaScript suite: **539 passed, zero skipped**, including the real Transformers DOCX.
- Deployed `gm-copilot` version 23; six source files were retrieved and matched the tested bundle. JWT verification remains enabled.
- Real HTTP requests without authorization and with a synthetic invalid bearer token both return 401. These are negative authorization tests, not a fresh authenticated browser session.

## Remaining cost-control gaps

This is not a claim of a hard spending cap or complete cost reconciliation. The existing reservation RPC still checks completed/failed month-to-date estimates, not estimated cost of in-flight work. Initial game imports and official document ingestion still require full accounting/budget coverage; embedding cost attribution and accounting-persistence retries also remain open.

Provider token usage and billing costs are distinct records; actual invoices should be reconciled using the provider's Costs data, as described in the [official OpenAI Usage documentation](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage).
