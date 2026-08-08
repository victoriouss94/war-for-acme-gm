# Repository Audit — v4.0

## Current architecture

The repository is a static browser application:

- `index.html` contains the application views and forms.
- `css/main.css` contains the active visual system.
- `js/app.js` contains state, rendering, persistence, imports, exports, and interactions.
- Browser `localStorage` is the current database. A lightweight game index stores summaries, while each game has one isolated detail record keyed by permanent game ID.
- JSON files under `data/` are mostly placeholders except `master_database.json`.

## Strong existing features

- Generic Villager, Den, and Neutral faction classes.
- Multiple Den support.
- Faction, role, player, action queue, statistics, and settings modules.
- Searchable ability encyclopedia.
- JSON import and export.
- Multi-game creation, switching, autosave, history, duplication, archive, restore, and deletion.
- No build tools are required; GitHub Pages can host the project directly.

## Technical risks to address gradually

- Most application logic lives in one JavaScript file.
- Generated UUIDs make canonical built-in records harder to identify across installations.
- Roles reference abilities through free-text tags rather than stable ability IDs.
- `localStorage` is suitable for current use but will eventually limit histories and larger projects.
- Browser storage quotas will eventually limit very large games or long histories.

## Recommended direction

Preserve the working static application while improving it incrementally. A future server-backed edition should retain the v4 game ownership model and enforce the same `gameId` scoping in authenticated API queries.
