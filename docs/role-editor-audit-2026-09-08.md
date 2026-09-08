# Role editor preservation audit — September 8, 2026

## Confirmed defects

The actual beginRoleEdit → roleFormValues path rebuilt mode IDs on every save. Even a notes-only edit discarded imported resource pools, ability-use limits, investigation overrides, source provenance, review warnings and parts of switching rules. It also collapsed multiple role-wide passive links to the single primary passive. Seven of eight initial regressions failed before the repair.

Primary active/passive dropdowns could reference an ability not selected in the role's encyclopedia ability list.

## Repair

The existing parser now accepts the role being edited. It compares editable fields with that role's rendered baseline, applies only deliberate changes, and retains stable IDs and non-displayed metadata for same-name modes. Reordering preserves identities. Added modes receive the current role namespace. Explicitly removed displayed properties are cleared, and changing a cooldown discards the old numeric duration before normalization.

The formatter includes restrictions and safely encodes multiline scalar text. The existing form passes its current role to the parser, retains other selected role-wide passives and validates primary ability membership. No database structure, resolver mechanics or Edge Function change was needed.

## Verification

- Ten new tests include actual application form functions executed in a VM, no-op and notes-only editing, current player mode references, multiple passives, edited and removed rules, multiline text, mode reordering, cooldown changes, unknown/deselected abilities and input immutability.
- All 427 JavaScript tests passed, zero skipped, using the supplied Transformers DOCX.
- An authenticated rollback-only cloud test used the actual form output with public.create_game and public.save_game_document. Rereading preserved the complete role JSON and unchanged player state; stale saves were rejected. Its synthetic game was verified absent afterward.
- Live Transformers remained Night 1, document version 192. No live actions, player state, uploaded files, accounts or AI precedents were changed.

## Limits / remaining work

This is application-function plus actual database coverage, not browser-rendered end-to-end editing. Renaming a mode is still interpreted as removing/adding a mode, not an identity-preserving rename. Existing damaged definitions are not reconstructed automatically. Broader audit work remains incomplete.

## Follow-up: cross-game role templates

Seven of eight initial actual-handler regressions failed: the template loader dropped Basic/Standard type, slot count, modes, starting mode and policy, silently omitted missing destination abilities, and accepted ambiguous name matches. A Basic template could not be added without manually correcting its type. This was a distinct path from game duplication.

The existing loader now retains a game-scoped pending template, remaps its required abilities through the destination encyclopedia, and uses the existing mode-copy and editor-preservation functions. It retains role type, slots, mode mechanics and multiple passives, preserves intentional pre-save edits, and refuses missing/ambiguous mappings with an actionable message. The pending template is cleared on cancel, game reset and existing-role edit. Its destination is checked again before save. A UI-only authorization guard prevents read-only users from loading editable template state; existing database authorization is unchanged.

Eleven tests execute actual template loading, form validation, normalization and Add Role handlers. An authenticated rollback cloud test persisted both Standard and Basic outputs through the existing create/save functions and reread exact role JSON. Both synthetic games were verified absent. All 441 JavaScript tests pass, zero skipped, with the actual Transformers DOCX; syntax and static build checks pass. No database migration, Edge Function change, paid AI call or live game mutation was needed.

## Follow-up: duplicated game mode references

The actual cloneSetup function created new ability IDs but retained old IDs in mode ability lists and role-wide passives. A synthetic reproduction found four orphan references. No real game was duplicated for reproduction.

The existing mode module now maps copied mode active/passive IDs, primary context ability IDs, role-wide lists, starting mode IDs, switch-target mode IDs and ability-keyed counters to the fresh setup. Source text and unrelated mechanics remain intact; source game/player progress is not mutated.

Three actual cloneSetup VM tests cover reference closure, retained mechanics and source immutability. A rollback-only authenticated public.create_game test persisted its generated payload and verified that every copied mode/wide ability reference belongs to the copied encyclopedia and that the starting mode exists. Its synthetic game was verified absent afterward. The resulting suite has 430 passing tests, zero skips. No database migration or Edge deployment is required.
