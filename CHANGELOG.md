# Changelog

## v6.1.1 — Clearer Account Creation Feedback

- Detects Supabase's privacy-preserving repeated-signup response and directs existing users to sign in instead of claiming a new account was created.
- Explains the hosted email provider's temporary signup-email limit and recommends custom SMTP for production-scale account creation.
- Replaces raw authentication errors with actionable messages for invalid credentials and invalid email addresses.

## v6.1.0 — Complete GM Invitations

- Replaced the permanent per-game share-code shortcut with persisted, owner-created invitations.
- Added secure server-side invite generation, permission selection, expiration, usage limits, revocation, and active-invite management.
- Added atomic redemption with a locked invite row, permanent shared-game membership, and no game duplication.
- Added owner, GM, and Viewer member management with permission changes, safe removal, audit records, and realtime refresh.
- Split the Games screen into My Games, Shared With Me, and Archived Games.
- Added friendly invitation errors and server diagnostics that never log raw invite codes.
- Backfilled owner memberships and added database constraints, indexes, RLS, least-privilege grants, and regression coverage.

## v6.0.0 — Word Document Game Importer

- Added `.docx` validation, structured Mammoth parsing, and a staged review workflow.
- Added editable import previews for game information, factions, roles, abilities, rules, and parser warnings.
- Added Ability Encyclopedia matching, selective section/item import, duplicate-role review, and relationship validation.
- Added private Supabase Storage for source documents, RLS-protected import metadata, atomic import/re-import RPCs, and audit history.
- Added safe re-import comparisons and merge choices without silently deleting existing roles or other game content.
- Added editable faction details and preserved imported data in the normal game document architecture.
- Added browser smoke coverage plus automated parser, DOCX, validation, matching, comparison, static, and regression tests.

## v5.0.0 — Shared GM Collaboration

- Replaced browser-only persistence as the shared authority with authenticated Supabase persistence.
- Added game membership, invite codes, Owner/GM/Viewer permissions, RLS, server validation, and audit history.
- Added game-scoped Realtime subscriptions, presence, connection status, reconnect refresh, and debounced saves.
- Added atomic optimistic concurrency so stale writes fail instead of overwriting newer changes.
- Split Roles into a dedicated game section and expanded the role schema and editor while preserving existing fields.
- Added role search, faction/status filters, sorting, duplication, archive/restore, and safe deletion.
- Added a per-game Rules section with custom categories, visibility, ordering, duplication, enable/disable, and deletion.
- Added password and magic-link sign-in, game invite joining, cache-busted assets, and static/database tests.

## v4.0.1 — Game Creation Cache Fix

- Versioned the application JavaScript and stylesheet URLs so deployments cannot combine the v4 Games interface with stale v3 behavior.
- Restored reliable Create New Game handling after updates and ordinary browser refreshes.

## v4.0 — Saved Games and Game Management

- Added permanent game IDs and a Games management page.
- Added Active, Saved, and Archived game collections with search and sorting.
- Added isolated, lazily loaded per-game storage records under a lightweight game index.
- Added safe migration from the legacy v3 single-game save without deleting the old record.
- Added autosave, manual save, last-saved status, game switching, archive/restore, and guarded deletion.
- Added fresh-setup duplication that copies configuration without players, actions, or gameplay history.
- Added per-game chronological history and game-specific settings, phase, day, theme, description, and notes.
- Added `gameId` ownership to every game-specific record during creation, import, and migration.

## v3.2 — Editable Ability Library

- Added editing for built-in and custom encyclopedia abilities.
- Added duplication for every ability.
- Added reset-to-default for built-in abilities.
- Added lightweight revision history snapshots whenever an ability is edited or reset.
- Added migration support for older ability records without revision arrays.
- Preserved all existing v3.1 game data and encyclopedia entries.

## v3.1 — Ability Encyclopedia

- Added a permanent Encyclopedia navigation tab.
- Added a seeded library of standard social-deduction abilities.
- Added definitions, categories, usual phases, and related mechanics.
- Added live search and category filters.
- Added expandable entries showing which roles use each ability.
- Added custom ability creation and deletion.
- Added migration support for v3.0 saved games.
- Added abilities to game template import and export.

## v3.0

- Generic Villager, Den, and Neutral faction engine.
- Multiple Den support.
- Factions, roles, players, action queue, statistics, and settings.
