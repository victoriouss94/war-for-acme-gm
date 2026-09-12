# Separate embedding cost accounting

Frontend 12.2.60; canonical night engine unchanged at 1.2.24. The full project audit remains **INCOMPLETE**.

## Reproduced and fixed

Knowledge indexing recorded document extraction but omitted its embedding charge. Copilot document search retained private embedding token observations but omitted those charges from the usage ledger and request-cost display. Two new actual-handler regressions failed against the previous implementations while their 64 existing provider tests passed.

The existing shared accounting module now has one embedding operation wrapper. It reserves a separate request ID through the existing authorized RPC before calling the existing embedding adapter. That row records the embedding model and its own pricing snapshot, zero output/cached tokens, observed input tokens, and completed/failed status. It does not add embedding tokens to the response-model token fields. Both existing handlers use this wrapper; there is no replacement provider service, table, RPC or schema migration.

Estimates use USD per million input tokens: small 0.02, large 0.13, ada-002 0.10, checked against the official model pages. Unknown model names stop before an embedding call instead of receiving response-model prices. No model configuration was changed. [Small](https://developers.openai.com/api/docs/models/text-embedding-3-small), [large](https://developers.openai.com/api/docs/models/text-embedding-3-large), [ada-002](https://developers.openai.com/api/docs/models/text-embedding-ada-002).

The adapter's existing observer captures [embedding usage](https://developers.openai.com/api/reference/ruby/resources/embeddings/methods/create) before HTTP/vector validation. Invalid vectors and later document-save failures therefore retain the appropriate embedding charge. Missing, malformed or unobserved usage remains explicitly unknown: the row uses the schema's zero numeric placeholder with an error marker when appropriate, and a visible warning says the cost total may be incomplete. Zero is not claimed to be a measured free request in that case.

The existing bounded completion retries never repeat provider work. Failed accounting preserves useful vectors/documents/answers and exposes a warning. Ingestion forwards it through the existing uploader notice. Copilot records it in the answer warnings, keeps the private trace out of the model input, and reports a request cost with separate responseCost and embeddingCost components. Ordinary retrieval/vector failures retain the previous fallback behavior; a denied/unconfirmed embedding reservation or unpriced model stops subsequent paid response work.

## Budget behavior

Embedding calls now have their own real reservation, so they count toward the existing game request-per-minute limit as well as its recorded monthly costs. A document-search or indexing operation that uses one response call plus one embedding call normally creates two records. No configured limit value was raised or removed. A denied embedding reservation after extraction retains the already-incurred extraction usage and fails indexing safely.

This is still **not a hard in-flight dollar cap**: an unfinished response reservation can have unrecorded charges, and concurrent work can exceed the threshold before completions arrive. No historical embedding charges were fabricated or backfilled. Unknown usage and failed completion writes still require reconciliation.

## Verification

- Full JavaScript suite: **938 passed, zero failed/skipped**, including the supplied Transformers DOCX; syntax, static build and diff checks pass.
- Added shared-wrapper tests cover supported/unknown prices, six reservation failure forms, known/unknown/invalid counts, failure accounting, and three write retries without repeating the provider call.
- Actual ingester tests cover separate model rows, embedding-budget denial after paid extraction, invalid vectors and document-save failure. Actual Copilot tests cover separate token fields/costs, success/HTTP/vector/network failures, usage privacy, denied second reservations, no later paid response, and combined request cost.
- Existing response-accounting assertions are now scoped to their own request ID, so a separately completed embedding row cannot masquerade as response usage or alter its retry count. Existing single-worker document claims remain tested.

Production gm-copilot v30 and gm-knowledge-ingest v8 are ACTIVE with JWT verification retained. Their exact seven-file/four-file bundles match tested source after line-ending normalization, and unauthenticated HTTP returns 401. Only entrypoints and the shared accounting module changed; provider adapter/parser and other dependencies were preserved. Word importer v11 was not redeployed because its existing response-accounting implementation is unchanged.

No live game, account, uploaded file or production test ledger row was modified; no paid provider smoke call was made. These isolated-handler and deployment checks do not establish a complete authenticated browser workflow.

## Remaining

Durable accounting/reconciliation, hard concurrent spending reservations, pre-game totals in a user-facing summary, unsupported custom rules/passive causality, saved-AI freshness and current native two-GM end-to-end verification remain open.
