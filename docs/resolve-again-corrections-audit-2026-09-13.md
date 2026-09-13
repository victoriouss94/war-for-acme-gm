# Resolve-again correction preservation audit — September 13, 2026

## Reproduced workflow defect

The actual Resolve handler always called the deterministic engine directly. After a GM saved a recalculation, clicking Resolve again reconstructed the original actions, discarding the saved cumulative action overrides and added rule context. A cancelled attack could become lethal again and regenerate its Counterattack consequence. A corrected destination could revert to its original target.

Three actual-handler tests reproduced the defect: saved cancellation, saved retargeting, and saved rule additions. A fresh-resolution control continued to pass.

## Existing-path repair

Resolve now uses the existing recalculateNight path when the saved proposal contains recalculation metadata. That preserves its cumulative overrides, rule additions and recorded random outcomes. The same path is used for the second pass after an isolated unknown-interaction response. Fresh proposals still use the original deterministic engine directly.

No second resolver, automatic approval, reset operation, database contract or custom-passive interpreter was added. Resolve again is not treated as authorization to erase saved GM corrections.

## Runtime evidence

Six added tests execute the actual browser Resolve handler with real engine/editor modules and mocked save/provider boundaries:

- Saved cancellation retains no deaths and no generated retaliation.
- Saved retargeting kills only the corrected target and removes the original Counterattack dependency.
- Saved GM rule additions survive.
- The unknown-interaction second pass preserves cancellation and remains GM_REVIEW_REQUIRED when no interpretation is accepted.
- Two serialized save/reload/re-resolve cycles retain two cumulative rule additions exactly once.
- Fresh resolution still executes the original attack and retaliation without inventing correction metadata.

The expanded tracker workflow file has 26 passing cases; the full JavaScript suite has **1,046 passes, zero failures and zero skips**, including the supplied Transformers DOCX. Existing known-mechanic fixtures make zero AI calls; the unknown-response test uses a mock, not a paid provider call. Tests preserve the source session object.

Frontend **12.2.68**; canonical engine **1.2.26** and backend functions are unchanged. Standard JavaScript syntax/static-build checks apply; native browser and actual database save/reload proof are not supplied by these mocks. No live game was read or modified.

## Remaining boundaries

This preserves already-saved engine recalculations. It does not implement arbitrary manual player-outcome edits, custom on-death passives, unsaved-edit recovery or an explicit reset-to-original workflow. Historical proposals are not rewritten. The complete audit remains **INCOMPLETE**; see the [coverage index](AUDIT_COVERAGE_2026-09-08.md).
