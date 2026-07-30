# Repository Audit — v3.2

## Current architecture

The repository is a static browser application:

- `index.html` contains the application views and forms.
- `css/main.css` contains the active visual system.
- `js/app.js` contains state, rendering, persistence, imports, exports, and interactions.
- Browser `localStorage` is the current database.
- JSON files under `data/` are mostly placeholders except `master_database.json`.

## Strong existing features

- Generic Villager, Den, and Neutral faction classes.
- Multiple Den support.
- Faction, role, player, action queue, statistics, and settings modules.
- Searchable ability encyclopedia.
- JSON import and export.
- No build tools are required; GitHub Pages can host the project directly.

## Technical risks to address gradually

- Most application logic lives in one JavaScript file.
- Generated UUIDs make canonical built-in records harder to identify across installations.
- Roles reference abilities through free-text tags rather than stable ability IDs.
- `localStorage` is suitable for current use but will eventually limit histories and larger projects.
- The current state represents one project rather than a multi-project workspace.

## Recommended direction

Preserve the working static application while improving it incrementally. The next major foundation should be stable IDs and a project-aware save format before splitting the application into modules.
