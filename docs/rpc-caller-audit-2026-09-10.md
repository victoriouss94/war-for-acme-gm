# Current RPC and legacy-route inventory — September 10, 2026

## Result and scope

The current frontend/Edge RPC names and argument-key shapes match the deployed public function catalog. No missing function, unexpected argument, ambiguous matching overload or browser-to-service-only caller was found in this pass.

This is a read-only contract and privilege inventory, **not** proof that every function body, row-level policy, runtime value, browser workflow or historical SQL path is correct. The full technical audit remains **incomplete**. No production permissions or game state were changed.

## Current caller inventory

| Area | Evidence |
| --- | --- |
| Frontend | 62 literal call sites / 62 names in js/cloud.js |
| Edge source | 36 literal call sites plus one dynamic proposal site |
| Combined | 99 call sites; 80 named targets after resolving the dynamic proposal branches |
| Automated argument comparison | 97 sites match; two require explicit review |
| Accounting wrapper | All four completeUsageRecord payload sites match the nine deployed input arguments |
| Dynamic proposal wrapper | Both create_ai_change_proposal_internal and create_global_rule_proposal_internal match the same 11 input keys |
| Catalog privileges | 67 targets callable by authenticated users; 13 service-only; none callable by anon |
| Browser/service boundary | Every frontend target is authenticated-callable; no internal service-only target is called directly by the browser |

The catalog query selected metadata only: function names, input names/default counts, signatures and EXECUTE privileges. It did not invoke the functions or read live game rows. OUT result columns were excluded from input-key comparisons. Supabase RPC named-argument behavior is documented in its [JavaScript RPC reference](https://supabase.com/docs/reference/javascript/rpc).

The [detailed dated inventory](rpc-caller-inventory-2026-09-10.json) includes all observed sites, signatures, manual-review dispositions and selected textual legacy dependencies.

## Deployed entrypoints

The three current Edge entrypoints were read back: gm-copilot v26, gm-document-import v10, gm-knowledge-ingest v6; JWT verification is enabled on each. Their literal RPC-name sets match the checkout. The copilot entrypoint matches local source exactly after line-ending normalization, including both dynamic proposal targets and the earlier deterministic-resolution rejection guard. Document import has no direct RPC call.

The frontend has four Edge invocation sites targeting these three functions. Username/password authentication uses the existing Auth SDK flow; it is not an additional application RPC service in this inventory.

## Retained legacy routes

| Route | Classification and evidence |
| --- | --- |
| Public finalize_resolution_session / finalize_resolution_with_grants | Compatibility signatures; no current frontend/Edge caller. Prior runtime repair routes them through canonical approval. Catalog confirms authenticated execution and invoker mode. |
| Private finalization helpers | Still referenced by canonical approval/history implementations. Not safe to delete merely because they lack a direct frontend caller. |
| record_resolution_ai_proposal_internal | Remains in the retired whole-night branch behind the existing early rejection. Service-only; no browser/anonymous access. |
| record_ai_exchange_internal | No current frontend/Edge caller or selected direct textual SQL caller found; service-only. Retained, not declared universally unreachable. |
| Old complete/fail_knowledge_ingestion_internal | Service-only compatibility wrappers. Existing claim migration allows null-claim completion only for never-claimed versions; current workers use claim-bearing signatures. |
| Old complete/fail_knowledge_ingestion | No current frontend/Edge caller; service-only in the catalog. Bodies still contain existing GM access checks. Not used as a replacement for claim-bearing operations. |

No legacy function was dropped or privileges relaxed. Textual SQL reference search is not a complete dynamic SQL dependency graph.

## Reusable verification

scripts/audit-rpc-contracts.mjs accepts a locally supplied catalog JSON snapshot and never connects to a database. It reports missing names, required/extra keys, ambiguous matches and manual-review expressions. It ignores comments/quoted examples and retains UTF-16 source positions. This is a bounded scanner for the currently observed call forms, not a general JavaScript parser; complex regex/template-expression or generated call forms still require manual inspection.

Eight new tests cover nested payloads, quoted examples, Unicode offsets, defaults/OUT fields, mismatches, dynamic/spread arguments, overload ambiguity and no-argument calls.

Full suite: **765 passed, zero failed, zero skipped**, with actual supplied Transformers DOCX available. JavaScript syntax and static build checks pass; these do not substitute for full type checking.

## Remaining boundaries

Actual custom game-rule/precedent execution, on-death rewards, durable AI accounting and native two-GM browser behavior remain open. Initial rule-priority tracing also confirms that arbitrary snapshot rules are not compiled into executable effects simply by being listed as authority. The metadata priority list places current-game precedents before the encyclopedia, unlike the latest audit request; changing the label alone would not implement the requested execution hierarchy.

No paid AI request, live game read/write, account, Storage operation, migration or Edge deployment was performed in this continuation. Only audit scripts/tests/reports were published. No native browser handoff is performed during quiet background auditing.

