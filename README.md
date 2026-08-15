# GM Command Center v10.0

Generic social-deduction game engine with permanent Villager, Den, and Neutral faction classes.

## New in v10.0

- One Master GM agent handles questions, explanations, balance analysis, draft creation, controlled edits, live-status checks, document import, and action-resolution requests.
- Natural intent and exact entity resolution use the active game plus short conversation context, while ambiguous names are returned to the GM instead of guessed.
- The server exposes a bounded, permission-aware tool registry and records each AI run and tool call for GM audit.
- Role, ability, faction, rule, game, and live-status writes are stored as validated proposals; nothing changes until an owner or GM approves it.
- Proposal approval is atomic, idempotent, version checked, and written through the existing game-document and live-status mutation paths.
- Current-game state stays authoritative, with relevant official documents, historical resolutions, precedents, and compatible cross-game learning supplied only when needed.
- Exact live-status questions can be answered directly from the database without an AI request or token cost.
- Master GM conversations, runs, proposals, and tool traces are owner/GM-only under Row Level Security.

## New in v9.0

- Persistent Ask GM Assistant conversations scoped to the current saved game
- DOCX, PDF, and TXT official-document ingestion with private storage, hybrid retrieval, and source citations
- Exactly 32 stable Courtroom standardized ability IDs with immutable version history
- Explicit dataset activation that never changes existing games or roles automatically
- Game-scoped official ability edits, separate role-specific modifier versions, and a read-only reconciliation report
- Focused AI context, explicit GM-decision warnings, centralized model configuration, and server-only AI persistence
- Roles can be edited, duplicated, disabled, or archived but are never permanently deleted

## New in v8.1

- AI Word importer that reads free-form `.docx` content and extracts game information, factions, roles, linked abilities, and rules
- Terra analysis by default with an optional Sol deep-analysis retry
- Strict structured output normalized into the existing editable import model and validated before save
- Local structured parser fallback when AI is unavailable, with a visible warning and retry control
- Authenticated, rate-limited Edge Function with prompt-injection defenses, bounded input, non-retained requests, and no direct database writes

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
- Searchable Role and Ability Encyclopedia with exactly 32 standardized abilities
- JSON import and export

## Deployment

The database migrations are in `supabase/migrations` and have been applied to the configured Supabase project. The browser uses the publishable key in `js/supabase-config.js`; no service-role or OpenAI secret is shipped to the client. The `gm-copilot` and `gm-document-import` Edge Functions require an `OPENAI_API_KEY` Edge Function secret and JWT verification.

Deploy the folder to GitHub Pages and keep **Confirm email** and **Allow anonymous sign-ins** disabled in Supabase Auth. Username accounts use an internal, non-deliverable identity solely to let Supabase Auth provide password hashing and sessions; users never enter or receive email. Legacy anonymous accounts that still have a valid browser session are prompted to upgrade in place so their existing games remain attached to the same user ID.

For local development, serve the directory over HTTP rather than opening `index.html` as a `file:` URL.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test`. The importer tests include a real generated DOCX fixture with headings, lists, and a role table.
