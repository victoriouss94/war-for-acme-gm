# Simulation revision retention audit

## Confirmed and repaired

Recalculating through the existing `save_deterministic_resolution` RPC replaced
the full `engine_proposal`. The session events and change history kept counts
and summary metadata, not the original complete result. A two-save rollback
fixture confirmed that the original unique ruling was absent from all three.

Migration `20260906035333_preserve_resolution_simulation_revisions` adds
`resolution_simulation_revisions` and extends the same private save function.
Each successful save now retains the full proposal, version, engine metadata,
time and author in the existing locked transaction. Authentication, proposal
validation, stale-version rejection and the RPC response remain unchanged.
No new resolution engine or extra AI call was introduced.

Revision bodies are not included in normal session/game sync. The table has
explicit read-only grants, RLS matching session GM access, and foreign-key
indexes. Browser callers cannot insert, update, delete or truncate revisions.
The private save implementation remains postgres-only with an empty search path.
This follows the Supabase skill's least-privilege and payload-size checks and
the current [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Verification

`tests/simulation-revisions-rollback.sql` uses a real engine proposal from
`poisonResolutionFixture()` through the public authenticated RPC. It verifies:

- Exact original/current proposals and version/author attribution.
- Stale saves, mismatched actions and oversized payloads cannot change history.
- Browser owners cannot directly insert, overwrite or delete revisions.
- A pre-migration latest result is captured as `LEGACY_CURRENT` before replacement;
  missing earlier revisions are not fabricated, and saved originals are unchanged.
- A synthetic revision-key collision after the session update rolls back the
  entire save, including the current proposal and event count.
- Owners and GMs can read; nonmembers, viewers, removed GMs, null identities and
  anonymous callers cannot. Nonmember/viewer saves are denied.
- RLS is enabled and client/server application roles have no direct write or
  table-maintenance privileges on the new table.

The database test passed and its generated game was verified absent after
rollback. Production security advisors have the same 46 keys (45 warnings and
one informational notice); this is not a clean security-audit claim.

## Limits and live state

This is backend audit retention, not a new browser history viewer. Older results
that were already overwritten cannot be recovered. There is no bulk backfill:
an existing current result is retained on its next save, clearly labelled as a
legacy current result. Revision records follow the existing session/game deletion
lifecycle; this is not off-site backup or tamper-proof administrator storage.

No live game, player, action, uploaded document or existing review was changed.
Transformers remained Night 1, document version 192 at read-only verification.
The full technical audit remains incomplete; see the ongoing coverage report.
