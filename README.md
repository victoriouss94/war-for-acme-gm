# GM Command Center v6.1

Generic social-deduction game engine with permanent Villager, Den, and Neutral faction classes.

## New in v6.1

- Owner-managed GM and Viewer invitation codes generated cryptographically in PostgreSQL
- Persisted invitation expiration, one-use or unlimited use limits, revocation, and audit history
- Atomic redemption with row locking so a one-use invite cannot be consumed twice
- Complete GM Access settings with member permission changes and safe member removal
- My Games and Shared With Me collections backed by permanent membership records
- Realtime membership/invitation refresh with backend authorization enforced on every protected write
- Friendly join errors without exposing raw database details

## Word importer from v6.0

- Staged `.docx` game importer that preserves headings, lists, tables, and labeled fields
- Editable review tabs for game info, factions, roles, abilities, rules, and warnings before any data is written
- Existing Ability Encyclopedia matching plus explicit create/link decisions for imported abilities
- Selective import, duplicate-role handling, unassigned-faction warnings, and relationship validation
- Private original-document storage with a 10 MB limit and authenticated game-member access
- Reviewable re-import comparison with New, Changed, Unchanged, and Missing states; existing content is kept by default
- Atomic database writes, import audit records, optimistic version checks, and normal Realtime game updates

## Shared collaboration

- Supabase-backed shared games with no-email device accounts, email/password, or magic-link authentication
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

Deploy the folder to GitHub Pages, then add the exact production URL to **Supabase → Authentication → URL Configuration → Redirect URLs** so magic-link sign-in returns to the site. Password and no-email device accounts do not depend on a redirect. No-email accounts are anonymous Supabase users: they keep the same RLS-protected access while the browser session exists, but cannot be recovered after sign-out or cleared site data.

For local development, serve the directory over HTTP rather than opening `index.html` as a `file:` URL.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test`. The importer tests include a real generated DOCX fixture with headings, lists, and a role table.
