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

This is application-function plus actual database coverage, not browser-rendered end-to-end editing. Renaming a mode is still interpreted as removing/adding a mode, not an identity-preserving rename. Cross-game role template copying and game duplication need separate mapping audits. Existing damaged definitions are not reconstructed automatically. Broader audit work remains incomplete.
