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

## Follow-up: nested cloned mechanic references

The next audit went beyond mode lists: actual copied faction actions disappeared because their nested sourceFactionIds still identified the original faction. Copied hard role restrictions rejected the intended copied role. Nested mechanic ownership and rule mode references also retained source IDs. Three initial integration regressions failed.

The existing clone workflow now allocates all destination role, ability, faction and mode IDs before copying. A typed-reference helper in the existing mechanics module updates supported scalar/list aliases and ability/mode-keyed counters throughout the setup. It deliberately preserves ordinary text, source-document provenance and global standard IDs. It does not replace arbitrary strings.

Legacy duplicate mode IDs are resolved within their owning role. An ambiguous cross-role mode reference stops the copy before the cloud call and produces an error instead of silently choosing another role. Both cases have explicit regression coverage.

Seven new tests include actual cloneSetup followed by real effectiveFactionAbilities and validateActionTargets. A rollback-only authenticated create/read test retained exact copied entity JSON and closed the nested references. The database-reread payload was then fed back to the real availability/targeting functions: its faction action was available and the intended copied role/faction target was accepted. The fixture was verified absent afterward.

All 448 JavaScript tests pass, zero skipped, with the supplied Transformers DOCX. Syntax/static build/diff checks pass. No database migration, Edge deployment, live game change or paid provider request was needed. This covers supported typed references in whole-game duplication; single-role templates, arbitrary custom reference fields, identity-preserving mode renames and browser-rendered end-to-end checks still need further coverage.

## Follow-up: nested single-role template references (12.2.20)

Five of six initial actual-handler tests failed: nested role/ability ownership retained source IDs, and missing or ambiguous dependencies were accepted. The existing template loader now reuses the typed-reference mapper for nested self-role, related-role, ability, faction and mode references. Source-role inventory comes from the same existing RLS-protected document query; no additional privilege or endpoint was introduced.

Known referenced dependencies must have an unambiguous destination match. Failure leaves the current editor unchanged. Dependency-only abilities are mapped without granting them to the role. The source is remapped once, so overlapping source/destination IDs cannot be translated twice. Source text, document provenance, global standard IDs and unrelated named resource pools remain intact.

Ten new tests exercise actual template loading/form/save functions, missing and ambiguous dependencies, counter mappings, source immutability, overlapping IDs, unreferenced catalog items and the actual cloud loader. A rollback-only authenticated create/save/read test retained exact role JSON. Feeding that reread document into the real review and targeting functions displayed Ask and accepted the intended destination role/faction while rejecting an unrelated target. The synthetic game was verified absent afterward.

All 458 JavaScript tests pass, zero skipped, with the supplied Transformers DOCX. Syntax/static build/diff checks pass. Live Transformers remains Night 1, document version 192. No migration, Edge deployment, live game mutation or paid provider request was needed.

This does not reconstruct previously damaged roles, validate arbitrary custom fields or unknown source IDs, implement identity-preserving mode renames, or establish browser-rendered end-to-end coverage. The full audit remains incomplete.

## Follow-up: same-game Duplicate Role (12.2.21)

An actual-handler regression reproduced nested sourceRoleId still pointing to the original role, with reused mode IDs. The existing duplicate handler now assigns a fresh role and mode namespace, remaps supported self-role/mode references, and retains references to the same game's abilities, factions and other roles. It reuses the existing copy and typed-reference helpers. Original role and player assignments/current mode state are untouched.

Four actual-handler tests cover ownership and mode-link closure, unchanged external dependencies and source evidence, input/player immutability, and read-only denial. The first ownership test failed before the repair. All 462 tests now pass with zero skips and the supplied Transformers DOCX; syntax/static build/diff checks pass. This follow-up has application-function coverage, not a separate browser or cloud duplicate-handler roundtrip. Existing normal save authorization and database structure are unchanged.

## Follow-up: same-game Duplicate Ability (12.2.22)

Five of six initial actual-handler regressions failed. The duplicate retained source-ability ownership, shared nested mutable objects with the original, and reused mechanic review IDs. The real mechanicsReviewQueue therefore showed only one of two unresolved abilities. Read-only callers could also mutate their local draft through this handler, although the existing cloud save authorization prevented their upload.

The existing handler now checks canEditGame before mutation, deep-copies through the existing typed-reference mapper, remaps self-ability references, and gives copied mechanic definitions independent review IDs. Canonical and legacy mechanic representations are handled; other ability/role/mode references, original source text and global-standard provenance remain unchanged. A copied mechanic's self-owner display name follows the copy; external owner names do not. Normal copy naming, custom status and empty revision history remain intact.

Eight new tests exercise the actual handler and the real review normalizer, including shared-object isolation, independent review visibility, canonical/legacy references, external ownership, id-less mechanics, name collision handling, assignment immutability, absent selection and read-only denial. All 470 JavaScript tests pass, zero skipped, using the supplied Transformers DOCX; syntax/static build/diff checks pass. No database, browser game, account, uploaded file or paid provider operation was performed in this pass. No migration or Edge deployment is required.

Coverage is local application-function and review semantics, not a new browser/database save roundtrip. Previously copied damaged records are not rewritten automatically. Mechanic-review identity in other copy paths and the broader audit remain open.
