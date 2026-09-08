# Fresh-account HTTP workflow — September 8, 2026

## Verified live behavior

Used newly generated QA usernames and passwords with the same username-to-internal-email mapping as the existing client. Credentials and tokens stayed in process memory and were never written to a report or source file. Requests went to the real Auth and Data APIs, not mocked services or SQL impersonation.

The complete successful run verified:

| Step | Result | Observed duration |
| --- | --- | --- |
| Sign up; obtain an immediate session | 200 | 320 ms |
| Verify user; read own profile | 200; matching identity | 73 / 111 ms |
| List games from a new account | 200; no unrelated games visible | 115 ms |
| Log out; sign in using password | 204 / 200 | 107 / 171 ms |
| Wrong password | 400; rejected | 145 ms |
| Create; load QA game | 200 / 200 | 142 / 64 ms |
| Save QA game | 200 | 69 ms |
| Submit stale save | 422; rejected | 61 ms |
| Reload saved document | Version incremented exactly once; original successful save retained | 122 ms |
| Delete owned QA game; confirm absence | 204 / 200 | 86 / 115 ms |
| Log out; reuse revoked refresh token | 204 / 400; refresh rejected | 76 / 69 ms |

These durations are individual observations from this test environment, not a browser-performance benchmark or a latency guarantee.

## Cleanup and harness corrections

Two temporary accounts were used. The first run completed sign-up, login and game saving, then the test harness incorrectly expected 200 for a successful delete RPC; the service correctly returned 204. The harness was corrected and the second run completed all assertions. A redundant cleanup logout was subsequently removed from the harness. Neither issue was an application defect.

Both QA games were removed through the existing authorized delete-game RPC. After confirming each test identity had no sessions or memberships, only the two exact newly created QA auth records were deleted. Final database verification found zero QA accounts, profiles, sessions or games remaining.

The live Transformers game remained Night 1, document version 192, with 44 alive. No existing user, membership or live-game record was changed.

## Scope and limits

This closes the previously untested fresh-account HTTP path and authenticated create/save/load/stale-save/logout chain. It does not certify browser rendering, local session storage, startup callbacks, reconnect behavior, realtime synchronization, simultaneous invitation redemption or the complete browser approval/advance workflow. No production application changes were needed for the account API checks.
