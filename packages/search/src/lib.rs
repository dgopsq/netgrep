use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use wasm_bindgen::prelude::*;

/// Search a bytes array for the given pattern. This function
/// uses `ripgrep` under the hood.
///
/// Throws a JavaScript `Error` when the pattern is not something the regex
/// engine accepts — a stray `(`, or a literal newline, both of which arrive
/// routinely from a user's search box. It used to `unwrap()` instead, which
/// trapped the WASM instance with `RuntimeError: unreachable`.
#[wasm_bindgen]
pub fn search_bytes(chunk: &[u8], pattern: &str) -> Result<bool, JsError> {
    try_search_bytes(chunk, pattern).map_err(|error| JsError::new(&error))
}

/// The engine, as plain Rust.
///
/// `search_bytes` above is a two-line wrapper around this, and the split is
/// load-bearing rather than tidiness: `JsError` is a `wasm-bindgen` import, and
/// constructing one on a native target panics with *"cannot call wasm-bindgen
/// imported functions on non-wasm targets"*. The Rust suite in `tests/` runs
/// natively, so anything it needs to assert about the error path has to be
/// reachable without a `JsError` in the signature.
///
/// The error is a `String` rather than `grep_regex::Error` so that it can be
/// handed on without dragging a `grep-regex` type into every caller's
/// signature.
pub fn try_search_bytes(chunk: &[u8], pattern: &str) -> Result<bool, String> {
    let matcher = build_matcher(pattern)?;

    Ok(search_with(&matcher, chunk))
}

/// Compile a pattern with netgrep's fixed matching semantics: `\n` terminates a
/// line, and smart case is on.
fn build_matcher(pattern: &str) -> Result<RegexMatcher, String> {
    RegexMatcherBuilder::new()
        .line_terminator(Some(b'\n'))
        .case_smart(true)
        .build(pattern)
        .map_err(|error| error.to_string())
}

/// Run a compiled matcher over one chunk of bytes.
fn search_with(matcher: &RegexMatcher, chunk: &[u8]) -> bool {
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(false)
        .build();

    let mut sink = MemSink { match_count: 0 };

    let _ = searcher.search_slice(matcher, chunk, &mut sink);

    sink.match_count > 0
}

/// An in-memory `Sink` implementation in order
/// to store the matches in a structured way instead
/// of just writing on a stdout.
struct MemSink {
    match_count: u64,
}

impl Sink for MemSink {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &Searcher,
        _mat: &SinkMatch<'_>,
    ) -> Result<bool, std::io::Error> {
        self.match_count += 1;
        Ok(true)
    }
}
