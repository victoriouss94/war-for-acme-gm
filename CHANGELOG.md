# War for ACME GM — Changelog

## Version 2.9 — Passive Reader

- Adds a generic Passive Reader instead of relying only on hardcoded character names.
- Reads each role's `passive_name` and `passive_description` when the role is assigned.
- Converts recognized passive wording into structured, executable rules.
- Currently recognizes:
  - conversion immunity,
  - Den standard faction-kill immunity,
  - roleblock immunity,
  - silence immunity,
  - fear immunity,
  - hanging survival,
  - early-game death immunity,
  - one-time death escape wording,
  - kill-tier targeting restrictions,
  - Den/conversion counterattacks.
- Sarge's exact passive is now parsed directly:
  **Cannot be converted or killed by the Den's standard faction kill.**
- Existing players loaded from cloud or backup are given parsed passive rules automatically.
- Player cards display the passive mechanics the engine recognized.
- Unrecognized passive wording is flagged for GM review rather than guessed.
- Preserves GM Statistics, Ability Intelligence, Rules Engine, phased Night Queue, role cards, and Supabase synchronization.
