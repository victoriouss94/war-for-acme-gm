# Changelog

## v12.2.2 — Progressive Login Bootstrap

- Reduced account-profile restoration from two sequential database requests to one update-and-return request.
- Made the authenticated games screen available before the last-open game loads its larger history, status, ability, phase, AI, and knowledge datasets.
- Kept active-game synchronization and Realtime subscription running immediately in the background with an explicit loading indicator and regression coverage.

## v12.2.1 — Supabase Login Deadlock Repair

- Deferred account-profile restoration until after Supabase releases its authentication callback lock.
- Preserved same-session coalescing so password sign-in and auth notifications cannot duplicate profile requests.
- Added regression coverage for the non-blocking authentication callback and refreshed the public cloud-client cache key.

## v12.2.0 — Canonical Night Resolution Repair

- Extended the existing `resolveNightDeterministically` pipeline instead of adding a second resolver.
- Added deterministic Capture, temporary Role Swap context, structured Steal use removal, and declared/persisted Duel outcomes.
- Corrected diagnostics so they count only AI adjudications actually consumed by the engine; standardized nights report zero AI fallback calls.
- Added one structured morning result with deaths, survived attacks, statuses, intel, conversions, generated effects, and proposed state.
- Made Player / Action / Result the primary full-roster preview, with detailed cards, diagnostics, GM editing, recalculation, and atomic approval retained below it.
- Added a comprehensive known-mechanics acceptance night covering every resolution stage, passives, generated effects, mode defenses, state calculation, and zero-AI operation.

## v12.1.2 — Auth Event Performance

- Treat background token refreshes and repeated same-user sign-in notifications as session updates instead of full application logins.
- Ignore the duplicate initial-session event because startup already restores and validates that session explicitly.
- Coalesce concurrent profile restoration for the same access token into one database request.

## v12.1.1 — Login Performance

- Render only the visible application screen instead of rebuilding every hidden game-management screen after login and each live update.
- Removed the redundant full active-game reload that ran immediately after the Realtime channel subscribed.
- Preserved on-demand rendering, live updates, authorization, game data, and the existing Supabase structure.

## v12.1.0 — Tracker-Style Night Resolution Review

- Replaced the separate Master GM report presentation with the existing player-tracker card layout for night-resolution review.
- Shows every roster entry in tracker order, including no-action players, with current live state beside the proposed night state.
- Keeps submitted actions visually secondary to structured final outcomes, causes, intel results, target changes, modes, statuses, deaths, survivals, and conversions.
- Added per-result editing shortcuts, affected-result recalculation, and the existing atomic Approve & Apply action at the bottom of the tracker review.
- Generates morning-summary counts from the structured proposed state without applying or inventing live changes.

## v12.0.0 — Deterministic Night Resolution Engine

- Made the staged rule/event engine the primary night resolver across Blocks, Guarantee, Control, Swaps, Redirects, Status Effects, Intel, Converts, Kills, and Doc, with passives and generated effects handled automatically.
- Added immutable simulation snapshots, proposed state, replayable random outcomes, resolution traces, isolated AI adjudication for unknown mechanics, GM correction recalculation, and additive Supabase persistence.
- Replaced the default full-night AI workflow with Resolve Night while preserving editable GM review and the existing atomic Approve & Apply transaction.
- Upgraded document normalization to store executable encyclopedia behavior and flag unknown source text as `NEEDS_RULE_MAPPING` instead of inventing rules.
- Added deterministic unit, migration, importer, replay, multi-mode, passive, generated-effect, correction, and full-night acceptance coverage.

## v11.9.0 — Guaranteed Structured Master GM Rulings

- Enforced a complete resolution contract at the Edge Function boundary, including an explicit status, phase, Master GM ruling, one final result per queued action, readable names, player outcomes, and unresolved questions.
- Added one targeted structured repair attempt for malformed, partial, missing-action, unknown-player, or mode-as-ability AI results; invalid repaired output becomes a visible Resolution Error with affected actions and retry.
- Replaced free-form AI presentation with fixed Master GM Ruling, action, player outcome, death, conversion, intel, status, usage, passive, generated-effect, and transformation components.
- Disabled Approve & Apply until the structured draft passes completeness and consistency checks while preserving the existing editable GM ruling and learning-diff workflow.
- Added focused regression coverage for all 25 requested resolution scenarios.

## v11.8.0 — Global Role Configurations

- Generalized role modes into arbitrary document-defined configurations, forms, states, phases, and stances without game-specific names or a fixed count.
- Added rich role editing for configuration-specific active/passive abilities, defenses, restrictions, investigation appearances, uses, shared resources, switching conditions, one-way states, and cooldowns while keeping role-wide mechanics separate.
- Added authoritative player configuration state, temporary multi-configuration access, manual GM changes, Realtime updates, and immutable transition history under existing authorization and RLS.
- Made the Action Queue configuration-aware: current and temporary abilities are available, permitted pre-action switches are atomic, inactive configurations are rejected, and queued actions preserve readable configuration context.
- Extended AI document analysis and approved Master GM rulings to preserve hierarchical configuration data and apply explicit `MODE_CHANGE` effects through the same audited approval transaction.
- Added 35 focused configuration tests and retained the complete existing test suite.

## v11.7.2 — Collision-Safe Mode Action Queue

- Fixed the production multi-mode action validator after its `player_id`, `ability_id`, and `mode_id` locals collided with database column names.
- Preserved the existing authorization, phase locking, action validation, role modes, abilities, and queued-action data.
- Added a production-shaped rollback probe and regression coverage for the mode-aware action queue.

## v11.7.1 — Complete Transformers Role Modes

- Re-read the exact uploaded Transformers DOCX (SHA-256 `81427a…aa04`) and rebuilt all 27 source-defined Robot/Alt mode roles against the existing Master Ability Encyclopedia.
- Corrected Optimus Alt Mode, Kup Place Swap, and every remaining imported mode relationship while retaining the source text for role-specific overrides.
- Preserved all 39 existing roles (including both Basic roles), 50 players, 101 ability records, legacy import records, and stable role/player IDs.
- Updated DOCX acceptance coverage so vehicle modes remain context and never become fake selectable abilities.

## v11.7.0 — Multi-Mode Action Context

- Separated role modes from selectable actions with the required Player → Mode → Ability → Target → Queue flow.
- Added role-wide, mode-specific, passive, current-mode, and temporary multi-mode access filtering plus server validation for distinct mode and ability IDs.
- Relinked the source-backed Ironhide, Ratchet, and Optimus mode mechanics without deleting legacy import records, actions, players, comments, or audit history.
- Updated the role editor and AI Word importer to persist Role → Mode → Ability relationships instead of creating abilities named after modes.

## v11.6.3 — Collision-Safe Action Queue

- Fixed the universal role-understanding Action Queue validator after it reintroduced ambiguous `player_id` and `ability_id` PL/pgSQL locals.
- Preserved the integrated phase lock, authorization, target validation, faction actions, grants, cooldowns, and existing queued-action data.
- Added a production-shaped rollback test for the public queue RPC and regression coverage for future migrations.

## v11.6.2 — Reliable Master GM Responses

- Expanded the structured action-resolution response budget and reduced duplicate prose so complete rulings fit the strict Master GM schema.
- Added explicit handling for truncated, filtered, refused, empty, failed, and malformed Responses API results instead of reporting every case as an unreadable result.
- Preserved the safety guarantee that failed AI responses do not modify the game or save a proposed ruling.

## v11.6.1 — Human-Readable GM Outcomes

- Changed normal Player Outcomes to the required `Player Name — Final Faction Name` format without `UNCHANGED` or database identifiers.
- Added deterministic entity hydration and UUID masking across Master GM rulings, action history, phase history, ability usage history, and related resolution summaries.
- Preserved stable IDs in structured resolution data while giving the AI explicit player, faction, role, ability, and target display metadata.
- Updated finalized Resolution Sessions to show the final GM-approved outcome rather than continuing to present the earlier AI proposal.

## v11.6.0 — Global Master Ability Resolution

- Replaced the legacy no-order behavior with the global `BLOCKS → GUARANTEE → CONTROL → SWAPS → REDIRECTS → STATUS EFFECTS → INTEL → CONVERTS → KILLS → DOC` profile.
- Expanded the versioned global encyclopedia to 37 standardized abilities, including Den Block, Villagers Block, Place Swap, Role Swap, and Redirect.
- Added category, priority, timing, authority, original/effective targets, transformation history, generated-child lineage, and passive-trigger metadata to queued actions and approved events.
- Updated Word import and Master GM prompts to map semantic wording while preserving source text and higher-authority game/role overrides.
- Added additive RLS-protected database metadata, automatic global dataset activation, and server-side classification/order validation.

## v11.5.0 — Master GM Ruling, Approval & Usage Tracking

- Added a firm, schema-v2 Master GM ruling contract covering action outcomes, final targets, passives, statuses, life/role/faction outcomes, grant changes, authority, and confidence.
- Replaced the primary three-way resolution workflow with one editable **Approve & Apply** path while retaining reject as an advanced internal close state.
- Added structured GM editing for action order/results/targets, consumption and refunds, redirects/reflections, passives, player outcomes, statuses, grants, cooldown notes, faction-wide affected players, and other effects.
- Added a permission-checked, lock-versioned, idempotent Supabase transaction that validates references, preserves the AI proposal and structured differences, rebuilds official events server-side, applies live state/status/grant changes, updates the phase queue, and writes audit history.
- Added player, role-owned, ability, faction, passive, phase, and source-aware usage analytics. Attempts are deduplicated by stable action ID; official results come only from the final GM ruling.
- Preserved role ID/version and source attribution at action time so later role changes and reward abilities cannot rewrite role-owned history.

## v11.4.0 - Universal Role, Ability, and Passive Understanding

- Preserves complete source text and splits compound role text into independently reviewable structured mechanics.
- Adds explicit active, passive, immunity, trigger, faction, global, targeting, eligibility, confidence, origin, and unresolved-component fields without replacing custom identity with a standard ability.
- Treats faction and global actions as first-class queue attempts, including source-defined performer eligibility and Den Block-compatible status semantics.
- Adds a source-backed Mechanics Needing Review queue and action-ID-deduplicated per-game and authorized cross-game ability/passive usage history.
- Extends resolution events for ineligible effects, cancellations, prevented passives, and refunded uses while retaining GM-only finalization and learning approval.
- Re-import remains additive and never automatically deletes existing roles or mechanics.

## v11.3.0 - Integrated Action Queue and Game Phase Controller

- Adds one authoritative, concurrency-locked current phase and phase-scoped action queue per active game.
- Integrates start, pause/resume, resolution, reviewed advance, history, summaries, results, and event logs into Action Queue.
- Preserves completed phases as read-only history with owner-only reasoned corrections and explicit audit events.
- Applies deterministic status/grant expirations and timer decrements during approved transitions, then opens the correct next Day/Night queue.
- Gives the Master GM the same phase context and approval-required phase tools while blocking generic AI day/phase rewrites.

## v11.2.0 - Dynamic Player Abilities and Structured Action Queue

- Adds an RLS-protected, append-history player ability grant relationship referencing the existing game Encyclopedia.
- Calculates effective Role and player-specific abilities with remaining uses, phase/cooldown availability, live status warnings, Additional Uses, Ability Amplify, and role modifiers.
- Replaces free-text action entry with searchable player, ability, and structured target pickers while preserving the existing `data.actions` queue and Resolution Sessions.
- Adds audited grant, revoke, expire, use-adjustment, batch-grant, server-randomized reward, queue/edit/remove, and transactional resolution-consumption RPCs.
- Extends Master GM context and deterministic browser orchestration for ability inventory, grant/revoke, and action-queue requests.

## v11.1.0 - Basic Roles and Reviewed Roster Assignment

- Adds explicit Basic Roles with zero abilities, a separate incomplete-data state, and reusable role-slot counts.
- Imports player names from paste, TXT, CSV, or DOCX with duplicate, existing, removal, and rename previews.
- Adds GM-only server-randomized assignment previews with locks, faction constraints, shuffling, shortage validation, active-game confirmation, and per-player audit history.
- Extends Word analysis and the Master GM with Basic Role safety and deterministic roster questions without model-generated randomness.

## v11.0.0 - Document-Driven Master GM and Global Settings

- Makes imported Word documents the source for game structure, including roles, abilities, rules, statuses, special mechanics, relationships, modifiers, conflicts, ambiguities, and source locations.
- Adds owner-scoped Global Settings with immutable rule versions, GM-only editing, concurrency checks, audit history, and dynamic current-game overrides without copying global rules into game documents.
- Resolves each AI ruling from current-game rules first, then versioned global fallbacks, standardized abilities, compatible precedents, and finally a clearly marked GM decision.
- Snapshots exact Global Settings and standardized-ability versions in Resolution Sessions, and requires explicit GM approval for every AI-proposed global change.
- Retires whole-game AI generation while preserving historical drafts as audit records and keeps invited viewer loading separate from GM-only AI data.

## v10.0.0 - Full Interactive Master GM Agent

- Extends the single Master GM assistant with natural intent detection, exact entity resolution, conversation context, and controlled server-side tool traces.
- Adds permission-scoped AI runs, tool-call audit records, generic drafts, and atomic GM-reviewed change proposals for games, roles, abilities, factions, rules, and live statuses.
- Answers exact live-status questions directly from the authoritative database without spending AI tokens and opens existing Resolution Sessions for action-resolution requests.
- Retrieves only relevant current-game documents, rules, ability versions, statuses, precedents, historical resolutions, audits, and compatible authorized cross-game knowledge.
- Restricts AI conversation visibility to owners and GMs, validates proposal targets and fields on the server, and keeps all writes pending until an authorized GM approves them.

## v9.5.0 - Global Learning Default

- Makes Global — All Games the default for every newly taught ruling, including GM modifications and rejections, while keeping current-game authority first.
- Adds game-, ability-, role-, and one-time alternatives with a compatibility warning that never silently changes the GM's choice.
- Preserves historical precedent scopes, marks them for review, and adds authorized-GM bulk promotion through the existing audited precedent workflow.
- Records structured origin, ability/version, role-modifier, status, condition, outcome, and reasoning context for compatibility checks.

## v9.4.1 - Global Learning Runtime Fix

- Fixed ambiguous database owner references in learning summaries and cross-game pattern retrieval.
- Ensured private Realtime game channels receive the active authenticated session before subscribing.

## v9.4.0 - Global Master GM AI

- Extends the single AI GM, Resolution Session, GM Precedent, document retrieval, live-status, and audit architectures with layered cross-game knowledge.
- Adds global precedent lifecycle controls, current-game-first retrieval, compatibility evidence, and source transparency.
- Adds GM-approved global mechanical concepts and versioned ability mappings without copying or replacing game abilities.
- Adds cross-game pattern and conflict views, explicit global-rule promotion, status/role/version-aware checks, RLS, audited mutations, and scope-preserving backfills.
- Keeps current-game rules, current ability definitions, role exceptions, and live player state authoritative; the GM remains the final decision-maker.

## v9.3.1 - Interface Encoding Hotfix

- Corrects separator, arrow, ellipsis, and numeric-range characters in the Resolution Sessions and AI Learning interfaces.
- Bumps browser asset versions so deployed clients receive the corrected JavaScript immediately.

## v9.3.0 - Consolidated AI GM Resolution and Learning

- Removes the invented category-based action priority and explicitly requires an official rule, applicable precedent, or GM decision.
- Adds immutable Resolution Sessions, structured events, manual resolution, AI proposals, approve/modify/reject review, audit attribution, and concurrency-safe finalization.
- Adds one game-scoped GM Precedent architecture with normalized signatures, retrieval ranking, conflict visibility, lifecycle controls, and optional GM teaching.
- Adds GM-reviewed AI role and ability drafts that reuse the existing editors and standardized abilities.
- Adds an evidence-only ability interaction view and owner-only AI token, cost, rate, and monthly limit controls.
- Extends Realtime, RLS, explicit grants, server-side authorization, and structured AI validation for the new workflows.

## v9.2.0 - Live Player Status Awareness

- Adds an extensible live status ledger with active, passive, pending, permanent, and resolved effect groups.
- Adds GM status controls, filters, expiration timing, visibility rules, and append-only status history.
- Grounds AI player-condition answers and action resolution in controlled live database queries rather than role abilities or chat memory.
- Applies AI-proposed status changes only after GM review through an audited server-side transaction.
- Removes the retired Courtroom source label while preserving the standardized ability definitions.

## v9.1.0 — Courtroom Ability Encyclopedia

- Replaced the built-in encyclopedia with the exact 32 abilities from the supplied Courtroom Master Ability Encyclopedia.
- Completed all 32 official descriptions instead of leaving partial placeholder definitions.
- Added a live-data migration path that preserves role links by matching standardized ability names.

## v9.0.1 — Flat DOCX Roster Import Fix

- Recovers faction rosters and role abilities from Word documents that use ordinary paragraphs and lists instead of heading styles or tables.
- Understands role-qualified Robot Mode and Alt Mode ability blocks and preserves listed roles even when their mechanics need GM review.
- Rejects empty imports so a document that produced zero factions or zero roles can no longer create an empty game.
- Preserves the complete local roster when AI analysis returns materially fewer roles, and clarifies the difference between knowledge indexing and game setup import.

## v9.0.0 — Phase 1 AI GM Knowledge and Official Abilities

- Adds persistent, game-scoped Ask GM Assistant conversations with cited authoritative sources.
- Adds private DOCX/PDF/TXT knowledge uploads, immutable document versions, hybrid full-text/vector retrieval, and source locators.
- Imports exactly 32 stable Courtroom standardized ability IDs without attaching them to or changing existing games.
- Preserves supplied definitions and explicitly marks 15 abilities as needing source text instead of inventing mechanics.
- Adds explicit dataset activation, game-scoped ability-version editing, role-specific modifier versions, and a read-only reconciliation report.
- Centralizes OpenAI model configuration and keeps AI-generated persistence behind authenticated Edge Functions.
- Removes permanent role deletion; roles remain editable and archivable.

## v8.0.0 — Secure AI GM Copilot

- Adds a game-specific AI GM interface with Terra standard and Sol deep reasoning modes.
- Grounds rulings in the authoritative cloud save, including roles, linked abilities, rules, players, factions, phase, history, and action queue.
- Adds structured action resolution, confidence, ruling references, warnings, follow-up questions, and allowlisted proposed changes.
- Requires an explicit owner/GM confirmation before a validated proposal can mutate or save game data.
- Adds an authenticated Supabase Edge Function with membership checks, RLS context, request bounds, per-user rate limiting, origin restrictions, secret isolation, and disabled OpenAI response storage.
- Revokes the previously exposed API credential and uses a backend-only service account key stored in Supabase Edge Function secrets.

## v7.0.0 — Permanent Username Accounts

- Replaces email and temporary-device sign-in with permanent username/password registration and login.
- Enforces case-insensitive unique usernames, 3–30 character validation, and an 8-character password minimum.
- Keeps password hashing, salts, refresh-token rotation, and login throttling inside Supabase Auth; no application table stores password material.
- Adds persistent session restoration through IndexedDB instead of `localStorage`, complete logout state isolation, and deleted-session validation.
- Adds an account menu, account summary, password change with current-password verification, and revocation of other sessions.
- Preserves Owner/GM/Viewer memberships, database-backed saved games, invitation redemption, authenticated audit identity, and private Realtime channels.
- Grandfathers existing anonymous device accounts only for their existing memberships and provides an in-place username/password upgrade without copying or reassigning games.
- Disables new anonymous sign-ins and keeps email confirmation off because users never provide an email address.

## v6.2.1 — Deleted Session Cleanup

- Validates persisted browser sessions against Supabase Auth during startup.
- Immediately clears cached tokens for accounts that were deleted or revoked on the server.

## v6.2.0 — No-Email GM Accounts

- Adds a one-click, no-email GM account backed by Supabase anonymous authentication.
- Keeps email/password sign-in available for users who want a recoverable account.
- Warns before signing out of a no-email account because it cannot be recovered after the browser session is removed.
- Disables mandatory email confirmation and enables anonymous sign-ins in the hosted Supabase project.

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
