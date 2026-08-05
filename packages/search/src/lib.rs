use grep_matcher::Matcher;
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
/// no decode, no string crossing the boundary.
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

/// The value `search_bytes_line_ranges` hands to JavaScript.
///
/// `getter_with_clone` because both fields are heap types: the getters return
/// copies, and the caller frees the carrier after reading them.
#[wasm_bindgen(getter_with_clone)]
pub struct LineWithRanges {
    /// The first matching line — terminator stripped, truncated, lossily
    /// decoded, exactly as `search_bytes_line` returns it.
    pub line: String,
    /// Flat `[start, end, …]` pairs, UTF-16 code units into `line`, one pair
    /// per match within it. Can be empty: every match can sit past the
    /// truncation cut, and `result` is still true.
    pub ranges: Vec<u32>,
}

/// Search a bytes array, returning the first matching line and where the
/// pattern matches within it.
///
/// `undefined` means no match, exactly as for `search_bytes_line` — a match on
/// an empty line yields an empty `line` with one `[0, 0]` range, so test for
/// `undefined`, never for truthiness.
///
/// A third entry point rather than a flag on the second, so each capture mode
/// pays only its own cost: the boolean path allocates nothing, the line path
/// runs no ranges pass.
///
/// Throws the same way the other two do when the pattern will not compile.
#[wasm_bindgen]
pub fn search_bytes_line_ranges(
    chunk: &[u8],
    pattern: &str,
    max_line_bytes: usize,
) -> Result<Option<LineWithRanges>, JsError> {
    try_search_bytes_line_ranges(chunk, pattern, max_line_bytes)
        .map(|hit| hit.map(|(line, ranges)| LineWithRanges { line, ranges }))
        .map_err(|error| JsError::new(&error))
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

/// `search_bytes_line_ranges`, as plain Rust. Split from the export for the
/// same reason as `try_search_bytes`.
///
/// The tuple is the line (terminator stripped, truncated, lossily decoded) and
/// flat `[start, end, …]` pairs — UTF-16 code units into that string, so a
/// JavaScript caller can `line.slice(start, end)` without conversion.
pub fn try_search_bytes_line_ranges(
    chunk: &[u8],
    pattern: &str,
    max_line_bytes: usize,
) -> Result<Option<(String, Vec<u32>)>, String> {
    with_matcher(pattern, |matcher| {
        search_line_ranges_with(matcher, chunk, max_line_bytes)
    })
}

/// Run `use_matcher` against the compiled form of `pattern`, compiling it only
/// if the memo is not already holding it.
///
/// Generic over the return type so all three entry points share one memo: the
/// slot caches the *matcher*, which is the expensive part, and is indifferent
/// to what the caller then does with it.
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

/// Build a searcher with netgrep's fixed reading semantics: search every byte
/// as text, and do not count lines.
///
/// Shared by all three entry points rather than spelled out in each. They must
/// agree — a caller who adds `capture: 'line-ranges'` to an existing search is
/// entitled to the same answer — and binary detection in particular decides
/// whether a whole block is abandoned, so a divergence here would be a
/// difference in `result`, not merely in what is returned alongside it.
///
/// `BinaryDetection::none()` rather than `quit(b'\x00')`, which abandoned the
/// entire block on the first NUL and so dropped matches that preceded it. The
/// trade is that netgrep no longer declines to search binary input at all: a
/// pattern occurring inside a `.png` is reported like any other match, and the
/// line handed back is whatever those bytes decode to.
fn build_searcher() -> Searcher {
    SearcherBuilder::new()
        .binary_detection(BinaryDetection::none())
        .line_number(false)
        .build()
}

/// Run a compiled matcher over one chunk of bytes.
fn search_with(matcher: &RegexMatcher, chunk: &[u8]) -> bool {
    let mut searcher = build_searcher();

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
    let mut searcher = build_searcher();

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

/// Run a compiled matcher over one block of bytes, keeping the first matching
/// line and where the pattern matches within it.
///
/// The ranges pass runs AFTER the search, over one line's bytes — it does not
/// touch the early exit, and a `capture: 'line'` or boolean caller never pays
/// for it.
///
/// `find_iter` runs over the full stripped line, not the truncated slice:
/// truncating first would let `$` match at the cut, reporting a match the
/// real line does not contain. Ranges past the cut are then dropped, and one
/// straddling it is clamped — the string cannot show what it does not hold.
fn search_line_ranges_with(
    matcher: &RegexMatcher,
    chunk: &[u8],
    max_line_bytes: usize,
) -> Option<(String, Vec<u32>)> {
    let mut searcher = build_searcher();
    let mut sink = LineSink { first: None };

    let _ = searcher.search_slice(matcher, chunk, &mut sink);

    sink.first.map(|line| {
        let content = strip_terminator(&line);
        let cap = floor_char_boundary(content, max_line_bytes);

        let mut byte_offsets: Vec<usize> = Vec::new();
        let _ = matcher.find_iter(content, |m| {
            byte_offsets.push(m.start());
            byte_offsets.push(m.end());
            true
        });

        // Drop pairs starting at or past the cut; clamp ends to it. `start ==
        // cap` survives only for the empty match on an empty line, where
        // dropping it would break "a match always has a range" in the one case
        // a caller cannot re-derive.
        let mut kept: Vec<usize> = Vec::with_capacity(byte_offsets.len());
        for pair in byte_offsets.chunks_exact(2) {
            let (start, end) = (pair[0], pair[1]);
            if start < cap || (start == 0 && cap == 0) {
                kept.push(start);
                kept.push(end.min(cap));
            }
        }

        let capped = &content[..cap];
        let ranges = byte_offsets_to_utf16(capped, &kept);

        (String::from_utf8_lossy(capped).into_owned(), ranges)
    })
}

/// Map ascending byte offsets in `bytes` to UTF-16 code-unit offsets in
/// `String::from_utf8_lossy(bytes)`.
///
/// One walk serves every offset. `utf8_chunks` yields exactly the segments
/// `from_utf8_lossy` replaces — each non-empty invalid part becomes one
/// U+FFFD — so counting UTF-16 units per segment reproduces the decoded
/// string's indexing without materialising a second copy. An offset landing
/// inside a character (a regex over bytes can split one) floors to that
/// character's start.
fn byte_offsets_to_utf16(bytes: &[u8], offsets: &[usize]) -> Vec<u32> {
    let mut out = Vec::with_capacity(offsets.len());
    let mut next = 0;
    let mut byte_pos = 0usize;
    let mut utf16_pos = 0u32;

    for chunk in bytes.utf8_chunks() {
        for ch in chunk.valid().chars() {
            while next < offsets.len() && offsets[next] < byte_pos + ch.len_utf8() {
                out.push(utf16_pos);
                next += 1;
            }
            byte_pos += ch.len_utf8();
            utf16_pos += ch.len_utf16() as u32;
        }

        let invalid = chunk.invalid();
        if !invalid.is_empty() {
            while next < offsets.len() && offsets[next] < byte_pos + invalid.len() {
                out.push(utf16_pos);
                next += 1;
            }
            byte_pos += invalid.len();
            utf16_pos += 1;
        }
    }

    while next < offsets.len() {
        out.push(utf16_pos);
        next += 1;
    }

    out
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
