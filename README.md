# GM Command Center v5.0

Generic social-deduction game engine with permanent Villager, Den, and Neutral faction classes.

## New in v5.0

- Supabase-backed shared games with email/password or magic-link authentication
- Owner, GM, and read-only viewer membership enforced with Row Level Security
- Live game-scoped updates and presence over Supabase Realtime
- Optimistic version checks that reject stale edits instead of overwriting them
- Expanded, game-specific role editor with Encyclopedia ability selection
- Ordered Rules editor with create, edit, duplicate, enable/disable, reorder, and delete
- Server-side document validation, safe referenced-role deletion, and change history
- Invite codes for adding another authenticated GM to a game

## Saved game management

- Permanent multi-game manager with Active, Saved, and Archived sections
- Isolated per-game players, roles, factions, abilities, actions, history, and settings
- Fast game switcher, autosave, manual Save Game, and last-saved timestamp
- Fresh-setup duplication, archive/restore, search, sorting, import, and export
- Safe migration of existing v3 single-game browser data into a default saved game

## Existing systems preserved

- Factions, roles, players, action queue, statistics, and settings
- Multiple Den support
- Searchable Role and Ability Encyclopedia with 35 built-in standard abilities
- JSON import and export

## Deployment

The database migrations are in `supabase/migrations` and have been applied to the configured Supabase project. The browser uses the publishable key in `js/supabase-config.js`; no service-role secret is shipped to the client.

Deploy the folder to GitHub Pages, then add the exact production URL to **Supabase → Authentication → URL Configuration → Redirect URLs** so magic-link sign-in returns to the site. Password sign-in does not depend on a redirect.

For local development, serve the directory over HTTP rather than opening `index.html` as a `file:` URL.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test`.
