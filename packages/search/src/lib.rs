use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

/// A pattern, and what compiling it produced.
///
/// The failure is kept rather than discarded: an invalid pattern is exactly
/// what a search box emits mid-typing, and without this it would re-fail once
/// per chunk per url. It is a `String` rather than `grep_regex::Error` because
/// it is handed out repeatedly and that type is not `Clone`.
struct Compiled {
    pattern: String,
    matcher: Result<RegexMatcher, String>,
}

thread_local! {
    /// The last pattern compiled.
    ///
    /// netgrep hands the engine one `fetch` chunk at a time, so a batch over
    /// 200 files averaging four chunks each used to compile the same pattern
    /// 800 times and throw the result away. Compilation turned out to be
    /// 97–99% of the cost; the measurements are in
    /// [decision 0016](../../../docs/decisions/0016-compiled-matcher-memo.md),
    /// which also records why the compiled-matcher *handle* proposed in issue
    /// #17 was not the shape taken.
    ///
    /// ONE ENTRY IS ENOUGH. Every caller of a single `searchBatch` shares one
    /// pattern, so a single slot hits on every chunk after the first. The case
    /// it does not cover is two patterns interleaving — a search-as-you-type
    /// box whose previous keystroke has not finished — and there the slot
    /// simply thrashes back to the old behaviour, plus one string comparison.
    ///
    /// `thread_local!` rather than a `static`: wasm32 is single-threaded so
    /// this is simply the safe way to spell "global" there, and under
    /// `cargo test` — which runs a thread per test — it keeps the tests
    /// independent of each other.
    static LAST_COMPILED: RefCell<Option<Compiled>> = const { RefCell::new(None) };
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
pub fn try_search_bytes(chunk: &[u8], pattern: &str) -> Result<bool, String> {
    LAST_COMPILED.with_borrow_mut(|slot| {
        // Taken out and put back rather than borrowed in place: a reference
        // into `slot` cannot outlive the reassignment that replaces a stale
        // entry, and moving the whole entry sidesteps that entirely.
        let entry = match slot.take() {
            Some(entry) if entry.pattern == pattern => entry,
            _ => Compiled {
                pattern: pattern.to_owned(),
                matcher: build_matcher(pattern),
            },
        };

        let result = match &entry.matcher {
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

    let mut sink = MemSink { found: false };

    let _ = searcher.search_slice(matcher, chunk, &mut sink);

    sink.found
}

/// A `Sink` that records whether anything matched, and nothing else — chosen
/// because ripgrep's real sinks write to a stdout that does not exist in WASM,
/// and because a boolean is the entire public answer. See
/// [decision 0003](../../../docs/decisions/0003-boolean-only-results.md).
struct MemSink {
    found: bool,
}

impl Sink for MemSink {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &Searcher,
        _mat: &SinkMatch<'_>,
    ) -> Result<bool, std::io::Error> {
        self.found = true;

        // `false` means "stop". netgrep answers a boolean, so every match after
        // the first is scanned for nothing: this used to count them all, to the
        // end of the chunk. The answer is identical either way, which is why no
        // test can pin it and decision 0016 carries the measurement instead.
        Ok(false)
    }
}
