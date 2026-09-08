# Passive source attribution audit — September 8, 2026

## Reproduced defects

The existing engine correctly triggered Counterattack and immunity, but its final passive-result lookup selected the first encyclopedia entry with a similar standard meaning. An unrelated earlier entry such as Archive Counterattack received the result's ability ID instead of the passive actually linked to the player's role. This could attribute official usage statistics to the wrong ability.

Temporary Role Swap also recorded the player's original role/version as the passive source, even though the existing engine applied the borrowed role's immunity. The original committed engine produced unrelated-bulletproof / audit-counter v7 where the expected source was audit-bulletproof / audit-attacker v4.

Three initial tests directly reproduced wrong ability attribution. A fourth reflection/conversion fixture initially omitted reflectable:false and correctly reflected the conversion; the fixture was corrected, not the engine's reflection rule. Running both complete approval fixtures against the original committed engine separately confirmed the wrong ability IDs and borrowed-role attribution.

## Narrow repair

The existing passive-context lookup is shared between effect-name discovery and source attribution. When Reflection, immunity or Counterattack triggers, the engine now records its linked role/mode ability ID and effective role/version immediately. This preserves the source before later conversion clears the role. Temporary Role Swap records the borrowed role as the source without permanently changing the player's role.

Explicit linked identities are preferred. Legacy name-only records keep a fallback that prefers exact names before broader standard-meaning matches. The final normalization preserves an already resolved exact ability ID instead of replacing it with an earlier lookalike.

No new resolver, passive dispatcher, effect, use-consumption policy, database schema or AI call was added. The lethal outcomes and number of submitted/generated actions are unchanged. Historical saved rulings are not rewritten.

## Verification

- Five new runtime regressions cover role-linked Counterattack, mode-linked immunity, Reflection before conversion, temporary Role Swap, editor payload retention and both cloud fixtures' exact expected sources/life outcomes.
- Existing public create/start/queue/start-resolution/save/approve APIs were exercised with authenticated privileges in rolled-back disposable games. The canonical approval was used without disabling validation or overriding warnings.
- Normal fixture: Counterattack attributed to its owned ability/role v7; Bulletproof attributed to its owned ability/role v4. Exactly one official trigger each, zero submitted passive attempts, no usage assigned to unrelated encyclopedia entries. Attacker alive, target dead.
- Role Swap fixture: target survives using the borrowed role's Bulletproof. Official result, event and analytics row identify audit-attacker v4 as the source, with one trigger and zero submitted attempts. No permanent role reassignment is applied.
- Repeating the identical approval key creates no additional events. No player dies before approval. Fixture game/session/event rows were verified absent after rollback.
- The first Role Swap cloud attempt lacked the required MULTIPLE_PLAYERS targeting metadata and was correctly rejected with ONE_TARGET_REQUIRED. Correcting the fixture allowed the existing public queue to accept it; no validation was weakened.

Frontend **12.2.31**, canonical engine **1.2.4**. Full suite: **550 passed, zero failed/skipped**, including the supplied Transformers DOCX. Syntax checks, static build and whitespace checks pass. No database migration or Edge deployment is needed; gm-copilot remains v24.

## Limits

This repairs the identity of already supported passive triggers, not arbitrary custom passive semantics. General on-death rewards, custom event dispatch, late-intel dependencies and ambiguous legacy name-only ownership remain audit work. Production checks are database-function/application integration, not native browser approval testing. The live Transformers game was not changed.
