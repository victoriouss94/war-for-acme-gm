# War for ACME GM — Changelog

## Version 2.6.1 — Separate Warner Faction Resources

- Corrects the Warner Syndicate den kills so they are faction resources, not player abilities.
- The den receives exactly two faction-owned Instant Kills each night.
- These actions have no player actor and consume no Warner character ability.
- They do not appear in player ability counts or Ability Intelligence totals.
- They remain available regardless of which individual Warner role submits them.
- Adds a Warner faction-resource panel showing:
  - 2 total per night,
  - number queued,
  - number remaining.
- Faction resources reset naturally each new night because usage is tracked by the current night number.
- Normal protection stops these Instant Kills.
- Super and Omega Kills still bypass normal protection.
- Preserves the automated resolution order and Supabase live synchronization.
