# Custom-passive identity audit — September 9, 2026

Release: frontend 12.2.47 / existing canonical engine 1.2.15. The full audit remains **incomplete**.

## Defect

A linked passive explicitly marked customIdentity=true could execute its mapped standard effect unconditionally. A synthetic conditional Death Immunity prevented a kill and reported RESOLVED even though its condition had no implementation. Equivalent risks existed for Reflection, Counterattack and Bulletproof.

The active-action custom guard did not protect passive classification. Legacy duplicated passive names could bypass linked metadata, and an independent implemented passive could have its effect incorrectly attributed to a same-named custom record.

## Repair

The existing passive classifier now routes typed custom identities, explicit CUSTOM behaviors and explicit unresolved rules to the existing named GM-review path. Nested camel/snake flags retain precedence over top-level flags, including explicit false. A custom passive remains review-only even if it carries a standard primitive marked requiresExplicitRule=false: unlike active actions, passive triggers do not have a custom primitive execution adapter.

Linked owned records remain authoritative when their names are duplicated in legacy passive/immunity fields. Explicit player passive references resolve their catalog metadata before classification. Structured custom player/mode immunities are included in review rather than silently discarded. Effect attribution skips unsupported custom candidates when a separate legitimate standard passive triggers.

No new passive engine or condition evaluator was added. A GM must still adjudicate unsupported conditions and record the ruling through existing review/editing controls. Provisional action outcomes are not automatically applied.

## Verification

20 new regressions; 14 of the initial 15 failed before repair. Coverage includes:

- Four mapped standard passives with custom identity.
- Top/nested camel/snake flags, explicit false, explicit CUSTOM and unresolved-rule metadata.
- Standard primitives that do not implement custom passive conditions.
- Linked legacy-name duplicates and explicit player references.
- Inactive versus temporarily accessible modes.
- Separate implemented passive source attribution.
- Structured player/mode immunities.
- Editor persistence, tracker approval gating, and the actual Resolve Night handler with mocked external boundaries and zero AI calls.

Full suite: **748 passed, zero failed, zero skipped**, including the supplied Transformers DOCX. JavaScript syntax scripts and static deployment checks pass; these are not full static type analysis or a fresh authenticated browser workflow.

No production game, account, database, Storage, Edge Function, model or budget changes. No paid AI calls. The live Transformers game was not read, restarted, simulated or edited in this continuation.

## Remaining limits

Unmarked custom conditions, arbitrary on-death rewards and general game/role/precedent rule execution remain open. Old records with already-discarded metadata are not reconstructed. This is a fail-visible safeguard, not completion of custom passive automation. The native browser handoff is skipped for this quiet background audit.
