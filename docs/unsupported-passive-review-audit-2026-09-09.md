# Unsupported passive review audit — September 9, 2026

Release: frontend 12.2.40; canonical engine 1.2.9. Full technical audit remains **INCOMPLETE**.

## Reproduced defect and repair

A role with a custom on-death passive could produce RESOLVED even though the deterministic engine had no implementation for that passive. The initial engine regressions produced six failures and three passing controls. The current tracker renderer also omitted unresolved questions and considered a resolution complete whenever no submitted action was PENDING.

The existing engine now adds named GM-review questions for unsupported declared passives of starting-alive owners, including linked abilities, current/temporarily accessible modes, missing links, and unnamed structured entries. It retains one result per submitted action and does not invent rewards, passive triggers, or fake submitted actions. Passive-only questions are not sent as active-action AI adjudication requests. Known implemented passive identities remain automatic; inactive modes and unowned catalog entries create no review noise. A recognized name in a field the engine does not execute is still reviewed.

The existing tracker screen now displays escaped review questions and disables its Approve & Apply button while questions, GM_REVIEW_REQUIRED status, or RESOLUTION_ERROR status remain. The existing editor/final payload retains the questions. A GM can record the source-grounded ruling, clear resolved questions and set a resolved status using the existing editor. No schema or Edge Function change was required.

## Verification

- Full JavaScript suite: **644 passed, zero failed, zero skipped**, including actual supplied Transformers DOCX parsing. Nineteen new tests exercise the engine, actual tracker renderer, review model and existing editor payload.
- Syntax scripts, static build checks and whitespace checks pass. Syntax scripts are not full TypeScript analysis.
- An authenticated-role public-RPC transaction created a synthetic game, queued two ordinary actions, created a snapshot and saved the actual local engine proposal containing a custom passive question. The snapshot retained the role link; the saved proposal and simulation revision retained the question and GM_REVIEW_REQUIRED status. Saving changed no game document. The transaction was rolled back.
- Post-rollback queries found zero fixture games, sessions or resolution events. No paid AI calls or accounts were created.
- Live Transformers was read only: document 192, Night 1, 47 players, 44 alive. No restart, simulation approval, role edit or phase advance was performed.

The database fixture uses authenticated database privileges with test claims, not a fresh browser JWT. It verifies proposal persistence, not a complete browser approval cycle. The actual JavaScript renderer is executed in a test context; native visual verification remains outstanding. Official [Supabase testing guidance](https://supabase.com/docs/guides/local-development/testing/overview) informed transaction isolation and explicit role selection.

## Remaining boundaries

This is a **fail-visible review repair**, not a general custom-passive executor. Arbitrary event dispatch, on-death rewards, custom conditions, dependency ordering and unsupported prose still require a GM ruling. The conservative check may request review even when a custom passive would not trigger that night; the engine must not guess its condition. Previously saved proposals are not retroactively rewritten. Continue with the outstanding accounting, rule-priority, causal-order and browser-workflow areas in the [coverage index](AUDIT_COVERAGE_2026-09-08.md).
