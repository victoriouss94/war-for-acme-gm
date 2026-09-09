# Renamed active ability standard-ID audit

## Reproduced defect

The shared encyclopedia classifier inspected the display name before the stored standard ID and did not recognize the snake-case standard-ID field. Renaming a standardized active ability could make a known mechanic require review, or select a different mechanic mentioned by the new name. Five new runtime cases failed before the repair; invalid-ID and explicit-category controls passed.

## Repair

The existing `globalAbilityDefinition` now checks exact `standardAbilityId` / `standard_ability_id` values against the existing catalog first. Unknown/local/partial IDs are not treated as standard mappings. Existing name/alias classification remains the fallback. Explicit role category overrides retain their existing precedence. No new resolver, standard abilities, AI route, table or schema is introduced.

Frontend 12.2.37 / engine 1.2.7 uses cache-consistent imports for precisely the classifier dependency closure: global abilities, mechanics, document import, player abilities, resolution editor, night engine and app. The other consumer files changed only their import cache versions. Build checks now verify these transitive references and the root app release. Unrelated modules and Edge Functions are unchanged; gm-copilot remains v25.

## Verification

- Seven new runtime tests cover both field spellings, explicit-ID precedence over a different named mechanic, invalid/local/partial IDs, deterministic renamed kills, mapped protection, dependency recalculation and explicit category overrides. Local ability names/IDs, snapshot immutability and zero AI calls are asserted.
- Two existing authenticated public-RPC rollback fixtures now include a renamed active ability, Ion Lance, mapped to Personal Instant Kill. Cloud create/start/queue/snapshot/save/approve/retry retains its exact standard ID and custom name. Approved action results retain the local ID/name, canonical type and KILLS category. Existing passive source/target/role/version, expected life state and idempotency checks pass in normal and temporary Role Swap contexts.
- Both fixtures were rolled back; subsequent queries verify zero games, sessions and resolution events. No accounts, Storage objects or paid provider calls were created. Live Transformers remains Night 1, version 192, with 47 players and 44 alive.
- Full suite: **585 passing, zero failures, zero skips**, using the supplied Transformers DOCX. Both JavaScript syntax-check scripts, static build and diff checks pass. These checks are not full TypeScript or native-browser validation.

The complete audit remains open. This repair handles explicit standardized identity; it does not certify arbitrary conditional/game-specific overrides, general passive dispatch, durable AI accounting or native two-GM workflows. No live or historical ruling was rerun.
