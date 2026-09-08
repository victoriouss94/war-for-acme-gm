# Renamed passive standard-ID audit

## Reproduced defect

Role/mode-linked catalog abilities can retain an explicit `standardAbilityId` or `standard_ability_id` when renamed. The night engine reduced these records to display names before inspecting passives, losing that mapping. An entry named Aegis Plating mapped to `bulletproof` did not protect its owner; similarly mapped Reflection and Counterattack entries did not execute. Five runtime regression cases failed before this repair. Unknown-ID controls passed.

## Repair and scope

Frontend 12.2.36 / engine 1.2.6 retains passive records until mechanic-key normalization. Exact standard IDs matching an existing PASSIVE definition select its existing handler. Exact canonical-name/alias fallback remains. Invalid, partial and local IDs are not treated as global mappings. Source attribution uses the same mechanic key, retaining the original local ability ID, custom display name and effective role/version instead of crediting an unrelated catalog entry.

No new engine, standard vocabulary, AI call, database schema or Edge Function is introduced. This is passive execution, not a general rewrite of active-action/import classification. Ambiguous custom conditions, base-standard modifiers and unsupported passive review coverage remain separate work.

## Verification

- Six new runtime tests: both ID field spellings, custom-named Reflection, custom-named Counterattack, accessible/inaccessible mode defense, and rejection of unknown/partial/local IDs. Source identity, zero AI calls and no input mutation are asserted.
- Existing passive identity tests now also cover renamed mappings in ordinary and temporary Role Swap contexts.
- Two authenticated public-RPC rollback workflows verified creation, phase start, queue, snapshot, proposal save, approval, analytics and identical approval retry. The actual cloud snapshot retains both custom names and exact standard IDs. Final events retain the expected source IDs/role versions/targets, one trigger per passive, zero passive submitted attempts, expected life outcomes and unchanged permanent roles. No preapproval death or duplicate approval events occurred.
- Follow-up queries verify both fixture games, their sessions and resolution events are absent after rollback. No test users, Storage objects or paid provider requests were created. Live Transformers remains Night 1, version 192, 47 players / 44 alive.
- Full suite: **578 passing, zero failures, zero skips**, using the supplied Transformers DOCX. JavaScript syntax checks, static build and diff checks pass. No native-browser proof is claimed.

The overall technical audit remains incomplete. Earlier alias and source-attribution fixes are preserved; no live or historical resolution was rerun.
