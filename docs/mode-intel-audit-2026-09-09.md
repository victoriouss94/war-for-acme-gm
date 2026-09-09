# Current-mode investigation audit — September 9, 2026

## Confirmed defect and repair

The project already had `resolveModeAwareIntel` in `js/role-modes.js`, with tests for investigation appearance and invisibility. The canonical night engine never called it. Basic Ask, Advanced Ask and Alignment Ask therefore returned the true faction or role even when the current mode explicitly configured another investigation result or no result.

The existing Intel stage now calls that existing helper for these three investigation types, using its normalized current mode and effective target after swaps/redirects. There is no new resolver or AI request. Ordinary answers remain the fallback, Gravedigger remains unchanged, and investigation appearance does not change the player's actual role, faction or life state.

The helper also no longer mixes result types: a role disguise is not a faction answer and a faction disguise is not a role answer. Explicit per-investigation text takes priority over generic same-type appearance. The existing explicit `invisible` setting returns `No result`. Arbitrary prose in `investigationAppearance.rules` is not newly interpreted or certified.

## Tests

- Initial suite: eleven reproduced failures and one passing ordinary/Gravedigger control.
- Fourteen final regressions pass: current mode's Basic/Advanced/Alignment appearance, generic role fallback, role/faction separation, invisibility, snake-case imported fields, current versus temporary mode, stale role-owned runtime state, Place Swap and GM cancellation/recalculation, ordinary results, blocked Intel privacy, and real editor-normalized cloud fixtures.
- Full suite: **613 pass, zero fail, zero skipped**, including the supplied Transformers DOCX. Syntax lint/typecheck, static build and diff checks pass. Typecheck is JavaScript syntax validation, not a full static type checker.
- Two isolated authenticated public database workflows pass: create → phase start → queue three investigations → snapshot → save deterministic proposal → approve → identical approval retry → advance. One fixture has explicit appearance and one invisibility. Exact final answer text and preserved snapshot appearance are asserted. Event replay is idempotent; real role/faction/life stays unchanged.
- Both workflows use real engine/editor-generated proposals with mocked-free deterministic computation and production public RPCs inside rollback transactions. This is not fresh-JWT/browser proof or a single uninterrupted browser flow. All temporary games, sessions and resolution events were verified absent afterward.

## Release and boundaries

Frontend **12.2.38**, engine **1.2.8**. Browser cache updates cover only the changed dependency chain: role-modes, player-abilities, night-engine and app. Build checks enforce those helper imports. Supabase and Postgres skill guidance was used for least-privilege authenticated rollback validation; Sites hosting instructions were consulted while preserving the existing GitHub Pages deployment target.

No database migration, Edge Function deployment, paid AI request, account creation or live game mutation was needed. Transformers remains Night 1, document version 192, 47 players, 44 alive. The browser tool failed before returning tab state in the preceding user turn; it was not repeatedly retried during this background pass.

Full audit remains **INCOMPLETE**. General passive dispatch/reward/on-death handling, late-intel causality, arbitrary rule/precedent execution, complete cost accounting/concurrency, legacy inventory and native two-GM UI verification remain open in the [coverage index](AUDIT_COVERAGE_2026-09-08.md). The appearance repair covers the explicit structured fields above, not every possible investigation rule or role-swap interpretation.
