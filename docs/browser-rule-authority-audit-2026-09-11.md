# Browser/server rule-authority metadata parity

Frontend 12.2.55; deterministic engine 1.2.22. Copilot remains v28. The full audit remains **INCOMPLETE**.

The browser still advertised current-game precedents above the Global Master Ability Encyclopedia after the server AI request contract was corrected. Its exported profile and deterministic result metadata now use the same requested ordering as the server: explicit game rule, explicit role/ability rule, encyclopedia, saved precedents, then AI/GM review. The immutable public constant remains frozen.

Three runtime regression tests failed before the change and pass afterward. They check the browser profile, parity with the actual pure server profile module, and deterministic result metadata while preserving an ordinary kill outcome, input immutability and zero AI fallback calls. The full suite with the supplied Transformers DOCX passes **863 tests, zero failures and zero skips**. Syntax, static-build and diff checks pass; these are not native-browser workflow tests.

The dependency chain importing the changed browser constant was cache-versioned consistently: global abilities, mechanics, document import, player abilities, resolution editor, night engine and the app entrypoint. Unrelated modules keep their existing cache versions. No database, Edge Function, account, Storage, provider-price or live-game change is required.

This is metadata consistency, not a new rule interpreter. The engine's authority labels do not prove that arbitrary game rules or precedents were executed. Full deterministic custom-rule integration, custom passive rewards, durable cost tracking and multi-GM browser tests remain open. Historical saved resolutions were not rewritten.
