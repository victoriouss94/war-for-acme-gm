# Document registration confirmation audit — September 13, 2026

## Existing path and reproduced defect

This continues the [document source recovery repair](document-source-recovery-audit-2026-09-13.md), without another importer or storage system.

The existing cloud bridge only checked an RPC's error field. A syntactically valid but empty, malformed, or mismatched registration result could still be accepted:

- Initial import ignored the returned game identity and used fallback version/share-code values, allowing apparent success based on an invalid confirmation.
- Reimport accepted a returned document for a different game or a stale version before updating local state.
- Knowledge upload could call the indexing function after an empty result or a confirmation naming different document/version IDs.

These are isolated runtime reproductions, not a claim that production has returned such payloads.

## Fix

The three existing registration methods now use one private row validator before returning success or starting indexing:

- Exactly one object row is required.
- Initial import requires the requested game ID, a positive safe-integer version, and the share-code string returned by the existing RPC.
- Reimport requires exactly the next expected version, the requested game ID inside the document, an object data payload, and a parseable updated timestamp.
- Knowledge registration requires the requested document ID and version ID, plus a positive safe-integer version number.

Failure raises DOCUMENT_SAVE_UNCONFIRMED through the existing source-retention warning path. No source deletion, automatic mutation retry, local success publication, or paid indexing follows an unconfirmed result.

The checked fields match the existing SQL return contracts in the Word-import, username-account game-creation, and global-master knowledge migrations. This is response validation, not a replacement for database authorization or full validation of every nested game rule.

## Verification

The existing full-module transport harness was extended in tests/document-source-recovery.test.mjs. Six new parameterized contract cases failed before the repair; the previous 25 cases passed. The repaired file now has **33 passing cases**, including two added actual app-handler checks showing that wrong-game confirmations never publish into local storage, the game index, cloudVersion, or current state.

Covered malformed inputs include null/undefined/empty/nonarray/multiple-row replies, nonobject rows, wrong identities, missing/nonnumeric/invalid versions, absent or array-valued game data, and invalid timestamps. Existing successful registration contracts, exact-path rejection cleanup, unknown-outcome retention, original error details, and ingestion-failure preservation still pass.

Full suite: **1,015 passing, zero failures, zero skips**, including the supplied Transformers DOCX. JavaScript syntax and static build checks pass.

Release target: frontend **12.2.66**, canonical engine unchanged **1.2.26**. Only the frontend is deployed. No migration, Edge deployment, live game operation, production fixture, Storage deletion, account change, or paid AI request was needed.

## Remaining boundaries

This does not reconcile an unknown save, delete orphan files, or validate every nested property of the game document. Ordinary non-import save/load paths are outside this bounded repair. Full current native-browser and two-GM workflow verification remains blocked by the existing browser-tool environment issue; the overall audit is still incomplete.

Current [Supabase RPC documentation](https://supabase.com/docs/reference/javascript/rpc) and the changelog were checked. Database authorization, private Storage/RLS, and existing version-conflict enforcement remain unchanged; frontend identity validation is defense in depth, not an access-control boundary.
