# Cross-game precedent compatibility audit — September 13, 2026

## Existing implementation

The existing gm-copilot searchPrecedents path retrieves authorized candidates through search_gm_precedents, evaluates compatibility, removes incompatible results, and builds the AI input and citation catalog. This repair changes that evaluator and its mapping context; it does not create another learning system or change the deterministic night engine.

## Reproduced defects

The evaluator stored one compatibility value per global concept in a Map. Multiple relevant abilities can map to the same concept. The last row silently won: an EXACT row could overwrite an INCOMPATIBLE or PARTIAL row. Results therefore depended on database row order.

Two other errors affected the same path:

- If only some required global concepts were mapped, a candidate could remain STRONG because only “no concepts mapped” was downgraded.
- The evaluator used every mapping in the game, including abilities unrelated to the queried interaction. An unrelated EXACT mapping could certify the match; an unrelated INCOMPATIBLE mapping could suppress it.

## Repair

The existing evaluator now collects all relevant mapping levels per concept, including both UUID and concept-key aliases. INCOMPATIBLE takes precedence; PARTIAL cannot be overwritten by another row. Missing any required concept downgrades the result to PARTIAL. STRONG mappings cannot certify an EXACT match. Unknown mapping levels conservatively become PARTIAL.

The caller supplies mappings only for the abilities already selected by its existing focused-context logic. Retrieval signature construction, SQL/RLS scope, current-game handling, source-version/status checks, authority hierarchy, model, quotas and approval requirements remain unchanged.

The fix determines whether a historical ruling is a usable reference. It does not execute that ruling as a game action or guarantee that arbitrary prose is understood.

## Runtime verification

Twelve new actual gm-copilot handler tests extend tests/ai-provider-accounting.test.mjs, reusing the real TypeScript service/response parser with mocked database/provider boundaries.

The first seven new tests reproduced five failures before the repair; the two opposite-order controls passed. All twelve pass after the repair, including:

- both row orders for incompatible and partial mappings;
- an incompletely mapped multi-concept precedent;
- unrelated mapping false inclusion and false exclusion;
- STRONG versus EXACT classification;
- all-concept exact matches retaining their citation and count;
- current-game references surviving rejection of a global candidate;
- viewer and unauthenticated requests rejected before retrieval or provider work.

Tests inspect the actual provider-bound relevant_precedents, returned sources and compatibility counts, not just a helper return value. They also retain the existing authority-priority regressions. Source fixtures remain unchanged.

The handler file now has **64 passing tests**. Full suite: **1,027 passing, zero failures, zero skips**, including the supplied Transformers DOCX. JavaScript syntax/static deployment checks pass.

## Deployment and safety

gm-copilot **v31** is deployed ACTIVE with JWT verification enabled. Its entrypoint and all six shared dependencies were compared against the deployed v30 bundle before deployment; only the intended entrypoint changed. All seven deployed files were verified against the submitted bundle afterward. An unauthenticated production request returned HTTP 401.

Frontend remains **12.2.66**, canonical engine **1.2.26**, knowledge ingestion **v8**, and Word importer **v11**. No SQL migration, quota/model change, live-game simulation, account mutation, production data fixture, or paid provider request was required.

The current Supabase changelog and [Edge deployment documentation](https://supabase.com/docs/guides/functions/deploy) were checked. Existing authenticated client retrieval and service-only persistence boundaries are preserved.

## Remaining limits

These tests do not establish fresh-JWT database retrieval across every owner/membership combination or real paid-model compliance. Selection still uses the existing focused-context heuristics. Current-game precedent version compatibility and arbitrary rule/condition interpretation are not expanded here. The complete audit remains open, particularly native two-GM workflow verification, accounting durability/concurrency, and custom passive dependency execution.
