# Patterns

A pattern is anything the Rust [`regex`](https://docs.rs/regex/) crate understands, the same crate ripgrep
itself uses. **Smart case is hardcoded on**:

| Pattern | Behaviour |
|---|---|
| `sherlock` (all lowercase) | case-**in**sensitive, matches `Sherlock` |
| `Sherlock` (contains an uppercase character) | case-**sensitive**, does not match `sherlock` |

This is not configurable. Lowercase your pattern to search case-insensitively.

An invalid pattern (a stray `(`, or a literal newline from a pasted two-line string) is an ordinary failure:
`matches` rejects and `grep` throws from the first turn of the loop, both carrying the regex crate's own
diagnostic and both before the connection opens — a typo costs no request at all. Nothing needs escaping in
advance, and one bad keystroke in a search box does not affect the searches after it.
