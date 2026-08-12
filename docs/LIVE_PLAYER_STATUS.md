# Live Player Status Architecture

The saved `game_documents` row remains authoritative for player identity, life state, current role, current faction override, owned abilities, rules, phase, and queued actions. Applied effects are stored separately in `player_status_effects`, so owning an ability never implies that its effect is active.

## Effect lifecycle

Effects use a reusable `status_type` plus structured source, timing, visibility, stack, state, and metadata fields. Standard lifecycle states are `ACTIVE`, `PENDING`, `RESOLVED`, `EXPIRED`, and `CONSUMED`. Unknown role mechanics use `CUSTOM` without changing the standardized ability encyclopedia.

Every insert or update creates an append-only `player_status_history` event. Supported audit actions are apply, modify, extend, shorten, remove, resolve, expire, trigger, and consume. Status rows are soft-resolved rather than deleted.

## Authorization

Only game owners and GMs can mutate statuses. The public mutation functions verify `auth.uid()` and game edit membership, validate referenced player/role/ability IDs against the saved game, and execute an audited transaction. Direct table inserts, updates, and deletes are not granted to authenticated clients.

`GM_ONLY` is the default. `OWNER_VISIBLE` requires an explicit subject user mapping, `PUBLIC` requires game membership, and `FACTION_VISIBLE` remains hidden from non-GMs until the application has an authenticated player-to-faction mapping. Status history is GM-only.

## AI behavior

Before every AI answer or action-resolution request, the Edge Function calls controlled live-status RPCs. If the status ledger cannot be read, the request fails closed rather than answering from role descriptions or conversation memory. The model receives separate collections for owned abilities, active effects, pending effects, and status history. Any proposed status mutation must still be reviewed and approved by a GM before the server applies it.
