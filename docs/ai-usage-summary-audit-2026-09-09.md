# Monthly recorded AI usage — September 9, 2026

Frontend 12.2.41; canonical engine 1.2.9 unchanged. Migration `20260909185549_owner_ai_usage_month_summary`. No Edge Function changes. Full technical audit remains **INCOMPLETE**.

## Defect and repair

The usage panel calculated monthly totals from a query capped at 250 recent records and used the browser's local month boundary. Failed usage queries could appear as zero spending. The new owner-only `get_ai_usage_month_summary` RPC aggregates every saved record in the UTC calendar month; recent rows remain a separate, capped history display. Failed and unfinished request counts are explicit. Missing or malformed aggregates display an unavailable warning, not a fabricated zero. An empty verified month still displays zero.

The SQL function is SECURITY INVOKER, has an empty search path, checks existing game ownership and preserves usage-table RLS. Anonymous execution is revoked. No roles, account settings, pricing, models, quotas or existing recorded costs were changed. Supabase's [function security guidance](https://supabase.com/docs/guides/database/functions) informed these restrictions.

## Verification

- All **658 JavaScript tests passed**, zero failures/skips, with the supplied Transformers DOCX. Seven new regressions exercise the actual aggregate renderer, learning-panel block and cloud loader, including unavailable data, nonowners and a total exceeding the recent-history cap. Existing cache-version assertions were updated for the changed client.
- Actual candidate SQL and the complete `tests/ai-usage-summary-rollback.sql` fixture ran in local PGlite 0.5.8 PostgreSQL with minimal synthetic auth/game scaffolding. Of 504 seeded rows, 502 were in the month: 5,020 input tokens, 1,003 output tokens and $5.02 recorded cost. Both month boundaries, Pacific/Auckland and America/Los_Angeles sessions, failed/pending records, empty-game totals, nonowner GM denial, cross-game isolation and invoker privileges passed. Rollback removed fixture games and the candidate function.
- This synthetic fixture was **not executed in production**: that operation was rejected before execution and replaced with local-only testing. No committed test data was created.
- The deployed RPC was verified using an authenticated owner in a **read-only** production transaction against existing Transformers records. Its aggregate exactly matched an independent direct query, and an unrelated game returned no total. This verifies database role/RLS behavior, not a fresh-JWT browser interaction.
- Post-deployment security advisors were unchanged: 43 existing authenticated-definer warnings, one password-protection warning and two no-policy information findings. The new function is invoker, authenticated-callable and not anonymous-callable.
- JavaScript syntax scripts, static build validation and diff checks passed. These are not full static type analysis or native-browser workflow tests.

## Deliberate remaining limitations

Saved records are not total OpenAI account spending. Document import, knowledge indexing and document-search embeddings currently lack complete usage accounting. Pending requests and recording failures can leave costs uncounted. The existing monthly setting checks recorded spending, not reserved in-flight estimates; concurrent and untracked work can exceed it. The interface now says this explicitly. This change repairs the monthly display, **not** durable accounting or hard budget enforcement. No paid AI calls, user accounts, Storage objects or live game state were changed by this work.
