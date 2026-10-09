# Queue button state across session refresh

Release 12.2.74. The actual same-user auth handler and renderChrome were exercised in an isolated VM with mocked DOM nodes and no external calls. Both TOKEN_REFRESHED and repeat SIGNED_IN re-enabled a disabled Add to Action Queue button for an editable game. Two of eight new tests failed before the repair.

renderChrome now preserves the previous queue submit disabled state while also disabling it when no game or read-only. The existing action builder remains responsible for enabling a valid draft. No authentication callback, Supabase API, permission, or database code changed; the cheap same-user branch remains intact and does not erase drafts or fetch game data.

Eight regression cases cover both events, disabled/enabled state and editor/viewer access, and preserve an unsaved form value. Full suite: 1086 passed, zero failed or skipped, with the supplied Transformers document. This is isolated actual-handler evidence, not native-browser concurrency certification. Previous draft validation and backend authorization remain unchanged.

Supabase skill used to review auth/security boundaries. Official onAuthStateChange documentation and changelog were consulted; no relevant hosted-client breaking change was identified. The repair changes local rendering only. No live Transformers data, sessions, phase, resolution or account was modified; no paid AI calls. Full technical audit remains incomplete.

References: https://supabase.com/docs/reference/javascript/auth-onauthstatechange and https://supabase.com/changelog.md
