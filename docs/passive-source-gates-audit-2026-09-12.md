# Passive source gates — scoped runtime audit

Release: frontend 12.2.56; canonical engine 1.2.23. The full project audit remains **INCOMPLETE**.

## Reproduced defect

The existing passive resolver honored custom identity and fixed engine-behavior conflicts, but not explicit optional/conditional fields on the owned passive source or its parsed mechanics. A Death Immunity, Bulletproof, Reflection or Counterattack entry could therefore execute its standard behavior even when its stored source required a choice, dependency, different trigger or limited trigger count.

The original eight synthetic regression cases failed before the repair; both standard-behavior controls passed. The final focused suite has 16 passing tests.

## Repair in the existing engine

`passiveRequiresReview` now also checks owned source/understanding fields and relevant passive mechanic records in `understanding.mechanics`, `mechanicalStatements` and `mechanical_statements`.

- Explicit optional behavior and explicit automatic opt-out require review.
- Nonempty conditions/dependencies and specified trigger limits, including zero, require review.
- A declared trigger that differs from the standard handler requires review.
- Ordinary matching automatic triggers and empty constraints retain existing execution.
- Parser-derived `automatic:false` for `UNDEFINED`/`NOT_APPLICABLE` is not mistaken for an explicit opt-out. Unrelated active-mechanic conditions do not disable the passive.

This uses the existing saved GM-review path, with no AI fallback, invented choice, generated passive effect or new engine. Tests assert source immutability, unchanged target identity and review persistence through the actual resolution-editor payload. The source record is preserved.

## Test harness repair

The first full run also exposed ten intermittent failures in the existing mocked Edge-handler accounting/authority tests. These tests were registered before later asynchronous handler-fixture compilation finished. Adding an in-memory 100 ms delay before compilation reproduced the same ten failures (37/47 passing). Moving compilation before test registration made the same delayed check pass 47/47. No Edge code or test assertions were changed.

## Verification and limits

The complete JavaScript suite passes 879 tests, zero failures and zero skips, including the supplied Transformers DOCX. JavaScript syntax, static build and diff checks accompany release verification. Handler/provider tests use synthetic mocks, not paid provider requests.

This is a guard against silently ignoring stored rules, **not execution of arbitrary conditions or optional choices**. Custom predicates, passive rewards/on-death causality, general game-rule/precedent execution, durable cost accounting and the native two-GM browser workflow remain open. A proposal with an unsupported passive is provisional and requires GM review; the guard does not prove that the owner should die.

No database migration, Edge deployment, account change, live Transformers simulation, phase advancement or live-game write is part of this repair.
