# War for ACME GM — Changelog

## Version 2.6.3 — 56-Player Queue Edition

- Sets the official game size to 56 players.
- Tracks the intended setup:
  - 34 ACME Defense Force / Villagers
  - 11 Warner Syndicate / Den
  - 11 Wildcards / Neutrals
- Adds roster-size and faction-count setup warnings.
- Fixes the empty Warner Den Instant Kill target dropdowns.
- Den target lists now update automatically after:
  - roster changes,
  - death or revival,
  - conversion,
  - backup loading,
  - Supabase updates,
  - and phase/day changes.
- Den target lists include only living non-Warner players.
- Prevents dead targets, Warner targets, duplicate targets, and more than two Den kills.
- Groups the Night Queue into collapsible resolution phases:
  1. Blocks
  2. Role Control / Swaps
  3. Protects
  4. Intel
  5. Kills / Harmful Actions
  6. Saves / Heals
- Each phase displays its action count and resolved progress.
- Preserves all role cards, Ability Intelligence, automated results, faction resources, and Supabase synchronization.
