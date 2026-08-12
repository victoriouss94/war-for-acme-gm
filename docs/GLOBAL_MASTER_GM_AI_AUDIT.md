# Global Master GM AI Audit

Audit date: 2026-08-11  
Implemented release: 9.4.0

## Existing systems reused

- The single `gm-copilot` Edge Function and shared OpenAI Responses service remain the only AI provider path.
- Existing Resolution Sessions remain the immutable source of submitted actions, pre-resolution state, final outcomes, approvals, and source versions.
- Existing `gm_precedents` remains the only learning/precedent store.
- Existing official documents/chunks and `match_game_knowledge` remain the only document retrieval pipeline.
- Existing player-status effects/history remain the only live-state authority.
- Existing saved-game roles, abilities, official ability versions, role modifiers, permissions, `change_history`, and Realtime channels are reused.

No duplicate precedent, resolution, status, audit, document-retrieval, or AI architecture was found or created.

## Systems extended

- `gm_precedents` now supports explicit global approval, global official-rule authority, origin snapshots, compatibility/fingerprint metadata, normalized actions, mapped global concepts, source precedents, and AI-correction metadata.
- `resolution_sessions` now records whether an approved ruling was taught to this game or all compatible games and which precedents the AI used.
- Official documents now distinguish current-game, GM-approved global, and system-global scope without copying document content.
- The existing precedent search now retrieves layered current-game and global candidates, enforces role/ability/one-time isolation, and ranks current-game precedent above global authority.
- The single AI request pipeline now performs status-, role-, mapping-, and version-aware compatibility checks, excludes incompatible global precedent, and returns transparent global-source metadata.
- The existing AI Learning dashboard now includes scope filters, global counts, cross-game patterns/differences, global concepts, versioned mappings, promotions, downgrades, and lifecycle controls.

## New schema used only for a genuinely new domain

Migration: `20260812024815_global_master_gm_ai.sql`

- `global_ability_concepts`: owner namespace for GM-approved reusable mechanical concepts.
- `ability_concept_mappings`: versioned, audited links from existing game abilities to concepts with `EXACT`, `STRONG`, `PARTIAL`, or `INCOMPATIBLE` compatibility.

These tables do not duplicate or replace any game ability. Existing ability definitions remain authoritative.

## Authority and compatibility behavior

Resolution context is ordered as current-game rules, current-game abilities, role modifiers/special mechanics, current-game rulings/precedents, global official rules, global approved precedents, AI interpretation, then the GM final decision. Live player state is always loaded separately from the current game.

Global candidates are checked against approved ability mappings, important statuses, role-specific conditions, and source ability versions. Incompatible candidates are removed. Partial candidates are advisory and must not be treated as conclusive. Same names alone never establish compatibility.

Teach AI defaults to `GAME_SPECIFIC`. `GLOBAL` requires an explicit authorized-GM choice and cannot be used for role-specific or one-time rulings. Global promotion, downgrade, lifecycle changes, mapping approval/removal, and pattern promotion use the existing permission system and audit log.

## UI changes

- Teach This Game / Teach All Games audience selector on existing Resolution Session review.
- Current/global scope on the existing official-document uploader.
- Global/current/specific/conflicting/superseded filters on the existing AI Learning view.
- Cross-game consistent-pattern and rule-difference panels with explicit promotion.
- Global ability concept and mapping review within the same dashboard.
- Global knowledge counts, compatibility, origins, authority, overrides, and conflicts in AI responses and citations.

## Verification

- JavaScript syntax linting, static build verification, and the full Node test suite cover default scope, global scope, retrieval order, current-game precedence, role/ability/one-time isolation, mappings, incompatible rejection, version/status compatibility, permissions, audits, promotions, superseding, and duplicate-architecture detection.
- The migration is designed as additive/backfilled DDL and in-place RPC replacement. It does not reset games or delete existing precedents, resolutions, statuses, documents, abilities, or audit history.
- One optional external Transformers DOCX acceptance test remains skipped because the fixture is not part of the repository; all repository-contained tests run.

## Remaining boundaries

- Cross-game pattern detection is computed from approved precedent history; no automatic promotion occurs.
- The AI is retrieval-based. No automatic fine-tuning or external training-data sharing was added.
- The GM must still finalize resolutions and explicitly approve any state changes.
