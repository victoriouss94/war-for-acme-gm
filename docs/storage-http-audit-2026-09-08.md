# Real Storage HTTP audit — September 8, 2026

## Result

The complete successful run passed 42 HTTP checks against the real Auth, Data and Storage APIs. It used two newly generated QA accounts, two disposable games, a minimal synthetic DOCX and a synthetic text knowledge document. No paid AI request was made. This verifies the previously repaired Storage policies at the HTTP boundary, not just by evaluating policy expressions.

| Workflow | Observed result |
| --- | --- |
| Upload an own-prefix, valid DOCX | 200; downloaded bytes match |
| Read another user's unregistered DOCX | 400; denied |
| Delete another user's DOCX | 200 with an empty deletion list; original bytes retained |
| Upload under another user's prefix or invalid Word MIME type | 400; denied |
| Overwrite an existing DOCX | 400; UPDATE is intentionally not granted |
| Remove an owned, unregistered source | 200; fresh download returns 400 |
| Register uploaded Word source using create_game_from_import | 200; game/source registered |
| Delete a registered Word source through cleanup | 200 with an empty deletion list; protected |
| Generate/redeem invitation; collaborating GM reads Word source | 200; original bytes match |
| Remove that GM; repeat fresh source download | 400; denied |
| Upload knowledge without game membership | 400; denied |
| Join as GM; upload own-prefix game knowledge | 200 |
| Read an unregistered knowledge upload | Uploader 200; other game GM 400 |
| Register knowledge metadata with create_knowledge_document | 200; metadata only, no ingestion/AI call |
| Read registered knowledge as current game owner | 200; original bytes match |
| Delete registered knowledge as uploader | 200 with an empty deletion list; protected |
| Remove uploading GM; read/delete registered knowledge as former member | Read 400; delete returns empty list; owner can still read original |
| Delete both owned disposable games | 204; registrations removed |
| Clean up remaining unregistered source files | 200; fresh downloads return 400 |
| Log out both QA accounts | 204 |

An empty successful deletion response is not evidence that the object was deleted. The test checks the response contents and subsequent object state.

## Cache-related harness correction

The first run incorrectly expected an immediate same-URL download to fail after a successful deletion. That URL returned previously cached bytes while the authoritative object row was already absent. The harness was corrected to use a unique query string and no-cache request when checking current origin authorization or deletion. No application policy was changed to accommodate this test.

Supabase documents that deletion invalidation can take up to 60 seconds and describes a unique cacheNonce query for fresh-origin checks. Signed-URL token expiry is not itself a guarantee of CDN eviction. These tests establish current origin access; they do not promise instantaneous revocation of previously downloaded or cached content. See [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn).

## Cleanup and preserved behavior

Both runs' four exact QA identities were logged out and verified to have no sessions, memberships or objects before their auth records were removed. Final database checks found zero matching users, profiles, sessions, games or Storage objects. Import, knowledge-document and knowledge-version registrations from the successful run were also verified absent.

The live Transformers game stayed at Night 1, document version 192, with 47 players and 44 alive. No existing account, membership, source document or live-game record was changed.

The existing Word-source policy permits an uploader to retain access to their own original source; this audit did not silently alter that ownership rule. Registered knowledge sources instead require current game membership. Both buckets remain private with the existing 10 MiB and MIME restrictions.

No new migration or Edge deployment was required. Migration 20260906030803_protect_registered_document_sources_from_cleanup was already applied; these HTTP checks supplement its earlier 14 policy-expression cases. Browser-native upload rendering, paid document ingestion, signed-URL cache revocation and oversized streaming uploads are separate coverage boundaries.
