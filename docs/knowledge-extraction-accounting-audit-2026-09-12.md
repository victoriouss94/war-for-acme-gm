# Knowledge extraction usage accounting

Frontend 12.2.58; deterministic engine unchanged at 1.2.24. Full project audit remains **INCOMPLETE**.

## Reproduced and repaired

The deployed knowledge ingester claimed exclusive document processing, but did not reserve or complete an AI usage event. It could perform paid extraction despite a reached game budget and lose reported extraction usage when parsing, embedding or persistence subsequently failed.

Eight new actual-handler tests failed against the exact deployed v6 entrypoint/helper; its nine existing provider-validation tests passed. The repaired implementation passes all 17, plus an actual-uploader accounting-warning test. The full JavaScript suite passes 894 tests with zero failures/skips, including the supplied Transformers DOCX.

The existing single-worker claim is retained. After authorized download and before any provider request, the ingester reserves the existing `knowledge_ingest` usage event. Unconfirmed reservations stop paid work. Available response usage is observed before parsing can fail, then recorded through the existing completion RPC on success or failure. Accounting retries never repeat the provider call. Failed accounting preserves a saved document and returns a warning that the actual uploader displays.

The existing Copilot pricing/usage-completion functions were moved, not duplicated, into `_shared/usage-accounting.js`. Copilot and ingestion now share that implementation. Its estimate policy and bounded write retries are unchanged. No new database, ledger or budget policy was introduced.

## Deployment scope and verification

Both Edge entrypoints matched their deployed baselines before changes. The ingester intentionally adopts the already-tested modern shared AI adapter used by Copilot so its observer runs before validation errors. Authentication, model selection and request defaults are unchanged; optional JSON repair remains disabled for ingestion. Exact-bundle verification is required after deployment. Word-importer deployment is not part of this change.

Production verification: gm-copilot v29 (seven bundle files) and gm-knowledge-ingest v7 (four bundle files) are ACTIVE with JWT verification retained. Every deployed file matched the intended local source after line-ending normalization. Unauthenticated requests to both returned HTTP 401. No database migration, live-game mutation or paid provider smoke request was performed. These checks establish deployment/auth-boundary integrity, not authenticated end-to-end provider success.

Tests cover monthly/rate/reservation denial without paid work, extraction usage on success and parsing/embedding/save failure, same request/response IDs, one provider request, retained single-worker claims, unchanged document statuses, accounting warnings and uploader display. Provider, Auth, Storage and persistence boundaries are mocked; no production game or ledger fixture and no paid provider request is used.

The usage fields follow the [official Responses API usage contract](https://developers.openai.com/api/reference/cli/resources/responses/methods/create). Recorded costs reuse the existing application's estimates, not a new claim of current invoice-accurate pricing.

## Remaining gaps

This records **extraction response-model usage only**. Embedding charges are not included, and the separate pre-game Word importer still lacks ledger wiring. A crash or ambiguous reservation/write can still require reconciliation; this is not a durable provider ledger or hard concurrent dollar cap. Reached-budget denial fails the already-claimed ingestion attempt; after resolving the limit, use a new document version rather than replaying that claimed attempt. Arbitrary rule execution, custom passive rewards and native two-GM workflow verification remain open.
