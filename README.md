# GM Command Center v8.0

Generic social-deduction game engine with permanent Villager, Den, and Neutral faction classes.

## New in v8.0

- Authenticated AI GM Copilot that reads the authoritative Supabase game document server-side
- Terra standard reasoning for everyday rulings and Sol deep reasoning for complex resolutions
- Structured answers grounded in saved roles, linked abilities, rules, players, phases, and queued actions
- One-click action-queue resolution with explicit ambiguity warnings and focused follow-up questions
- Strictly allowlisted proposed changes that are revalidated and require an owner/GM confirmation before saving
- OpenAI credentials isolated in Supabase Edge Function secrets; no API key is included in browser code
- Per-user request limiting, origin checks, RLS-backed membership verification, bounded prompts, and non-retained OpenAI requests

## New in v7.0

- Permanent username + password accounts with no email field, confirmation, OTP, or email recovery flow
- Case-insensitive unique usernames and clear 3–30 character validation
- Supabase Auth password hashing and salted credential storage; no plaintext or reversible password fields
- Persistent sessions outside `localStorage`, verified at startup and fully cleared on logout
- Account menu and Account page with membership date, owned/shared game counts, password change, and logout
- Existing device-account upgrade that preserves the same user ID, game ownership, memberships, invitations, and audit history
- Database-authorized My Games and Shared With Me results, authenticated audit attribution, and private game-scoped Realtime

## Invitations from v6.1

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

- Supabase-backed shared games with permanent username/password accounts and no required user email
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

The database migrations are in `supabase/migrations` and have been applied to the configured Supabase project. The browser uses the publishable key in `js/supabase-config.js`; no service-role or OpenAI secret is shipped to the client. The `gm-copilot` Edge Function requires an `OPENAI_API_KEY` Edge Function secret and JWT verification.

Deploy the folder to GitHub Pages and keep **Confirm email** and **Allow anonymous sign-ins** disabled in Supabase Auth. Username accounts use an internal, non-deliverable identity solely to let Supabase Auth provide password hashing and sessions; users never enter or receive email. Legacy anonymous accounts that still have a valid browser session are prompted to upgrade in place so their existing games remain attached to the same user ID.

For local development, serve the directory over HTTP rather than opening `index.html` as a `file:` URL.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test`. The importer tests include a real generated DOCX fixture with headings, lists, and a role table.
