use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    /// The last pattern compiled, and what compiling it produced.
    ///
    /// netgrep hands the engine one `fetch` chunk at a time, so a batch over
    /// 200 files averaging four chunks each used to compile the same pattern
    /// 800 times and throw the result away. Compilation dominates: measured
    /// over 800 16 KB chunks, a literal took 91 ms compiling-per-chunk against
    /// 2.2 ms compiled once, and a Unicode class 2.9 s against 21 ms.
    ///
    /// ONE ENTRY IS ENOUGH. Every caller of a single `searchBatch` shares one
    /// pattern, so a single slot hits on every chunk after the first. The case
    /// it does not cover is two patterns interleaving — a search-as-you-type
    /// box whose previous keystroke has not finished — and there the slot
    /// simply thrashes back to the old behaviour, plus one string comparison.
    ///
    /// FAILURES ARE CACHED TOO. An invalid pattern is exactly what a search box
    /// produces mid-typing, and without this it would re-fail once per chunk
    /// per url.
    ///
    /// `thread_local!` rather than a `static`: wasm32 is single-threaded so
    /// this is simply the safe way to spell "global" there, and under
    /// `cargo test` — which runs a thread per test — it keeps the tests
    /// independent of each other.
    static LAST_COMPILED: RefCell<Option<(String, Result<RegexMatcher, String>)>> =
        const { RefCell::new(None) };
}

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
/// The error is a `String` rather than `grep_regex::Error` because it is cached
/// in `LAST_COMPILED` and handed out repeatedly, and that type is not `Clone`.
pub fn try_search_bytes(chunk: &[u8], pattern: &str) -> Result<bool, String> {
    LAST_COMPILED.with_borrow_mut(|slot| {
        // Taken out and put back rather than borrowed in place: a reference
        // into `slot` cannot outlive the reassignment that replaces a stale
        // entry, and moving the pair sidesteps that entirely.
        let entry = match slot.take() {
            Some((cached, compiled)) if cached == pattern => (cached, compiled),
            _ => (pattern.to_owned(), build_matcher(pattern)),
        };

        let result = match &entry.1 {
            Ok(matcher) => Ok(search_with(matcher, chunk)),
            Err(error) => Err(error.clone()),
        };

        *slot = Some(entry);

        result
    })
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
