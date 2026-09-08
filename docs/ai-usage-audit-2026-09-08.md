# AI usage accounting audit — September 8, 2026

This is a bounded repair, not completion of the full technical or spending audit.

## Repaired and verified in production

Migration `20260908123323_preserve_ai_usage_accounting` preserves the existing two internal usage endpoints and database structure. A reproduced late failure callback previously changed a completed request to FAILED and zeroed its charge. The monthly budget also excluded failed requests even when they had a known charge.

- A COMPLETED usage row is now immutable to subsequent completion/failure callbacks.
- Noncompleted rows retain the greatest known token counts, cost and latency; empty response IDs do not erase known IDs. Cached tokens cannot exceed input tokens.
- A failed request can subsequently complete without losing known usage.
- The monthly budget includes recorded COMPLETED and FAILED costs within the current month. Existing game locking, membership checks and request rate limits remain intact.
- No historical usage backfill, table change, frontend change or Edge deployment was performed.

Both functions retain an empty search path and execution grants restricted to postgres and service_role. Their existing SECURITY DEFINER caller guard is not itself proof of authorization: the verified execution ACL is the service boundary.

## Verification

`tests/ai-usage-accounting-rollback.sql` passed against production using synthetic ledger amounts in a disposable game inside BEGIN/ROLLBACK. It covers completed-row immutability, repeated failure retention, failed-to-completed retention, monthly failed charges, rejected reservation atomicity, actor membership, authenticated caller denial, prior-month exclusion and the existing rate limit. Fixtures were verified absent afterward. No provider requests, paid API calls, new accounts or live game edits were made.

The JavaScript suite passed all 384 tests with no skips, including the supplied Transformers DOCX; syntax, static build and whitespace checks passed. These checks do not establish authenticated HTTP or full TypeScript coverage.

The security advisor still reports 46 underlying findings in three grouped categories: 44 authenticated SECURITY DEFINER notices, one leaked-password protection warning and one intentional no-policy legacy-table informational notice. A grouped count of three is not evidence that 43 findings were resolved. See [Supabase's function-execution advisory](https://supabase.com/docs/guides/database/database-advisors?lint=0029_authenticated_security_definer_function_executable).

## Follow-up: provider failure accounting repaired

The shared Responses helper now reports each received response's usage to a request-local accumulator before parsing, refusal handling or repair can throw. All three copilot generation/repair call sites attach that observer. Both copilot failure paths use accumulated input/cached/output counts and the latest received response ID instead of zeroing them. This also preserves known usage when subsequent semantic validation or persistence fails. Success accounting and the number of provider requests are unchanged.

This follows the documented [Responses API usage fields](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create); it does not infer charges for a response that was never received. The optional observer does not add a provider call or database write.

tests/ai-provider-accounting.test.mjs executes the actual TypeScript helper and copilot handlers with mocked HTTP and Supabase boundaries (Node 24 type stripping, not static type checking). Eighteen tests cover success, invalid JSON, truncation, refusal, successful/invalid/network/quota-denied repair, zero known usage on initial transport failure, cached-token clamping, request isolation, adjudication success/failure, rejection before provider invocation, semantic draft failure and failed draft persistence. The three call-site observer assertion is static; the adjudication and draft handler tests execute actual handler code. No real JWT or paid provider call is used.

Full suite: 402 passed, zero failed/skipped, including the supplied Transformers DOCX. Static build and whitespace checks passed. Production gm-copilot v22 is ACTIVE with verify_jwt=true; all six deployed files were read back and matched the tested source. Fifteen post-deployment live negative-auth/CORS checks passed. These are gateway checks, not authenticated HTTP end-to-end accounting. The import and knowledge-ingest functions were not redeployed. Frontend remains 12.2.14.

## Follow-up: current assistant intent compatibility repaired

Production reservation tests reproduced INVALID_AI_USAGE_REQUEST for 14 of the 20 current Master GM feature labels. The internal reservation function still used its original nine-label allowlist even though the assistant had grown. Examples included explaining roles (normalized to explain_content), faction/rule/status drafts, phase/roster assistance, ability inventory/grants and queued-action assistance. Deterministic early-return paths were not affected; requests reaching this reservation check were rejected before their main Responses call.

Migration 20260908130229_align_ai_usage_with_master_gm_intents aligns reservation validation with all 20 current intents and three existing legacy/ingestion labels. The table constraint also gains the five current labels missing from it. Historical auto/create_game rows remain valid without permitting new reservations for those retired/unresolved labels. Unknown/empty/null labels and invalid model names remain rejected.

The change touches only the existing feature constraint and reservation validation predicate. A before/after function comparison confirmed that the rest of the function body, ACL, SECURITY DEFINER setting and empty search path are identical. Budget limits, service-only execution, membership validation, game locking and rate limits were not weakened. All 405 JavaScript tests passed with zero skips; static build and whitespace checks passed. All four generated audit games were verified absent after rollback. Security advisors still report the same three categories with 46 underlying findings.

Verification: tests/ai-usage-intents-rollback.sql passed all 23 supported labels, record attribution, invalid-label/model rejection, no phantom rows, nonmember denial and browser execution denial against production in a rolled-back synthetic game. The prior usage-accounting regression also passed after this migration. tests/ai-intent-contract.test.mjs adds three source-contract tests comparing the actual current task router/schema against the SQL allowlists so future drift fails the suite. No paid provider call, live game edit, frontend change or Edge deployment was needed for this follow-up.

## Remaining spending coverage

1. Deployed gm-document-import v10 and gm-knowledge-ingest v2 do not reserve/complete persisted AI usage. Their in-memory rate counters do not implement the existing per-game monthly budget. Initial imports have no existing game, whereas the ledger requires a game ID; an account-scoped import budget needs deliberate design.
2. Copilot parsing/repair/downstream-failure loss of received Responses usage is repaired above. Requests whose response was never received still have unknown usage; database accounting write failures are not durably retried. Neither this repair nor the ledger migration reconstructs historical missing charges.
3. Existing reservations hold zero estimated cost. The monthly check is against already recorded usage, not a hard reservation of maximum in-flight spend, so concurrent requests can overshoot.

4. Copilot document-search embeddings run before the Responses budget reservation and their usage is not included in it. Import/ingestion embeddings also require their own accounting. Existing hard-coded estimated pricing has not been audited against current provider pricing.

Known-game import integration, embedding coverage, durable accounting writes and concurrency controls need separate implementation and mocked-provider regressions. Do not describe this change as a complete spending cap or coverage of every AI feature.
