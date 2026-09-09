# Document embedding response audit — September 9, 2026

## Result

Repaired the existing embedding helper used by document knowledge ingestion and GM document search. A malformed provider response could previously be accepted with duplicate or invalid indexes, extra rows, or nonnumeric vector members. This could associate a document passage with the wrong search vector. This was reproduced with synthetic provider responses; it is not evidence that historical production documents were corrupted.

The helper now requires exactly one response row per input, unique integer indexes covering the input range, and 1,536 finite numeric members per vector. It restores input order only after validation. Valid out-of-order responses and usage metadata remain supported. Invalid responses fail explicitly without activating the document. No additional provider retry, model, pricing, quota, schema, or resolution engine was introduced.

OpenAI documents indexed embedding rows and usage metadata in its [official embeddings reference](https://developers.openai.com/api/reference/ruby/resources/embeddings/methods/create). The vector dimension remains the existing application contract, not a new claim about all embedding models.

## Evidence

- Before the repair: ten new regressions failed; four controls passed. The actual ingestion handler incorrectly returned ACTIVE and called its completion RPC for duplicate indexes.
- After the repair: all fourteen embedding tests pass. The tests execute the actual TypeScript helper and ingestion handler with synthetic auth, Storage, database, and provider boundaries. They verify ordered association, invalid indexes/counts/members/dimensions, preserved provider-credit errors, and failure without the completion RPC.
- The same fourteen tests also pass against a minimally patched copy of the older deployed ingestion helper, not just the repository helper.
- Full suite: **599 passing, zero failures, zero skipped**, including extraction from the supplied Transformers DOCX. JavaScript syntax checks, static build verification and diff checks pass. The script named typecheck is not full TypeScript analysis.
- Production: **gm-copilot v26** and **gm-knowledge-ingest v3**, ACTIVE with JWT verification enabled. All six and two deployed files, respectively, were read back and matched the intended bundles exactly.
- All fifteen real HTTP negative-auth/preflight checks pass across the three Edge endpoints. These checks do not establish authenticated paid-provider end-to-end behavior.

## Deployment boundaries

Only the embedding-validation block in each deployed shared helper changed. The ingestion helper had preexisting differences from the repository helper; those unrelated differences were preserved deliberately. The document-import service does not call this helper's embedding function and remains v10. Shared-runtime drift still needs a separate compatibility audit before a future whole-directory deployment.

The frontend remains **12.2.37**, canonical engine **1.2.7**. No database migration or live game mutation was performed. The live Transformers read after deployment remains Night 1, document version 192, 47 players and 44 alive. Tests made no paid AI requests and created no production fixtures requiring cleanup.

## Remaining work

This is response-integrity validation, not complete cost accounting. Initial import, ingestion and search-embedding usage persistence, durable reconciliation and concurrent budget limits remain open. A real paid, authenticated import-to-search flow was not run. General custom passive/on-death rewards, late-intel causality, executable rule/precedent priority and retired endpoint inventory remain in the [current coverage index](AUDIT_COVERAGE_2026-09-08.md).

The browser-control retry failed before returning any tab state with a sandbox ACL initialization error. That prevents a current native login/two-GM/approval/advance smoke test; it is not proof of an application defect. Full audit status remains **INCOMPLETE**.
