# Source-evidence review warnings — September 8, 2026

## Reproduced problems

The production review query was evaluated against nine synthetic roles through the authenticated create-game/review workflow. It returned seven warnings, but only four were appropriate:

- A role with explicit passive source evidence was incorrectly labelled as missing source structure.
- A very short source was treated as evidence that a passive had been invented.
- A role with multiple already-owned abilities was flagged by a heuristic intended for unstructured single-ability roles.
- A role with a structured active ability but an unsupported passive received no passive warning.
- A role needing two independent warnings received only one because the SQL selected a single `CASE` branch.

The local review also omitted the server's faction-scope warning. Local and remote synthetic warnings used different IDs, so matching warnings could appear twice in the merged UI.

The suspected word-boundary regex failure was **not reproduced**: conditional and faction cases matched correctly in production. The defect was the predicates and single-branch selection, not broken regex escaping.

## Repair

The existing SQL review function now evaluates the three source-evidence warnings independently, using the same evidence thresholds and passive/ownership checks as the client. Structured source aliases are recognized for these heuristics. It still preserves questionable data for GM review; no passive, role, source, or ruling is removed or modified.

The existing client review queue now also emits the faction-scope warning. Synthetic warnings merge using game, role, ability and warning code, in a namespace separate from actual mechanic IDs. Stored mechanic IDs are unchanged. The server supplies the passive ability identity and warning code so its items merge with local items correctly.

## Verification

- Nine-role authenticated rollback fixture: exact six expected warnings, before- and after-migration verification; missing/unrelated identity sees no review data.
- Actual returned cloud rows plus locally generated rows through the app's real merge expression: **six independent entries, no duplicates**.
- Existing same-ID owner isolation regression still returns four reviews per game and eight across two games.
- All five successful fixture IDs were checked absent after rollback. Live Transformers stayed Night 1, version 192, with 44 alive.
- Three new JS regressions; full suite **527 passed, zero skipped**, including actual Transformers DOCX tests. Syntax checks, static production build and diff validation passed. The project's typecheck is syntax checking, not a separate TypeScript compiler.
- Production migration `20260908194645_align_source_structure_review_warnings.sql` applied. The function remains SECURITY INVOKER, with empty search path and unchanged postgres/authenticated/service_role EXECUTE permissions; anon has none. Advisors remain 43 authenticated-definer warnings, one password-protection warning and one RLS informational finding.
- Frontend release 12.2.29; engine remains 1.2.3. No Edge deployment, paid AI, live-game mutation, source-file change, or new account.

## Still open

This repairs the source-evidence heuristics, not every mechanic projection case. Idless SQL `row_number()` identities, derived-mechanic legacy aliases/empty entries, browser-native approval/advance, fresh-account and Storage HTTP flows, and remaining AI-budget controls remain part of the wider unfinished audit.
