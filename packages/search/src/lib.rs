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

/// Search a bytes array for the given pattern, returning the first matching
/// line rather than a boolean.
///
/// `undefined` in JavaScript means no match; a string is the line, with its
/// terminator removed and truncated to `max_line_bytes`. **A match on an empty
/// line yields an empty string**, so a caller must test for `undefined` rather
/// than for truthiness.
///
/// A separate export rather than a change to `search_bytes`, so a caller that
/// only wants membership goes on paying for membership only — no allocation,
/// no decode, no string crossing the boundary. See
/// [decision 0020](../../../docs/decisions/0020-the-matching-line.md).
///
/// Throws the same way `search_bytes` does when the pattern will not compile.
#[wasm_bindgen]
pub fn search_bytes_line(
    chunk: &[u8],
    pattern: &str,
    max_line_bytes: usize,
) -> Result<Option<String>, JsError> {
    try_search_bytes_line(chunk, pattern, max_line_bytes).map_err(|error| JsError::new(&error))
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
    with_matcher(pattern, |matcher| search_with(matcher, chunk))
}

/// `search_bytes_line`, as plain Rust. Split from the export for the same
/// reason as `try_search_bytes`.
pub fn try_search_bytes_line(
    chunk: &[u8],
    pattern: &str,
    max_line_bytes: usize,
) -> Result<Option<String>, String> {
    with_matcher(pattern, |matcher| {
        search_line_with(matcher, chunk, max_line_bytes)
    })
}

/// Run `use_matcher` against the compiled form of `pattern`, compiling it only
/// if the memo is not already holding it.
///
/// Generic over the return type so both entry points share one memo: the slot
/// caches the *matcher*, which is the expensive part, and is indifferent to
/// what the caller then does with it.
fn with_matcher<T>(
    pattern: &str,
    use_matcher: impl FnOnce(&RegexMatcher) -> T,
) -> Result<T, String> {
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
            Ok(matcher) => Ok(use_matcher(matcher)),
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

/// Run a compiled matcher over one block of bytes, keeping the first matching
/// line.
fn search_line_with(matcher: &RegexMatcher, chunk: &[u8], max_line_bytes: usize) -> Option<String> {
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(false)
        .build();

    let mut sink = LineSink { first: None };

    let _ = searcher.search_slice(matcher, chunk, &mut sink);

    sink.first.map(|line| decode_line(&line, max_line_bytes))
}

/// A `Sink` that keeps the bytes of the first matching line.
///
/// The line is copied rather than borrowed because `SinkMatch` does not outlive
/// the callback, and it is copied *before* any decoding or truncation so this
/// stays the cheap half — the expensive half happens once, outside the search.
struct LineSink {
    first: Option<Vec<u8>>,
}

impl Sink for LineSink {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &Searcher,
        mat: &SinkMatch<'_>,
    ) -> Result<bool, std::io::Error> {
        self.first = Some(mat.bytes().to_vec());

        // Same short-circuit as `MemSink`: only the FIRST match is wanted, so
        // there is nothing left to look for. Unlike there, this one is
        // observable — keep searching and the field would end up holding the
        // last matching line instead of the first.
        Ok(false)
    }
}

/// Turn one matched line's raw bytes into the string that crosses the boundary.
///
/// Three lossy steps, in an order that matters:
///
/// 1. **Strip the terminator.** `SinkMatch::bytes()` includes the trailing
///    `\n`, and a `\r` before it on Windows-authored input. Both are line
///    *structure* rather than content, and rendering either verbatim in a UI is
///    a defect the caller cannot fix without knowing this.
/// 2. **Truncate**, so the cap applies to visible content rather than to
///    content-plus-terminator, and so one minified bundle cannot copy megabytes
///    per file into JavaScript.
/// 3. **Decode**, last, so the lossy pass runs over at most `max_line_bytes`.
fn decode_line(line: &[u8], max_line_bytes: usize) -> String {
    let content = strip_terminator(line);
    let capped = &content[..floor_char_boundary(content, max_line_bytes)];

    String::from_utf8_lossy(capped).into_owned()
}

/// Drop one trailing `\n`, and a `\r` immediately before it.
///
/// Only as a pair: a lone `\r` in the middle of a line under netgrep's
/// `\n`-terminator semantics is ordinary content, and a file using bare CR line
/// endings is one line as far as this engine is concerned.
fn strip_terminator(line: &[u8]) -> &[u8] {
    match line.strip_suffix(b"\n") {
        Some(rest) => rest.strip_suffix(b"\r").unwrap_or(rest),
        None => line,
    }
}

/// The largest index at or below `max` that does not split a UTF-8 character.
///
/// Truncating mid-character would turn one legitimate multi-byte character into
/// replacement characters at the very end of every capped line — the one place
/// a reader is most likely to notice. `str::floor_char_boundary` does this in
/// std but is still unstable, so it is spelled out: continuation bytes are
/// `0b10xxxxxx`, and a boundary is any byte that is not one.
fn floor_char_boundary(bytes: &[u8], max: usize) -> usize {
    if bytes.len() <= max {
        return bytes.len();
    }

    let mut end = max;

    while end > 0 && bytes[end] & 0xC0 == 0x80 {
        end -= 1;
    }

    end
}
