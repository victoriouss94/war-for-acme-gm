# Deployed knowledge-provider response validation — September 9, 2026

## Result

gm-knowledge-ingest **v6** is active with JWT verification preserved. Frontend remains **12.2.47**, canonical engine **1.2.15**, gm-copilot **v26** and gm-document-import **v10**. The full audit remains **incomplete**.

## Reproduced deployment discrepancy

While tracing remaining usage accounting, the actual deployed ingestion bundle was compared with its checkout dependencies. The ingestion v5 helper still used JSON.parse directly. It could accept syntactically valid JSON from an incomplete, filtered, failed or refused provider response, embed the partial passages and activate them as official knowledge.

Nine new actual-handler tests ran against the retrieved v5 helper using synthetic Auth, Storage, RPC and provider HTTP boundaries. Seven failed: five demonstrated false completion/activation; malformed and empty responses were already rejected but lacked the shared precise error codes. Two completed-response controls passed.

The document-import v10 bundle was inspected separately: it already uses the shared structured-response parser. It was not redeployed. Its unused embedding helper and the ingestion/copilot helper versions are not assumed identical.

## Scoped repair

The existing shared response parser is now included in the ingestion bundle and used before returning a structured result. The deployed entrypoint is byte-for-byte unchanged. Its claim, download, passage mapping, activation/failure RPCs, CORS, JWT verification, models and limits are preserved. No wholesale shared-helper upgrade or new parser was introduced.

Incomplete/failed/refused output now follows the existing claimed-failure path before embeddings or completion. The existing shared parser uses the response status, incomplete details and refusal content described by the [official Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create). No automatic paid retry was added.

## Verification

- Nine new tests in tests/knowledge-provider-validation.test.mjs run the actual handler and actual provider adapter, not a mocked structuredResponse function.
- Exact candidate deployed helper plus unchanged production entry: **28 lifecycle, claim and provider-validation tests passed**.
- Complete checkout suite: **757 passed, zero failed, zero skipped**, including actual supplied Transformers DOCX extraction.
- JavaScript syntax and static deployment checks passed; these are not full type analysis.
- After deployment, all three returned bundle files matched the expected content exactly; version 6 is ACTIVE with verify_jwt=true.
- A live unauthenticated POST returned **401**, before provider or document work. This is an authorization smoke test, not an authenticated ingestion end-to-end test.
- No paid provider call, account, database migration, Storage object or live-game mutation was performed.

## Remaining work

This fixes provider-validation deployment drift, **not AI usage accounting**. The inspected document-import and knowledge-ingestion handlers still lack complete ledger persistence; retrieval embeddings and in-flight budget reservations remain open. The existing game-bound ledger also needs a deliberate compatible treatment for imports performed before a game exists. No pricing or quota policy was changed.

Background execution alone is not a durability guarantee: Supabase background tasks still have bounded instance lifetime. See [Supabase background-task guidance](https://supabase.com/docs/guides/functions/background-tasks). Full accounting reconciliation requires separate implementation and testing.

No native browser handoff was performed because this is a quiet background audit. The live Transformers game was not re-read or changed; historical state in the coverage index is now explicitly labeled historical.
