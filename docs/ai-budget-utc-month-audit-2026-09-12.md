# AI budget month boundaries — database audit

Production migration: `20260912022242_align_ai_budget_utc_month`. Frontend 12.2.57 and engine 1.2.24 are unchanged. Full audit remains **INCOMPLETE**.

## Reproduced defect

The owner usage summary uses a UTC calendar month, but `reserve_ai_usage_internal` used the database session's local month start and no month-end bound. Under a non-UTC session this could miss charges at the beginning of the UTC month or count charges from the preceding UTC month. Future-dated ledger rows were also included indefinitely.

The local PostgreSQL reproduction first failed for a charge 30 minutes after UTC month start under America/Los_Angeles: a reached monthly limit incorrectly allowed a new reservation. Initial fixture setup errors were corrected before identifying this product defect.

## Repair and evidence

Only the existing aggregate's date predicate changed to the half-open range `[UTC month start, next UTC month start)`, matching the existing owner summary. Function authorization, feature validation, advisory lock, request-rate limit, configured monthly limits, prices, FAILED/COMPLETED cost inclusion and pending-request policy remain unchanged. No database-wide timezone setting changed; Supabase recommends retaining its [default UTC configuration](https://supabase.com/docs/guides/database/postgres/configuration).

The migration checks that the exact old predicate occurs once before replacing it and uses bounded lock/statement timeouts. Production definition and privileges were inspected after deployment: anonymous/authenticated execution remains denied; service execution remains allowed; the existing empty search path is retained.

`tests/ai-budget-utc-month.sql` runs only in local PGlite/PostgreSQL. Eight cases pass: exact UTC start, western-zone early charge, eastern-zone preceding-month charge, exact next-month boundary, final second, charged failed request, unchanged pending-request behavior and another game's isolation. Browser-role denial and rollback cleanup also pass. No synthetic game or ledger row was created in production.

The JavaScript regression baseline remains 885 passing tests with no failures/skips, including the supplied Transformers DOCX. Security advisors remain unchanged: 43 authenticated SECURITY DEFINER warnings, one leaked-password warning and two no-policy informational notices. These preexisting findings are not claimed resolved by this migration.

## Still open

This aligns period boundaries, not durable accounting or a hard provider spending cap. Concurrent in-flight requests are still not reserved against estimated dollar cost. Import/ingestion/embedding cost recording and reconciliation remain incomplete.

This continuation also confirmed that the deployed knowledge ingester's exclusive-processing claim is separate from AI usage reservation. Its extraction and embedding requests still lack usage-ledger wiring. The Word importer likewise lacks this wiring, and may run before a game exists. No Edge code or pricing policy was changed here; those are separate remaining implementation tasks.
