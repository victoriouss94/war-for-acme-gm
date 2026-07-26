# War for ACME GM — Changelog

## Version 2.6.2 — Warner Den Instant Kill Definition

- Standardizes the term **Warner Den Instant Kill**.
- Defines **regular den kill** as one of the Warner Syndicate's two faction-owned Warner Den Instant Kills.
- Regular den kill does not include any personal ability belonging to Brain, Pinky, Yakko, Wakko, Dot, or another Warner player.
- Adds explicit faction-action metadata:
  - owner type: FACTION
  - faction owner: Warner Syndicate
  - resource: warner_den_instant_kill
- Adds engine helpers to distinguish faction den kills from player actions.
- Updates Sarge's passive trigger:
  - triggers when Sarge is targeted by a Warner Den Instant Kill,
  - triggers when Sarge is targeted by a conversion,
  - does not trigger from an individual Warner player's personal kill ability.
- Sarge's counterattack automatically Instant Kills a random living Warner Syndicate player.
- Updates database wording and the faction-resource panel.
- Preserves all prior role cards, Ability Intelligence, Supabase sync, and automated night-resolution features.
