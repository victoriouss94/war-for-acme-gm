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

## Confirmed open spending gaps

1. Deployed gm-document-import v10 and gm-knowledge-ingest v2 do not reserve/complete persisted AI usage. Their in-memory rate counters do not implement the existing per-game monthly budget. Initial imports have no existing game, whereas the ledger requires a game ID; an account-scoped import budget needs deliberate design.
2. The shared provider helper can discard usage when parsing or repair fails; the copilot failure path can consequently record zero. This repair preserves known costs but cannot recover unreported charges.
3. Existing reservations hold zero estimated cost. The monthly check is against already recorded usage, not a hard reservation of maximum in-flight spend, so concurrent requests can overshoot.

Provider-response accounting, known-game import integration and concurrency controls need separate implementation and mocked-provider regressions. Do not describe this change as a complete spending cap or coverage of every AI feature.
