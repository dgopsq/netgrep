# Patterns

A pattern is anything the Rust [`regex`](https://docs.rs/regex/) crate understands, which is what ripgrep
itself uses. Note that **smart case is hardcoded on**:

| Pattern | Behaviour |
|---|---|
| `sherlock` — all lowercase | case-**in**sensitive, matches `Sherlock` |
| `Sherlock` — contains an uppercase character | case-**sensitive**, does not match `sherlock` |

This is not configurable. Lowercase your pattern to search case-insensitively.

An invalid pattern — a stray `(`, or a literal newline from a pasted two-line string — is an ordinary
failure: `search` rejects, and the batch methods report it as `{ result: false, error: "…" }` like any other
error, carrying the regex crate's own diagnostic. Nothing needs escaping in advance, and one bad keystroke in
a search box does not affect the searches after it.
