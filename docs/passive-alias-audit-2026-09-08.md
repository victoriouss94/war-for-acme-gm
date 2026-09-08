# Exact passive alias audit

## Reproduced defect

The existing encyclopedia declares `reflect`/`mirror`, `death immune`, `counter attack`/`retaliate`, and `passive immunity` as aliases of four known passives. The night engine normalized those labels into keys, but compared only canonical keys. A correctly linked or mode-owned passive using one of these exact aliases did not trigger. Six regression cases failed before the repair: lethal attacks were not reflected, immunity did not prevent death, and retaliation did not generate a child attack.

## Repair

Engine 1.2.5 (frontend 12.2.35) normalizes only exact existing encyclopedia names/aliases before the existing passive handlers inspect them. It preserves the original ability ID/name and effective role/version in results and official usage. It does not add a new resolver, active submission, alias vocabulary, fuzzy prose interpretation or custom-rule dispatcher. Names containing conditions or negations are not promoted to unconditional passives.

## Runtime verification

Seven new tests cover both reflection aliases, both immunity aliases, both Counterattack aliases, source identity, mode ownership, no input mutation, zero AI calls, and no inference from partial/negative prose. Cancelling the initiating attack removes the dependent retaliation and resulting deaths. Existing owned-passive tests now also run normal and temporary Role Swap fixtures with aliased catalog entries.

Full suite: **572 passing, zero failures, zero skips**, with the actual supplied Transformers DOCX. Both JavaScript syntax-check scripts, static build and diff checks pass. These are not TypeScript analysis or native-browser tests.

## Authenticated database verification

Two isolated transactions exercised the existing public create game → start phase → queue → start resolution → save deterministic proposal → approve → identical approval retry → analytics path, under `authenticated` privileges. One fixture used aliased retaliation and immunity; the second borrowed aliased immunity through temporary Role Swap. Both verified exact passive ability/role/version, independent target arrays in official events, one trigger per passive, zero passive submitted attempts, no preapproval death, expected life outcomes, unchanged permanent roles and no duplicate events on approval replay.

Both transactions rolled back. Follow-up queries verified zero games, sessions and resolution events for both generated fixture IDs. No users, Storage objects or paid AI calls were created. The live Transformers game remains Night 1, document version 192, with 47 players and 44 alive. No migration or Edge Function deployment is required; gm-copilot stays v25.

The rollback approach follows the current [Supabase database testing guidance](https://supabase.com/docs/guides/local-development/testing/overview). It does not substitute for fresh-JWT HTTP or native-browser proof.

## Remaining boundary

This closes exact alias execution, not arbitrary custom passive interpretation. Conditional/on-death/reward passives, explicit standard-ID-only mappings with unrelated display names, and late-stage intel dependencies remain audit work. In particular, the negative-prose tests establish that no effect is invented; they do not establish complete review-warning coverage for unsupported passives. No historic/live result was recalculated or rewritten.
