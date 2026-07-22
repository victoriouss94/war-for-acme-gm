# War for ACME GM — Changelog

## Version 2.2 — Shared Multi-GM Edition

- Preserves all Version 2.1 features.
- Connects the application to the shared Supabase room `ACME54`.
- Synchronizes the full game state between all connected GMs.
- Adds GM-name attribution for every cloud save.
- Adds Connected, Syncing, Offline, and Sync Error indicators.
- Receives realtime updates without refreshing the page.
- Keeps a local emergency copy whenever cloud synchronization is unavailable.
- Reconnects after the device regains internet access.
- Adds a Force Sync button.
- Detects whether cloud or local game data already exists and asks which copy should be used.
- Continues supporting downloadable JSON backups.

Security note: the room code is a coordination code, not strong authentication. Keep the GM website address private until proper authentication is added after the game.
