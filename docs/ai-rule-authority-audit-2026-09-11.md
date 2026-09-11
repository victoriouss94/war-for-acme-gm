# AI rule-authority request contract

## Repair

Audit requirement 47 places explicit current-game rules first, explicit role/ability rules second, the Global Master Ability Encyclopedia third, saved GM precedents fourth, and AI/GM review last. The active copilot advice prompt instead placed current-game precedents before the encyclopedia. Its top-level and nested authority profiles repeated that outdated order. The isolated-interaction prompt did not specify the position of saved precedents.

The existing server global-resolution module now supplies one shared instruction string and the corrected server profile. Both advice and isolated adjudication use that instruction. Advice input uses the same hierarchy, including its saved-game profile and effective ruleset. A legacy effective-ruleset profile cannot reintroduce the stale authority order; unrelated fields such as configured resolution stages and actual game-rule records are preserved without modifying the database object.

Precedents remain scoped evidence, not automatic overrides. Current explicit rules still override global defaults. Retrieved records remain untrusted data, and AI still cannot apply a result or resolve an entire night through the retired route.

## Verification

- Three actual-handler regression tests initially failed and now pass: ordinary advice request hierarchy/instructions, isolated adjudication instructions, and preservation of custom game rules with a stale server profile.
- Full local JavaScript suite with the supplied Transformers DOCX: **860 passed, zero failures, zero skips**. Provider and database boundaries in these tests are mocked; no paid requests or live game changes were used.
- The fresh deployed copilot v27 bundle was reconciled before deployment. Only its entrypoint and existing global-resolution helper changed; its other four files matched. Copilot v28 is the scoped deployment. No importer or ingester deployment is required.
- Frontend 12.2.54 and deterministic engine 1.2.21 are unchanged. No schema, account, price, budget or saved-game mutation is part of this repair.

## Deliberately incomplete

These tests verify the instructions and data actually sent to the provider, not guaranteed model obedience or arbitrary custom-rule execution. The browser deterministic authority metadata still retains its older ordering and must be reconciled separately; its authority labels are not a rule compiler. Deterministic custom-rule/precedent execution, custom passive rewards, durable cost accounting and the current native multi-GM browser workflow remain open. The full audit is **INCOMPLETE**.

The [OpenAI Responses instructions field](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) places these application instructions in system/developer context. The [Supabase testing guide](https://supabase.com/docs/guides/functions/unit-test) informed isolated function verification. No model or API option was changed.
