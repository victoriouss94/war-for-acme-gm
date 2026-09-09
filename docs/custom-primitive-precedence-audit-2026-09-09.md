# Explicit custom-primitive precedence — September 9, 2026

Frontend 12.2.44, canonical engine 1.2.12. No database migration or Edge Function change. Full technical audit remains **INCOMPLETE**.

## Reproduced defect

The engine read explicit engineBehavior overrides but several stage handlers then chose their operation from the standard ability identity alone. An ability named Personal Instant Kill with an explicit unsupported CUSTOM primitive could still kill; the same fallback affected protection, conversion, investigation and blocking. Nine initial regressions failed across action-level, ability-level and understanding-level override fields.

## Narrow repair

The existing execution gate now isolates an explicit CUSTOM primitive for source-rule review before execution starts. A familiar ability name cannot replace that primitive with the encyclopedia default. Already blocked actions remain blocked without an unnecessary effect adjudication. Canceled actions and explicit GM reclassification retain their existing behavior.

Unexecuted CUSTOM attempts are excluded from visit inference, Omega collateral and automatic Reflection pre-processing. Otherwise an effect withheld for review could still cause false passive or visitor consequences. No standard primitive, stage order or existing supported structured Duel/Role Swap/Steal handler was replaced.

The existing isolated adjudication path may supply a supported primitive; if it does not, the result stays INELIGIBLE_EFFECT with GM review required. The original ability record is never rewritten. A false review flag alone does not make the unsupported CUSTOM primitive executable.

## Verification

- **703 JavaScript tests passed, zero failures/skips**, including extraction of the supplied Transformers DOCX.
- Eighteen new regressions cover five standard-name fallbacks, snake/camel behavior placement, action/understanding overrides, independent valid attacks, editor payload retention, ordinary supported primitives, GM cancellation/reclassification, blocked attempts, unsupported review-flag bypass, Reflection, Omega visit collateral, Watch and supported isolated adjudication.
- The actual frontend Resolve Night handler ran with mocked service/UI boundaries: it sent only the isolated custom interaction to adjudication, retained source text and saved a review-required result without death when the response remained unresolved. No real provider request was made.
- JavaScript syntax scripts, static build and diff checks passed. Only the app-to-engine cache chain changed.

## Scope limits

This is not a general prose-rule compiler or proof of the complete authority hierarchy. Custom identity, textual conditions/modifiers, unsupported structured fields and arbitrary game/role/precedent overrides still need deeper execution review. Existing explicit CUSTOM markers are now honored, but the engine cannot infer every unsupported mechanic from prose.

No live game was restarted, simulated or edited; no database, account, Storage or paid AI mutations occurred. Native-browser collaboration/approval, complete accounting, custom passive rewards/on-death dependencies and retired-path inventory remain open.
