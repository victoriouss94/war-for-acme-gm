# Word document import accounting

Frontend 12.2.59; deterministic engine unchanged at 1.2.24. The full project audit is **INCOMPLETE**.

## Reproduced problem

The actual Word-import handler authenticated users and checked replacement-game membership, but invoked paid analysis without reserving or completing an AI usage event. Existing-game reanalysis could therefore bypass its game budget, and both initial and replacement analysis lost token/cost records on success or parser failure. The existing ledger required a game ID, while initial analysis deliberately happens before a game is created.

Against the exact deployed v10 entrypoint/helper, the new suite had 13 failures and three passing authorization controls. The repaired actual handler and frontend path pass all 16 tests. The complete JavaScript suite has 910 passes, zero failures/skips, including the supplied Transformers DOCX.

## Existing implementation repaired

- Both import modes now reserve through the existing service-only `reserve_ai_usage_internal` RPC before paid work and require a confirmed request ID. Error, thrown, null and wrong-ID responses stop without a provider request. Replacement imports retain owner/GM checks and the game's existing request/monthly limits.
- Migration `20260912144842_account_for_pregame_document_import.sql` allows a null game ID **only for document_import** in the same ledger. The existing reservation RPC validates the actor, model and request ID, and uses a per-user transaction lock with the importer's existing four-per-minute allowance across workers. The existing user/date index is reused. No placeholder game, duplicate ledger, new table, new RPC, new read policy or broader grant was added.
- The shared provider adapter observes response usage before parsing can fail. The importer reuses the existing usage tracker, price estimates and bounded completion-write retries; retries do not reissue provider requests. Optional JSON repair remains off for imports.
- A completion-write failure preserves the generated draft and returns a warning. The real frontend handler places it in the existing review warnings. Provider/parser failures retain the local-parser fallback and their original error, including any accounting warning.

## Verification

Local PostgreSQL tests execute the actual migration and canonical reservation/completion functions: initial reservation and completion, the four-request limit, independent users, window expiry, six invalid inputs, the table feature constraint, unauthorized-game rejection, unchanged game monthly limits, owner/nonmember/anonymous visibility, browser RPC/table-write denial and rollback. The existing eight UTC budget-boundary cases also pass after this migration. The isolated harness substitutes only minimal Auth/game fixtures and the owner helper's membership semantics; it is not a fresh JWT or independent-connection concurrency test. Running without the migration reproduces `GM_ACCESS_REQUIRED` for initial accounting.

Production schema verification confirms the scoped nullable field/check, unchanged RLS, unchanged owner-only read policy, service-only reservation access, and preserved game-budget branch. Security advisors remain unchanged: 43 callable-definer warnings, one disabled leaked-password-protection warning, and two no-policy informational findings. See [definer guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); this is not a clean security certificate.

The deployed Word importer is v11, ACTIVE, with JWT verification enabled. All four deployed files matched the intended local source after line-ending normalization; unauthenticated HTTP returned 401. Its old shared adapter was deliberately upgraded to the already-tested current adapter used by Copilot/knowledge ingestion. Authentication/model-selection functions and the parser were retained. Copilot v29 and knowledge v7 were not redeployed. No live Transformers data, accounts or uploaded files were changed; no paid provider smoke request was made.

Token fields follow the [official Responses usage contract](https://developers.openai.com/api/reference/cli/resources/responses/methods/create). Costs reuse the existing estimated price policy, not a new assertion of current invoice prices.

## Explicit limits

Pre-game events belong to the authenticated user and have no game yet. They are not shown by the existing game-owner usage policy or included in a future game's monthly total. There is no newly invented account-wide monthly budget or automatic reassignment to a subsequently imported game. This closes missing initial/replacement response accounting, not every cost-reporting gap.

Embedding charges, durable reconciliation after worker crashes/ambiguous writes, hard in-flight dollar reservations, native authenticated two-GM workflow testing, and unsupported custom-rule/passive execution remain open. A successful isolated handler or deployment check is not proof of every live workflow.
