# GM Command Center technical audit — 2026-09-05

## Status and scope

### Latest verified repair pass — v12.2.5

This section supersedes the historical checkpoints below. The audit is still incomplete, but the isolated workflow now reaches an official result and Day 1. The active Transformers game was not changed.

- Recovered browser interaction and added Audit Target as Unassigned. Started Night 0, queued Audit Actor's Personal Instant Kill against Audit Target, simulated it, and changed SUCCESS to FAILURE using the real GM editor and recalculation UI.
- Production approval reproduced two genuine SQL failures: ambiguous `value` in consumed-action extraction, then JSON `->>`/concatenation operator precedence in event summaries. Both existing-function repairs are deployed as migrations `20260905185154_fix_approval_consumption_ambiguity` and `20260905185225_fix_approval_summary_operator_precedence`. ACLs, membership checks, locks, idempotency and PT422 conflict handling were preserved. CLI was unavailable; migration filenames use the versions returned by production migration history.
- Approval was verified first inside a rolled-back transaction, then committed through the same public RPC under authenticated owner claims. Repeating the same idempotency key returned FINALIZED without another version increment. A test harness scope typo was corrected; it was not an app defect.
- Saved result: session FINALIZED, lock 4, game version 7, both players alive, failed action resolved, learning disabled. The browser displayed the official named-player result. Phase preview reported one resolved action and zero unresolved/open sessions. Existing advance RPC completed Night 0 and opened Day 1 with an empty queue, game version 8.
- Frontend repairs additionally preserve earlier GM action corrections through repeated recalculation, clear stale automatic reasons when changing outcomes, show player validation inline instead of native alerts, and apply the shared eligibility check to Guarantee. Role-wide passive links now include the actual `roleWidePassiveAbilityIds` editor field.
- Tests: 352 total, 351 passed, 0 failed, 1 optional fixture skipped. Syntax lint/typecheck and static build checked. SQL migration tests are source guards; the live transactional approval test is the behavioral evidence.
- Security advisors unchanged after migration: 44 callable-definer warnings and disabled leaked-password protection. No permissions were broadened. These warnings remain for further review.
- The first audit result retains old trace/morning-summary inaccuracies because it was calculated with the prior frontend. Its primary official row and live player state are correct. Do not rewrite immutable historical results to hide this evidence. The engine fixes prevent these defects in newly calculated results.

Remaining: complete passive/death cascades, timed statuses, richer grant approval cases, importer reanalysis, account lifecycle, two-user collaboration and exhaustive RPC/Storage security checks. This release is a tested repair pass, not complete certification of those systems. No Edge Function code changed or required deployment.

### Continuation checkpoint

The next pass added four behavioral regression tests and repaired finite-use Steal and explicitly selected Additional Uses in the existing engine. Steal now proposes a debit and a STOLEN player grant, honors non-stealable flags, caps the amount to remaining uses, and coalesces repeated debits so the last use cannot be stolen twice. Additional Uses now proposes a real player-specific grant instead of an ineffective status. It requires an identified existing grant and a positive whole-number count. Both reuse existing approval operations; no schema was changed. Unlimited/recurring theft and full production approval remain unverified, so these are **partially working**, not certified complete.

Latest checks: **346 tests, 345 passed, 0 failed, 1 skipped**; syntax lint and static build pass. Changes remain local and undeployed.

The browser retry exposed the specific second-player validation warning: Audit Operative has no available role slots. This is correct validation (one slot is already assigned). Dismissing the alert and attempting reload again caused browser-control timeouts. The proposed recovery is to close the alert/tab manually, reopen, and add Audit Target as Unassigned or increase the test role's slots. This narrows the earlier unknown browser symptom but does not establish its underlying cause.

**INCOMPLETE — do not interpret this report as production certification.**

Baseline: commit `baa7a2e`, version 12.2.4. Changes in this audit are local and not deployed. The active Transformers game was not modified. A separate production fixture, `Technical Audit — 2026-09-05` (`9bbe5f72-18d4-4c36-8087-254269258f34`), was created through the real UI. It contains one Audit Operative role and one assigned Audit Actor. Retained for continuing the workflow; no real player records were copied.

The requested audit covers 59 sections. This checkpoint records actual evidence and remaining work, not implied coverage from file existence or successful compilation.

## Systems found

| System | Existing implementation |
| --- | --- |
| Frontend | Static HTML (`index.html`), CSS (`css/main.css`), vanilla ES modules; main state and handlers in `js/app.js` |
| Backend | Supabase PostgreSQL, Auth, Storage, Realtime; RPC bridge in `js/cloud.js` |
| State and history | `game_documents` versioned JSON document, `games`, `game_members`, `change_history` |
| Accounts | Username mapped internally to synthetic Supabase email; passwords handled by Supabase Auth; IndexedDB session adapter in `js/cloud.js` |
| Document import | Mammoth DOCX extraction, `js/document-import.js`, `js/mechanics.js`, `gm-document-import` Edge Function |
| Roles and modes | Existing role records, `js/role-modes.js`, `player_mode_states`, `player_mode_events` |
| Player setup | `js/player-setup.js`, assignment preview/history RPCs |
| Abilities and uses | `js/global-abilities.js`, `js/player-abilities.js`, `js/player-runtime.js`, player-specific grant tables |
| Queue and phase | `js/phase-controller.js`, existing queue RPCs, `game_phases`, phase event history |
| Canonical simulation | `js/night-engine.js::resolveNightDeterministically` |
| Review/edit/recalculate | `js/resolution.js`, `js/resolution-editor.js`, `js/resolution-review.js`, `recalculateNight` |
| Approval | `approve_and_apply_resolution`, resolution session locks, existing transactional database implementation |
| AI and learning | `js/copilot.js`, `js/knowledge.js`, gm-copilot/gm-knowledge-ingest Edge Functions, precedents/concepts/rules |
| Collaboration/invites | `GMCloud.subscribe`, game membership and invitation RPCs with RLS |
| Deployment | GitHub Pages static files; Supabase migrations and Edge Functions; no frontend bundler |

## Existing night engine and runtime path

The ordinary Resolve Night path opens a phase-scoped resolution session, reads `submitted_actions` and `pre_resolution_state`, calls `resolveNightDeterministically` in the browser, optionally adjudicates isolated unknown interactions, saves the proposal via `save_deterministic_resolution`, and presents GM review. Approval uses the existing transactional RPC. It does not replace live state during calculation.

The ten executable categories are BLOCKS, GUARANTEE, CONTROL, SWAPS, REDIRECTS, STATUS EFFECTS, INTEL, CONVERTS, KILLS, DOC. Reflection, immunity and Counterattack have special automatic processing. This is not yet a general implementation of every advertised passive event.

## Reproduced problems and local fixes

Regression tests were run against the original implementation first. Seven initial tests failed; blocked Steal shares the Save gating defect; a separately corrected generated-effect fixture also reproduced a failure.

1. **Blocked Save changed death state.** Its special handler ran before block checks. Moved the shared block gate ahead of special execution, also protecting Steal and Duel.
2. **Blocked kills appeared as survived attacks.** Morning summary counted submitted kill targets. It now derives attacked targets from actual `KILL_ATTEMPTED` events, including generated/collateral lethal attempts.
3. **Snapshot-only replay dropped actions.** `buildNightSnapshot` discarded `submitted_actions`. It now deep-copies them.
4. **Missing actor with a mode aborted the whole night.** Unsafe actor name dereference now permits an individual ineligible result and unrelated actions continue.
5. **Reflection dropped unrelated multi-target destinations and emitted duplicate redirect events.** Only the reflected destination is transformed; the duplicate event was removed.
6. **Linked passive IDs were ignored.** Role/current-accessible-mode passive IDs now resolve names through the existing ability encyclopedia.
7. **Mode Protect/Super Protect defenses were collected but not applied.** Lethal resolution now considers their protection tiers, without character-name checks.
8. **Generated effects in already-passed categories stayed pending under a RESOLVED night.** Any unexecuted effect now becomes an explicit GM-review interaction rather than silent success. Defining/replaying earlier-stage generated timing remains future work.

Modified canonical module: `js/night-engine.js`. New behavioral regressions: `tests/audit-engine-regressions.test.mjs`. No new engine, table, service, or state manager was created.

## Actual test outcomes

- Blocker → doctor, killer → target, doctor Save → target: Save BLOCKED; target DEAD.
- Blocker → killer: target alive but absent from attacked-but-survived summary.
- Snapshot-only kill: exactly one action processed; target DEAD.
- Missing-mode actor alongside valid kill: malformed action INELIGIBLE; valid kill still resolves.
- Mark → reflector + another target: effective targets actor + other target; exactly one redirect event.
- Encyclopedia-linked Death Immunity: target survives.
- Shield Form with Protect: standard kill stopped.
- Blocked Steal: no grant mutations.
- Wheel generates Roleblock after BLOCKS: explicit GM_REVIEW_REQUIRED; no silently pending child.

Existing tests also passed for Guarantee versus block/protection, Place Swap and Intel, Redirect/Guard, amplification, conversion before kills, Save/Heal, faction blocks, Counterattack, mode access, seeded generation/recalculation, Mark-generated kill, Omega collateral and a complex eight-player night. These are module tests, **not** proof of a completed production approval workflow.

## Build and test results

- `pnpm test`: **342 tests, 341 passed, 0 failed, 1 skipped** (optional Transformers DOCX fixture).
- `pnpm lint`: passed; this command is JavaScript syntax checking, not a full lint ruleset.
- `pnpm typecheck`: passed; despite its name it repeats syntax checks and does **not** provide TypeScript type safety or validate all Edge Function types.
- `pnpm build`: static-file validation passed; this is not a bundled production compilation.
- New browser workflow: game creation, role/ability selection, player assignment, persistence and session restoration verified. Second player submission did not reach persisted state. Browser interaction subsequently stopped responding; a fresh tab restored the authenticated session but navigation attempts had no visible effect. Cause not established: do not label this a proven application deadlock or a fixed issue.

## Database and security evidence

- Production public tables inspected: RLS enabled throughout the returned table inventory.
- A transaction using `authenticated` with a non-member subject returned zero games, documents, memberships and resolution sessions, then rolled back. This is a concrete negative read-access test, not exhaustive RPC/storage security certification.
- During the browser problem, authenticator sessions were idle; no active retry storm was observed in that sample.
- Security advisor: 44 authenticated SECURITY DEFINER callable-function warnings; each requires intentional-exposure and membership-check review, not blanket revocation. Leaked-password protection is disabled.
- Performance advisor: 21 unindexed foreign keys and 49 unused-index notices. No indexes were dropped based merely on usage counters.
- No new migration or production schema change in this pass. Prior 12.2.4 conflict/retry-storm migrations remain in place.
- References: [privileged RPC review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [foreign-key index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

The Supabase skill guided the live RLS/advisor checks. No warning was suppressed to make the health report appear clean.

## Duplicate systems and AI usage

The UI uses the existing browser deterministic engine. The older AI `resolve_actions` task still exists in gm-copilot; its remaining callers require audit before safe removal or redirection. `resolution.js` and review/editor modules are not automatically duplicate resolvers merely because of their names. No legacy path was deleted without proving reachability.

Known deterministic module tests: **0 AI calls before; 0 AI calls after**. The engine contains no network request. The ordinary frontend only enters fallback for unresolved interactions. Import, chat and the older explicit AI resolution task can still call AI. Production network-level zero-call verification of a complete approval cycle remains pending.

## Remaining substantive work

Inspection found gaps that must not be certified as working:

- Finite-use Steal and explicitly selected Additional Uses now have local fixes (see continuation checkpoint); production approval, unlimited/recurring grants and queue parameter entry remain to verify.
- Generic custom passive trigger dispatch and dependent on-death cascades are not comprehensively implemented.
- Status duration/Poison delayed death and Hanging timing need end-to-end verification against phase advancement.
- Structured game-rule and precedent priority is partly represented as authority metadata; general execution of arbitrary structured overrides is not established.
- Watch/Track/action-check visitor filtering, mode-specific investigation appearance and conversion restrictions need behavioral coverage and repairs.
- Guarantee uses a special handler and needs persistent-disable eligibility coverage.
- Full resolution correction dependency semantics, grant consumption on failed/ineligible actions, random replay under changed pools and bounded passive cascade handling require additional tests.
- Save/load and Realtime callbacks contain mutable global state across async boundaries; game-switch and same-account multi-tab conflict cases need targeted integration tests.
- DOCX import/reanalysis preserving GM edits, account creation/logout, invitation redemption, two-GM simultaneous approval, stale writes, rollback fault injection, Storage isolation and secret scanning remain incomplete.
- Documentation and script names overstate some capabilities. In particular, the current typecheck command is not a real typecheck.

## Final health status for this checkpoint

| System | Status | Evidence boundary |
| --- | --- | --- |
| Game creation and basic role/player saving | ✅ WORKING | Observed UI and persisted audit fixture |
| Existing session restoration | ✅ WORKING | Authenticated fresh tab loaded saved fixture |
| Complete account lifecycle | ⚠️ PARTIALLY WORKING | Signup/logout/password flows not completed |
| Role/mode/import system | ⚠️ PARTIALLY WORKING | Editor and selected mechanics tested; full DOCX path pending |
| Queue/phase/controller/tracker | ⚠️ PARTIALLY WORKING | Existing tests and live queue observed; full new cycle pending |
| Standard deterministic engine | ⚠️ PARTIALLY WORKING | Many tested interactions pass; grant/passive/timing gaps remain |
| Steal transfer / Additional Uses | ⚠️ PARTIALLY WORKING | Local selected-grant fixes tested; production approval and broader grant cases pending |
| Review/recalculate/approval | ⚠️ PARTIALLY WORKING | Local tests and traced path; production commit cycle pending |
| Invitations / multiple-GM sync | ⚠️ PARTIALLY WORKING | Implementation traced; multi-user workflow not completed |
| Security and isolation | ⚠️ PARTIALLY WORKING | Negative RLS reads pass; broader RPC/Storage audit pending |
| AI-free known resolution | ✅ WORKING | Local deterministic test scope only |
| Frontend runtime | ⚠️ PARTIALLY WORKING | Initial workflows worked; later controls unresponsive |
| Build/checks | ⚠️ PARTIALLY WORKING | Commands pass; actual TS and full E2E coverage absent |

**Next required step:** restore browser interaction, complete the isolated queue → simulate → edit/recalculate → approve → advance → tracker workflow, then continue the remaining security/import/multi-user tests. Do not deploy these local engine changes as a complete-audit release without that verification.
