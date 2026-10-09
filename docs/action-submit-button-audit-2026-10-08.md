# Action Queue submit-button audit

Release: 12.2.73. Existing submitQueuedAction handler repaired; no new queue or resolver.

The prior finally block unconditionally enabled Add to Action Queue after a successful submission reset the form, or after an error while the phase was no longer editable. This overrode the builder's validity state. Existing draft validation still prevented an empty submission; this was not evidence of a database authorization bypass.

The handler now rerenders the existing builder in finally, deriving button availability from the current draft and phase. Four isolated actual-handler tests mock persistence and rendering: cleared form stays disabled, valid retry becomes available, locked phase stays disabled, and invalid drafts never persist. Before repair two failed; after repair all four passed. Full suite: 1,078 passed, zero failed or skipped, including the supplied Transformers document fixture.

No live game was opened or changed for this check. No paid AI request, database migration, or Edge Function change. This is narrow handler evidence, not full browser or multi-GM certification. The general permissions-render toggle remains a separate investigation. Broader audit remains incomplete.
