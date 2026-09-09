# Custom identity import-to-resolution audit — September 9, 2026

Frontend 12.2.45, canonical engine 1.2.13. No database migration, Edge Function update or live game mutation. Full technical audit remains **INCOMPLETE**.

## Reproduced defects

The existing understanding normalizer ignored top-level customIdentity/custom_identity and the STANDARD_BASE_WITH_CUSTOM_IDENTITY mapping when no nested flag was supplied. It could also replace an explicit false flag with an inferred value.

Separately, a stored custom identity linked to a standard base could execute the base kill even though its additional source condition was not implemented. An exact standard mapping identifies the known part of an ability; it is not evidence that its custom differences have been resolved. Seven initial runtime regressions failed.

## Repair

The existing normalizer now preserves nested or top-level identity flags, including explicit false, and recognizes the existing standard-base custom mapping. Nested explicit values retain precedence.

In the canonical engine, a true custom identity without a reviewed executable primitive enters the existing CUSTOM review path rather than silently executing its standard base. An inferred/default standard behavior does not count as review. Existing explicit executable behavior with requiresExplicitRule:false, per-action GM reclassification and supported isolated adjudication retain their normal paths. Plain renamed standard abilities remain deterministic and do not acquire a custom-review requirement.

No new rule compiler or engine was created. Custom source text, conditions, names and standard-base identity remain intact.

## Verification

- **718 JavaScript tests passed, zero failures/skips**, including extraction of the supplied Transformers DOCX.
- Fifteen new regressions cover camel/snake top-level flags, nested precedence, explicit false, existing mapping inference, both custom-named and exact-standard-named AI import records, stored custom identities, inferred versus explicitly reviewed behavior, blocking, GM reclassification and supported isolated adjudication.
- A runtime pipeline executes the actual AI-import normalizer, the actual frontend materializeAbility function and the canonical resolver. A conditional source ability retains its identity and source text, and cannot cause a death through an unreviewed standard-base fallback. These tests use synthetic parsed input, not a paid AI call or live import.
- Existing renamed-standard, custom-primitive, passive and late-Intel tests still pass. JavaScript syntax, static build and diff checks passed.
- The changed mechanics-to-importer/player-abilities/app dependency chain was versioned and validated; unchanged role-mode, classifier, cloud and review modules kept their existing cache versions.

## Limits

This guard does not interpret arbitrary conditions, implement all role/game/precedent modifiers or prove a full priority matrix. It relies on preserved typed custom-identity metadata or existing explicit CUSTOM behavior. Old records whose custom metadata was already discarded cannot be reconstructed automatically from this patch; source-preserving reanalysis remains a separate task.

No roles, player assignments, phase, uses, actions or history in the live Transformers game were edited. Full browser collaboration/approval, complete AI cost accounting, custom passive rewards and retired-path review remain open.
