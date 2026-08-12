# Phase 1 architecture: AI GM knowledge and official abilities

## Existing system audit

GM Command Center is a static ES-module application deployed on GitHub Pages. `js/app.js` owns the interface and the in-memory game editor. Supabase Auth supplies username/password sessions, while Postgres stores each saved game's authoritative state in `game_documents.document` as versioned JSON. The `save_game_document` RPC validates cross-game IDs, performs optimistic concurrency control, updates game metadata, and writes `change_history`. Realtime synchronizes game documents, membership, invitations, and presence. Private Word imports are stored in Supabase Storage and recorded in `game_imports`.

Roles, abilities, players, factions, actions, rules, and game history remain in the existing JSON document. Roles link to game abilities by stable per-game IDs and by ability names in `tags`. Existing role and ability editing therefore stays intact. No Phase 1 migration rewrites a game document, changes an existing role, or attaches a reference dataset to a game.

The existing `gm-copilot` Edge Function is the security boundary for AI requests: it authenticates the JWT, verifies owner/GM membership, reads the current server save, calls the OpenAI Responses API, and returns an allowlisted proposal that a human GM must approve. `gm-document-import` performs AI-assisted Word extraction but cannot save a game without the existing review flow.

## Phase 1 additions

### Authority and isolation

1. The current `game_documents` row remains the authoritative live game state.
2. Active official document versions and activated standardized ability versions are reference authorities.
3. Game rules and explicit role modifiers may specialize a standard ability for one game or role.
4. AI output is advisory. It never writes gameplay state; only the existing GM approval flow can do that.
5. Every query is scoped by `game_id`. Global reference material is visible to a game's AI only when its dataset is explicitly activated for that game.

### Versioned knowledge

`official_documents` identifies a logical document. `official_document_versions` stores immutable uploads and lifecycle state (`DRAFT`, `PROCESSING`, `APPROVED`, `ACTIVE`, `INACTIVE`, `SUPERSEDED`, or `FAILED`). `official_document_chunks` stores bounded passages, source locators, full-text search vectors, and embeddings. Originals stay in the private `game-knowledge-documents` bucket.

The upload flow is:

1. An authorized GM uploads DOCX, PDF, or TXT to the private bucket.
2. A database RPC records the document and a `PROCESSING` version.
3. `gm-knowledge-ingest` reads the file with the caller's RLS-scoped session, uses a one-time OpenAI file input to extract structured passages, creates embeddings, and atomically completes the version.
4. Failed ingestion remains visible and retryable; it cannot silently become authoritative.

At question time, `gm-copilot` embeds only the current question and runs hybrid vector/full-text retrieval. It receives the highest-ranked active chunks, not every uploaded document. Answers carry structured source citations with document title, version, locator, and excerpt.

### Official abilities

`standard_ability_datasets`, `standard_abilities`, and `standard_ability_versions` hold stable IDs and immutable versions. The migration seeds exactly 32 Courtroom abilities. Seventeen definitions and their explicit relationships come from the supplied specification; the remaining entries are marked `NEEDS_SOURCE_TEXT` rather than filled from general social-deduction knowledge.

`game_ability_datasets` is an explicit activation link. It is empty for all existing games after migration. Once an owner or GM activates the Courtroom dataset for a game, that game's AI may retrieve it. Editing an official ability creates a new version scoped to that game and supersedes only the preceding game-scoped version. The global source version and every historical version remain available.

`role_ability_modifiers` stores immutable, role-specific changes separately from base abilities. Saving a modifier never duplicates or rewrites the standard ability and never modifies the JSON role automatically.

The reconciliation report is read-only. It compares current game ability/role names with stable standard entries and identifies exact matches, missing definitions, and unmatched records. A GM must decide every later link or copy operation.

### Persistent AI conversations

`ai_conversations` and `ai_messages` keep permanent game-scoped chat history. Starting a new conversation archives the previous active conversation; it does not delete messages. Edge Functions record the user/assistant exchange after a successful response. Realtime refreshes authorized GM clients.

### Security and performance

All new tables have RLS. Global source records are read-only to authenticated users; game records require membership to read and owner/GM permission to create versions. Direct writes are not granted. Narrow RPCs validate `auth.uid()`, game membership, allowed states, lengths, JSON shapes, and referenced roles. `SECURITY DEFINER` functions set an empty search path and have `PUBLIC`/`anon` execution revoked.

Foreign keys and RLS columns are indexed. Active-version queries use partial indexes; document search uses GIN full-text indexing and pgvector cosine indexing. New tables receive explicit `authenticated` grants because new Supabase projects may not auto-expose tables through the Data API.

## Consolidated extensions implemented in v9.3

- Resolution Sessions snapshot queued actions, relevant players, live statuses, and source versions. AI output is a proposal; finalization always requires an authorized GM and an optimistic lock.
- Structured session events and final outcomes preserve manual decisions without silently mutating live state.
- Optional "Teach AI" creates a game-scoped GM precedent in the same transaction. Similarity retrieval, conflict states, superseding, archiving, and rule-promotion prefilling all reuse this one precedent system.
- AI role and ability creators persist drafts only. Approval validates them and adds them through the existing game editors and save path.
- The ability interaction matrix remains evidence-only: no undefined relationship is seeded.
- Server-side usage records include model, feature, cached/input/output tokens, current pricing snapshot, estimated cost, latency, durable per-minute limits, and an optional owner-set monthly limit.

The existing game-document, status, official-knowledge, standardized-ability, role-modifier, conversation, audit, and Realtime architectures remain in place.
