# Document-search embedding usage retention

## Scope and result

The copilot document search discarded embedding usage, including provider-reported usage returned with invalid vectors or an HTTP error. The existing adapter now accepts an optional usage observer, invoked before response validation. Copilot retains only the model and validated nonnegative integer prompt/total token counts in the existing private searchDocuments tool output. Missing counts remain null; a transport failure records no provider observation.

The public tool trace and language-model tool summary still omit this private accounting metadata. Embedding counts are not added to response-model token totals or dollar estimates. No model, price, quota, schema, authentication policy, UI, resolution rule, or live game state was changed.

## Verification

- Six actual-adapter mocked-provider tests cover success, invalid vectors, HTTP failure, absent usage, transport failure, and the legacy one-argument API.
- Seven actual-copilot handler regressions initially failed; after the fix they pass. Coverage includes valid/invalid/missing/malformed usage, transport failure, private metadata filtering, one embedding attempt, unchanged response-model accounting, and retaining search usage when later answer parsing fails.
- Combined provider-accounting and embedding tests: 48 passed.
- Full regression suite with the supplied Transformers DOCX: 855 passed, zero failures, zero skips. No paid provider calls or live game mutations were used.
- The fresh deployed copilot v26 entrypoint and helper matched the pre-change Git baseline. Only those two files change in its six-file bundle; the other four remain identical. The separately deployed document importer and knowledge ingester are not redeployed.

## Remaining limitations

This is request-local capture routed through existing private tool-call records, not a durable billing ledger. The existing trace RPC path does not verify persistence errors. Knowledge-ingestion embedding accounting, model-aware embedding dollar estimates, pre-game import accounting, in-flight budget reservations, and recovery after process/persistence failures remain separate open audit work. Browser-based multi-GM testing and general custom-rule execution also remain incomplete.

Reference: [OpenAI embedding response schema](https://developers.openai.com/api/reference/ruby/resources/embeddings/methods/create) defines prompt_tokens and total_tokens; [Supabase function testing](https://supabase.com/docs/guides/functions/unit-test) describes isolated function verification.
