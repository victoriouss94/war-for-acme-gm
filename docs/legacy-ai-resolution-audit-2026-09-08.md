# Legacy whole-night AI route audit — September 8, 2026

## Actual defect

The main Resolve Night button already called the existing deterministic engine. However, chat recognized only the literal word `resolve` in its local phase handler. The server's existing intent classifier also recognized `process all actions` and `analyze tonight`. Those messages reached the older whole-night AI branch instead. Selecting the explicit `resolve_actions` task with a message such as `please do it` bypassed the local handler too.

Six failing runtime regressions reproduced this: three actual app-handler tests reached GMCloud.askCopilot, and the corresponding actual Edge handler tests attempted embeddings, a whole-night response and a repair response. These were mocked provider boundaries, not paid requests; the repair request followed the intentionally incomplete fixture response. This is evidence of the reachable paid path, not a claim that every real request made three calls.

## Repair in existing components

- The existing request normalizer now reuses `inferMasterIntent` from the already existing shared Master GM module. Recognized resolution requests receive the existing `resolve_actions` task; other task selections remain unchanged.
- The existing app handler routes that task into its deterministic phase/Action Queue handler. It opens Resolve Night review without approving, applying, advancing or creating a second resolver. The loading message and task label now identify the deterministic workflow.
- gm-copilot rejects the retired whole-night request with HTTP 409 and `DETERMINISTIC_RESOLUTION_REQUIRED`, after user/membership authorization and before conversation/session writes, usage reservations, embeddings or generation. Old clients receive clear instructions to use Action Queue → Resolve Night.
- The existing isolated `adjudicate_interaction` branch remains available. Ordinary explanations, content drafts, document imports and their existing permissions/accounting were not replaced.

The older full-night branch and response validators remain in source behind the early rejection for compatibility/reference. They are deprecated, not presented as a second active resolver or blindly deleted. Historical saved AI proposals remain readable. The old internal proposal-recording RPC is service-role-only in production: anonymous and authenticated users cannot execute it directly. Its removal and exhaustive schema-wide retired endpoint inventory are separate work.

## Verification

Nine new tests cover the three browser-handler routing cases, an unchanged ordinary explanation, the three server rejection cases, and retained invalid-session/viewer denial. Rejected resolution requests make zero provider calls, zero user RPCs and zero service RPCs in the actual handler tests. Existing isolated-adjudication and draft/accounting regressions also pass.

Full suite: **559 passed, zero failed, zero skipped**, including the supplied Transformers DOCX. JavaScript syntax checks and static deployment build pass. Cache-version checks include the shared classifier's browser import. These app-handler tests run the actual extracted functions with a synthetic UI context; they are not native browser click tests.

Frontend **12.2.32**, existing engine **1.2.4**, gm-copilot **v25**. Deployed Edge source and all five dependencies were read back and matched the tested files; JWT verification remains enabled. All 15 live HTTP negative-auth/CORS checks across the three existing Edge Functions pass. No database migration was needed.

## Remaining limits

Native browser automation still exits before providing tab state, so current login, full native approval and two-GM realtime checks remain unverified. The new authorized rejection path is runtime-tested and deployment-source-verified, not exercised with a fresh real GM JWT. Natural-language classification is heuristic; this repair covers the existing recognized resolution intent and explicit task selection, not every possible phrase a person could write.

No live Transformers state, accounts, historical results or paid-provider requests were changed by these tests. Broader custom-passive causality, rule/precedent integration, accounting durability and final audit certification remain open.
