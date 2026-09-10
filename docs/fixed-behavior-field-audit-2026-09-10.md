# Explicit behavior field compatibility audit

## Finding and repair

Frontend 12.2.50 / canonical engine 1.2.18 extends the existing dispatch safeguard. A matching effect name was insufficient: standard handlers could silently ignore explicit differences in status type, investigation type, protection strength, conversion role retention and other fixed behavior fields. For example, Poison with statusType DRUNK still applied poison, and Convert with dropsOldRole false still removed the role.

The existing behavior guard now detects incompatible values in 15 scalar fields whose implementation is fixed by the mapped standard: scope, factionKind, transformation, statusType, intelType, protectionTier, stopsKillTier, dropsOldRole, duration, activates, expires, visitorCollateral, bypassesProtectionTier, healRemoves and mayGenerate.

A conflict enters the existing CUSTOM review path and names the conflicting fields. It does not guess a new rule, consume the attempt's use, execute the standard's effect, trigger Reflection, or become a counted visit. The same guard handles isolated AI adjudication overrides. Blocking still takes precedence and retains the use. A GM may explicitly reclassify the action. Matching defaults and runtime-supported killTier customization continue working.

## Evidence

tests/conflicting-behavior-fields.test.mjs has 21 synthetic tests. Before repair: 17 failures and four passing controls. After repair: all 21 pass; with prior effect-conflict tests, 31 pass. Full suite: 803 passes, zero failures, zero skips, with the supplied Transformers DOCX. JavaScript syntax checks, static-build validation, and diff checks passed.

No live game was read, restarted, simulated or changed. No database, Edge Function, account, Storage or paid-provider changes were needed.

## Remaining limits

This is compatibility validation, not a new effect compiler or full rule-priority implementation. Only fields present in both the supplied behavior and mapped standard are compared. Missing fields retain existing fallback behavior. Unknown fields, array/object fields such as statusTypes/upgrades, nonstandard runtime Capture behavior, arbitrary passive conditions and on-death rewards need separate assessment. Source documents and stored ability identities are not rewritten, and historical proposals are not retroactively recalculated. Native browser and concurrent-GM proof remain outside these synthetic tests.
