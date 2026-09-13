# Recorded usage scope and spending-threshold audit — September 13, 2026

## Existing behavior verified

The existing reservation, completion and monthly-summary SQL was executed in isolated PGlite 0.5.8 with synthetic users, game metadata and prices. The runner applied the relevant checked-in migrations, including failed-charge preservation, supported feature labels, missing-reservation handling, UTC month boundaries and pre-game import accounting.

Two requests were reserved before either completed. With a synthetic $1 game threshold, the two pending records showed zero recorded cost. Completing them at $0.60 each (one COMPLETED and one FAILED) produced $1.20 recorded usage. The next reservation was rejected with AI_MONTHLY_LIMIT_REACHED. This confirms the existing threshold checks already-recorded spend, not the maximum possible cost of work in progress.

After removing only the synthetic fixture's threshold, an additional $0.01 assistant/embedding-labelled record raised the game total to $1.21. A separate $5 pre-game document-import record did not change that game total. The summary includes game-linked document imports, knowledge ingestion and assistant-feature records; it excludes records without that game ID. The actual Edge handler tests separately verify feature attribution and embedding accounting.

All local rows were rolled back. These are synthetic-cost, single-session SQL results, not real provider prices, multi-session concurrency tests or production billing observations. The owner helper was stubbed for this aggregation test; this does not add authorization/RLS proof.

## User-facing defect repaired

The AI Usage panel still said document imports, knowledge indexing and document-search embeddings were excluded, despite the deployed accounting repairs. Its help now distinguishes:

- Recorded game-linked reimports, knowledge indexing and search embeddings are included.
- Initial Word analysis before game creation is recorded separately and excluded from this game total.
- Pending requests, recording failures and old missing records can leave totals incomplete.
- The recorded-spend threshold is not a hard account spending cap; no historical backfill is implied.

Only help text and frontend release cache identifiers changed. No spend limit, reservation policy, permission, accounting row, model or Edge Function was modified.

## Checks and remaining scope

Frontend release **12.2.67**; canonical engine **1.2.26** unchanged. The help-text regression and existing aggregate-renderer/cloud-loader tests pass; the full JavaScript suite has **1,040 passes, zero failures, zero skips**, including the supplied Transformers document. JavaScript syntax and static build checks are the repository's existing lint/typecheck/build evidence, not full type analysis or native browser proof.

A hard in-flight spending reservation and durable reconciliation after worker/recording failure remain unimplemented. This patch does not claim to solve them. General custom passive/on-death execution, native end-to-end/two-GM testing, and the pending invited-GM GLOBAL-sharing decision remain open. Live games were not changed. The complete audit remains **INCOMPLETE**.

See the [coverage index](AUDIT_COVERAGE_2026-09-08.md), [embedding accounting](embedding-cost-accounting-audit-2026-09-12.md) and [Word import accounting](document-import-accounting-audit-2026-09-12.md).
