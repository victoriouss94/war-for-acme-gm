# Passive behavior compatibility audit

## Finding

The custom-passive guard recognized CUSTOM and explicit review flags, but not a different supported effect, trigger or generated ability. A passive mapped to Death Immunity could declare a different effect and still prevent death; Counterattack could request Omega Kill yet silently generate the standard personal kill. Explicitly changing Reflection's transformation or a passive's trigger was also ignored.

## Repair

Frontend 12.2.52 / engine 1.2.20 reuses the existing behavior compatibility guard in passiveRequiresReview. The fixed scalar contract now also includes trigger and generatedAbility. Incompatible passive metadata enters the existing passive-review path, without executing the guessed standard or invoking active-action AI adjudication. Matching standard passives remain executable. Renamed linked entries, denormalized names and structured player immunities retain the source metadata checks.

This does not implement custom passive triggers or rewards. Any lethal result while a passive needs review is provisional, not an instruction to finalize the death. Existing GM-review gating remains necessary.

## Evidence and limits

Thirteen new synthetic tests in tests/passive-behavior-contract.test.mjs produced nine failures and four passing controls before repair, then thirteen passes. Combined with prior custom-passive tests: 33 passes. Full suite: 823 passes, zero failures and zero skips, including the supplied Transformers DOCX. Syntax/static-build/diff checks passed.

No live game was read or modified. No database, account, Edge Function, Storage or paid AI changes were needed. Arbitrary conditions, absent or unknown fields, structured behavior fields, on-death rewards, complete rule priority and authenticated concurrent-GM workflows remain outside this repair.
