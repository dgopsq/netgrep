# 0011 — Tests that deliberately assert incorrect behaviour

**Status:** Accepted (2026-07-28).

## Context

netgrep has known, unfixed correctness bugs: a pattern straddling a `fetch` chunk boundary is missed, a
partial cache answers later queries, a single NUL byte discards a chunk, `$` misses on CRLF input. (The
invalid-pattern trap was on this list until 2026-07-29; see the second amendment below.) They are documented in [`../ARCHITECTURE.md`](../ARCHITECTURE.md#known-limitations--correctness-caveats)
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

> **Amended (2026-07-29).** `packages/search/tests/search.rs` now has a `documented_defects` module under the
> same rule, for the defects that live in `lib.rs` — the panic on an invalid pattern, the NUL that discards a
> chunk, and `$` on CRLF input. Those are pure bytes-in/bool-out, so pinning them in Rust as well means a
> failure names the engine directly, with no browser, stream or cache in the way. The integration assertions
> stay: they are what proves the defect survives the whole path to a consumer.

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

> **Amended again (2026-07-29).** The first of these tests was retired the way this record prescribes, which
> is the point of writing it down. BACKLOG 3c — the trap on an invalid pattern — was fixed in
> [0016](0016-compiled-matcher-memo.md), and its three assertions were inverted **in the same PR**: two
> `#[should_panic]` tests in `search.rs` became assertions on the error message, and the integration test
> asserting `rejects.toThrow('unreachable')` became one asserting a real diagnostic plus the thing the trap
> had made impossible to assert — that the same instance still answers correctly afterwards. Both keep their
> `BACKLOG 3c` label with a `(FIXED)` marker and a note saying what they used to claim, following 3e.
