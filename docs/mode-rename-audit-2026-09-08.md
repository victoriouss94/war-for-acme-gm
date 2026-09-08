# Configuration rename audit — September 8, 2026

## Actual failure

Changing `[Alt]` to `[Guarded Form]` in the existing role editor created a new configuration ID instead of renaming the old one. The old ID disappeared, the starting mode changed, and non-displayed rules such as resource pools, use limits and transition costs were dropped. Current player mode, temporary access and cross-mode transition references could therefore point at a missing configuration. All three initial actual-form/parser regressions failed before repair.

## Existing editor repair

The existing text formatter now adds a readable `edit reference` line using the original configuration name. Renaming the heading while retaining that line preserves the underlying identity and merges only edited fields. It does not show raw identifiers or persist editor-only metadata. Reordering and swapping display names remain unambiguous. Each subsequent edit regenerates the reference from the saved name.

The same parser rejects unknown, empty, repeated and duplicate references/identities. Creating a new configuration requires omitting the reference; a short instruction beside the existing editor explains this. Older text without references remains supported by the previous name-matching behavior. There is no heuristic guessing based on block position or similar mechanics.

No role/mode database structure or engine was duplicated. No historical names, player states or runtime rows were rewritten.

## Verification

- Nine regressions cover the actual role form, rename + reorder, repeated rename, name swaps, quoted names, metadata retention, duplicate/invalid references, new copied blocks and legacy text.
- Full suite: **524 passed, zero skipped**, including actual Transformers DOCX tests.
- Authenticated rollback workflow used the actual form's saved role: create game, start Night 0, initialize current mode, grant temporary access, rename/save/reload, reject stale save, and queue the renamed mode's ability. The entire runtime row remained identical (current mode, access, cooldowns and version), and the queued action retained its mode ID while showing `Guarded Form`.
- Fixture `0a4b7f1f-4160-4940-9538-a1ef36d5eed4` was rolled back; no live game was altered.
- Release 12.2.28. Canonical engine remains 1.2.3. No database migration, Edge Function deployment or paid AI was needed.

This is real form-handler and authenticated database-function integration coverage, not browser-native editing or a fresh-login HTTP test. The full technical audit is still in progress.
