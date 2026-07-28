# 0011 — Tests that deliberately assert incorrect behaviour

**Status:** Accepted (2026-07-28).

## Context

netgrep has known, unfixed correctness bugs: a pattern straddling a `fetch` chunk boundary is missed, a
partial cache answers later queries, an invalid pattern traps the WASM instance, a single NUL byte discards a
chunk. They are documented in [`../ARCHITECTURE.md`](../ARCHITECTURE.md#known-limitations--correctness-caveats)
and tracked in [`../BACKLOG.md`](../BACKLOG.md).

Fixing them is out of scope for dependency work: the first two interact, and a naive fix to either destroys
the early-resolution property that is the entire point of the project ([0002](0002-search-while-downloading.md)).

That left a gap. A large dependency migration — `wasm-bindgen` across 44 minor versions, a ripgrep fork
dropped, a whole JS toolchain replaced — needed to support the claim "behaviour is identical". Nothing in the
repository could substantiate it: the only TypeScript suite mocked both `fetch` *and* the engine.

## Decision

The integration suite ends with a block titled
**`documented defects (asserting current, incorrect behaviour)`**, whose assertions encode what netgrep
**actually does today**, wrong answers included.

The rule that makes this safe: **when a defect is genuinely fixed, its assertion is inverted in the same PR**,
with a note explaining what changed. A defect test may never be edited to make CI green.

## Consequences

**Good:**
- Unintended behaviour change is detected rather than assumed away. This is the only mechanism that can catch
  a dependency upgrade quietly altering matching semantics.
- The bugs are executable documentation. A reader sees exactly what breaks, with inputs, instead of prose.
- A fix cannot land silently: inverting the assertion forces the change to be visible in review.

**Costs:**
- It reads as wrong at a glance, and will keep reading as wrong to anyone who meets it cold. Mitigated with a
  block comment at the site and a prominent section in [`../../AGENTS.md`](../../AGENTS.md) §2.1 — the first
  thing an agent is told after what the project is.
- A green suite does **not** mean the library is correct. It means the library behaves as it did yesterday.

## It has already paid for itself

Dropping the ripgrep fork for current `grep-regex` / `grep-searcher` **silently fixed** the `^`-anchoring bug
— `^` had been anchoring to the start of the chunk rather than the line whenever `case_smart` left a pattern
case-sensitive. No source change, no release note, nothing else in the repository would have noticed.

The defect test failed, the change was investigated, the new behaviour was confirmed correct, and the
assertion was inverted in the same PR. That is the mechanism working exactly as intended.
