# Consolidated AI GM Audit

Audit date: 2026-08-11  
Implemented release: 9.3.0

## Already complete before this release

- Central server-side OpenAI Responses provider with configurable Terra/Sol models and no browser API key.
- Owner/GM authorization, game-scoped RLS, authoritative saved-game retrieval, versioned official documents, hybrid retrieval, citations, and persistent AI conversations.
- Exactly 32 stable standardized abilities, game-scoped versions, and role-specific modifiers.
- Extensible live player statuses, visibility, history, manual GM controls, AI status grounding, audited writes, and Realtime.
- Existing game audit history, optimistic game-document saves, invitations, roles, abilities, rules, and multi-GM presence.

## Incorrect implementation fixed

- The Action Queue sorted categories into a universal order (Block, Control, Protection, Investigation, Harm, Save). Neither the ability encyclopedia nor an active action-resolution document authorized that order. Sorting and the visible priority list were removed. Submitted order is now only display/input order; resolution order requires official authority, applicable precedent, or a GM decision.

## Added in 9.3.0

- Immutable Resolution Sessions with action/status/source snapshots and structured resolution events.
- AI proposal persistence plus GM approve, modify, reject, manual resolution, explanation, optional teaching, and concurrency-safe finalization.
- One GM Precedent system with normalized signatures, game isolation, similarity ranking, conflicts, scopes, lifecycle management, repeated-use data, and transparent AI citations.
- AI Learning dashboard, natural-language precedent retrieval through the AI, official-rule prefilling, role/ability drafts, evidence-only interaction matrix, and owner-only usage controls.
- Durable usage reservation/completion records and estimated Terra/Sol costs using a stored pricing snapshot.
- Explicit RLS, grants, private transactional helpers, server-only persistence RPCs, Realtime publication, and audit records for new entities.

## Deliberately not automatic

- AI never finalizes or directly mutates a Resolution Session.
- Final resolutions do not silently apply deaths, conversions, or statuses to live state; the GM uses the existing validated proposal/status controls after review.
- Manual resolutions become precedents only when "Teach AI" is selected.
- Precedents never silently become official rules and never override newer official authority.
- No fine-tuning or external training export occurs automatically.
- No undefined ability interaction or universal action order is seeded.

## Verification

- 49 executable Node tests pass; one pre-existing local acceptance test remains skipped because its optional external Transformers DOCX fixture is not part of the repository.
- Rollback-only Supabase integration tests verified session snapshots, structured events, audit attribution, precedent creation, non-GM rejection, and rejection of a second finalizer. The transaction was rolled back, leaving no QA data.
- The full migration parses successfully inside a rollback-only transaction.
