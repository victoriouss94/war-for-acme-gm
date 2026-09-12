# Declared defense review

Frontend 12.2.62; canonical night engine 1.2.26. The full technical audit remains **INCOMPLETE**.

## Actual defect

The existing mode editor accepts named immunity/protection rules. The engine's unsupported-passive review collected these declarations only when they already carried recognized custom/conditional metadata. Plain strings and minimally structured names could therefore be ignored: an unknown defense such as `Moon Ward` produced a lethal proposal labeled RESOLVED with no question for the GM. This was not merely a missing prose interpreter; the existing safety/review path incorrectly certified an unimplemented source rule.

Eight regressions reproduced the omission, with three passing controls: player/role/mode immunities, role/mode protections, named structured immunity, temporary-mode defense, and the actual mode-editor parser path.

## Repair and behavior

The existing passive review collector now examines every declared immunity/protection in its existing player, role, current mode and temporarily accessible mode sources. Its existing supported-mechanic check still excludes correctly executed defenses, and its existing name deduplication prevents repeated questions. There is no replacement engine, inferred protection strength, new passive dispatcher or database migration.

Unsupported declarations now produce a named GM-review question. The known attack can still have a **provisional** lethal consequence, but the proposal is not certified resolved; its existing editor payload retains the question, and validation rejects a resolved status while that question remains. The GM must decide the source rule and consequences. No new AI request is made for these passive-only questions.

Known current-mode Death Immunity and Protect remain automatic. Inactive modes and already-dead owners do not introduce review questions. This change does not imply that arbitrary defensive prose or custom death triggers are now executable, and no saved history/live game is retroactively rewritten.

## Verification

- Eleven focused tests pass: eight former failures plus three unchanged controls.
- Full suite: **960 passed, zero failed/skipped**, including the supplied Transformers DOCX.
- Actual mode editor parsing and real engine/editor-payload validation execute in isolated tests. No browser or paid provider call is represented by these tests.
- JavaScript syntax, static build and whitespace checks pass.

No Supabase function, schema, account, Storage object or live game was changed. General custom-passive rewards/on-death causality, accounting durability/concurrency, and full current two-GM browser verification remain open.
