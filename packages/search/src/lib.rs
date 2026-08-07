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
    /// ONE ENTRY IS ENOUGH. Every chunk of every url in one search shares the
    /// same pattern, so a single slot hits on every chunk after the first. The
    /// case it does not cover is two patterns interleaving — a search-as-you-type
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

/// The value `search_block` hands to JavaScript.
///
/// Two fields rather than a vector of structs, and the choice is load-bearing.
/// A `serde-wasm-bindgen` `Vec<BlockHit>` builds every JavaScript object
/// eagerly at marshalling time; searching a common token across a 240 MB log
/// produces hundreds of thousands of them, live at once, which is exactly the
/// allocation pressure the project's constant-memory claim cannot afford. Here
/// the crossing is one string and one integer array per block whatever the hit
/// count, and the consumer builds each object at the moment it yields it.
///
/// `getter_with_clone` because both fields are heap types: the getters return
/// copies, and the caller frees the carrier once it has read them.
#[wasm_bindgen(getter_with_clone)]
pub struct BlockHits {
    /// The matching lines in hit order, joined by `\n`.
    ///
    /// Unambiguous by construction: lines are terminator-stripped, and a match
    /// can never span a `\n`, so no segment can contain the separator.
    pub text: String,
    /// `[hitCount, linesInBlock]`, then per hit
    /// `[lineNumber, nRanges, start, end, …]`, where `nRanges` counts **pairs**
    /// — so a hit's record is `2 + nRanges * 2` words long.
    pub table: Vec<u32>,
}

/// Flatten a `BlockOutcome` into the wire format.
fn encode_block(outcome: BlockOutcome) -> BlockHits {
    let mut table = Vec::with_capacity(2 + outcome.hits.len() * 4);
    table.push(outcome.hits.len() as u32);
    table.push(outcome.lines_in_block);

    let mut text = String::new();

    for (index, hit) in outcome.hits.iter().enumerate() {
        if index > 0 {
            text.push('\n');
        }
        text.push_str(&hit.line);

        table.push(hit.line_number);
        table.push((hit.ranges.len() / 2) as u32);
        table.extend_from_slice(&hit.ranges);
    }

    BlockHits { text, table }
}

/// The native half of `search_block`, for the Rust suite.
pub fn try_encode_block(
    chunk: &[u8],
    pattern: &str,
    max_line_bytes: usize,
) -> Result<BlockHits, String> {
    try_search_block(chunk, pattern, max_line_bytes).map(encode_block)
}

/// Search a block and return every matching line, flattened.
///
/// Every match, not just the first: the streaming loop above this yields one
/// result per matching line, so stopping early would lose all but one of them.
/// Two values cross the boundary per block however many lines matched; see
/// `BlockHits` for the layout and why it is not a vector of structs.
///
/// A match on an empty line yields an empty `line` with one `[0, 0]` range, so
/// a consumer must count hits rather than test the line for truthiness.
///
/// Throws a JavaScript `Error` when the pattern will not compile, exactly as
/// `search_bytes` does.
#[wasm_bindgen]
pub fn search_block(
    chunk: &[u8],
    pattern: &str,
    max_line_bytes: usize,
) -> Result<BlockHits, JsError> {
    try_encode_block(chunk, pattern, max_line_bytes).map_err(|error| JsError::new(&error))
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

/// Search a block for every matching line.
///
/// The native half of `search_block`, for the reason `try_search_bytes` gives:
/// `JsError` cannot be constructed on a native target, so the Rust suite calls
/// this.
pub fn try_search_block(
    chunk: &[u8],
    pattern: &str,
    max_line_bytes: usize,
) -> Result<BlockOutcome, String> {
    with_matcher(pattern, |matcher| {
        search_block_with(matcher, chunk, max_line_bytes)
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
/// line, `^` and `$` treat a `\r\n` ending as the line ending, and smart case is
/// on.
///
/// `.multi_line(true)` is required alongside `.crlf(true)`: a bare `$` parses
/// to the same AST node as `(?m)$`, and `regex-syntax` only picks the
/// CRLF-aware `Look::EndCRLF` over the absolute-end `Look::End` when multi-line
/// mode is on — `crlf(true)` alone leaves an unqualified `$` untouched, so it
/// still misses before `\r\n` exactly as before. Verified empirically against
/// `grep-regex-0.1.14`, since the crate's own doc comment on `crlf` does not
/// say this.
///
/// ⚠️ `.crlf(true)` MUST come before `.line_terminator(…)`. `crlf` sets the line
/// terminator as well as the anchor behaviour — to `\r\n` — while
/// `line_terminator` leaves the anchor behaviour alone. Called the other way
/// round the terminator ends up `\r\n`, and the whole streaming loop rests on it
/// being `\n`: `splitAtLastLine` carries the incomplete trailing *line* between
/// chunks because a match can never span a `\n`, which is what
/// `test_a_match_cannot_span_a_line_terminator` pins. `multi_line` does not
/// interact with this: it only chooses which `Look` a line anchor compiles to,
/// and does not touch the line terminator field.
///
/// Reversed, this does not fail silently in the sense of shipping a wrong
/// answer unnoticed: `build_searcher`'s own line terminator stays `\n`, so
/// `grep-searcher`'s internal `check_config` rejects the mismatch against the
/// matcher's `\r\n` on every call — though that `Result` is discarded below
/// (`let _ = searcher.search_slice(…)`), so the rejection itself never
/// surfaces anywhere. What is loud is the symptom: measured, not assumed — 49
/// of this crate's 58 tests fail immediately when the two lines above are
/// swapped, because nearly every search comes back with no match. CI catches
/// that before it reaches anything downstream.
fn build_matcher(pattern: &str) -> Result<RegexMatcher, String> {
    RegexMatcherBuilder::new()
        .crlf(true)
        .multi_line(true)
        .line_terminator(Some(b'\n'))
        .case_smart(true)
        .build(pattern)
        .map_err(|error| error.to_string())
}

/// Build a searcher with netgrep's fixed reading semantics: search every byte
/// as text, and count lines only when the caller needs them.
///
/// Shared by both entry points rather than spelled out in each. They must agree
/// on binary detection in particular, because it decides whether a block is
/// abandoned — a divergence there would make `search_bytes` and `search_block`
/// disagree about whether the same bytes matched at all, not merely about what
/// comes back alongside the answer. `BinaryDetection::none()` is therefore fixed
/// here for all callers and is not a parameter.
///
/// `line_numbers` is a parameter because it is the one setting that changes
/// cost without changing answers: counting terminators is work the membership
/// path has no use for, and `search_bytes` exists to allocate nothing.
fn build_searcher(line_numbers: bool) -> Searcher {
    SearcherBuilder::new()
        .binary_detection(BinaryDetection::none())
        .line_number(line_numbers)
        .build()
}

/// Run a compiled matcher over one chunk of bytes.
fn search_with(matcher: &RegexMatcher, chunk: &[u8]) -> bool {
    let mut searcher = build_searcher(false);

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

/// Decode one matched line and locate the pattern's matches within it.
///
/// Three lossy steps turn the raw bytes into the string that crosses the
/// boundary, in an order that matters:
///
/// 1. **Strip the terminator.** `SinkMatch::bytes()` includes the trailing
///    `\n`, and a `\r` before it on Windows-authored input. Both are line
///    *structure* rather than content, and rendering either verbatim in a UI is
///    a defect the caller cannot fix without knowing this.
/// 2. **Truncate**, so the cap applies to visible content rather than to
///    content-plus-terminator, and so one minified bundle cannot copy megabytes
///    per file into JavaScript.
/// 3. **Decode**, last, so the lossy pass runs over at most `max_line_bytes`.
///
/// `find_iter` runs over the FULL stripped line, not the truncated slice:
/// truncating first would let `$` match at the cut, reporting a match the real
/// line does not contain. Ranges starting at or past the cut are then dropped
/// and one straddling it is clamped — the string cannot show what it does not
/// hold. `start == 0 && cap == 0` is kept deliberately, so the empty match on
/// an empty line still has a range, which is the one case a caller cannot
/// re-derive.
///
/// One decoder, not one per caller. Nothing but the block path calls it today,
/// but every rule above was paid for once, and a second decoder that got the
/// order, the drop or the clamp wrong would be wrong only for lines longer than
/// the cap or shorter than one character — the two cases nobody looks at.
fn decode_line_with_ranges(
    matcher: &RegexMatcher,
    line: &[u8],
    max_line_bytes: usize,
) -> (String, Vec<u32>) {
    let content = strip_terminator(line);
    let cap = floor_char_boundary(content, max_line_bytes);

    let mut byte_offsets: Vec<usize> = Vec::new();
    let _ = matcher.find_iter(content, |m| {
        byte_offsets.push(m.start());
        byte_offsets.push(m.end());
        true
    });

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
}

/// One matching line, as the block API reports it.
pub struct BlockHit {
    /// 1-based, **relative to the block searched**, not to the file. The
    /// running file-absolute base is the streaming loop's job.
    pub line_number: u32,
    /// Terminator stripped, truncated to `max_line_bytes`, lossily decoded.
    pub line: String,
    /// Flat `[start, end, …]` pairs, UTF-16 code units into `line`.
    pub ranges: Vec<u32>,
}

/// What one block produced.
pub struct BlockOutcome {
    /// How many lines the block contained, matching or not. The streaming loop
    /// advances its running line base by this, so it must count the final line
    /// of a terminator-less block.
    pub lines_in_block: u32,
    pub hits: Vec<BlockHit>,
}

/// A `Sink` that keeps every matching line.
///
/// `Ok(true)` rather than `MemSink`'s `Ok(false)`: membership is answered by the
/// first hit, but a block has to report all of them. The bytes are copied
/// because `SinkMatch` does not outlive the callback, and copied undecoded so
/// the expensive half happens once, after the search.
struct BlockSink {
    hits: Vec<(u32, Vec<u8>)>,
}

impl Sink for BlockSink {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &Searcher,
        mat: &SinkMatch<'_>,
    ) -> Result<bool, std::io::Error> {
        // `line_number` is `Some` because the searcher is built with
        // `line_number(true)`; 0 is unreachable and would be a wrong answer
        // rather than a crash, so it is not worth an unwrap that could trap
        // the WASM instance.
        self.hits
            .push((mat.line_number().unwrap_or(0) as u32, mat.bytes().to_vec()));

        Ok(true)
    }
}

/// Count the lines in a block.
///
/// Terminators, plus one for a final line that has none — the last block of a
/// file not ending in a newline. Getting this wrong drifts the streaming loop's
/// running base for every line after it.
fn count_lines(chunk: &[u8]) -> u32 {
    if chunk.is_empty() {
        return 0;
    }

    let terminators = bytecount_newlines(chunk);

    if chunk.last() == Some(&b'\n') {
        terminators
    } else {
        terminators + 1
    }
}

/// Terminators in a block. Split out so `count_lines` reads as its own rule.
fn bytecount_newlines(chunk: &[u8]) -> u32 {
    chunk.iter().filter(|&&byte| byte == b'\n').count() as u32
}

fn search_block_with(
    matcher: &RegexMatcher,
    chunk: &[u8],
    max_line_bytes: usize,
) -> BlockOutcome {
    let mut searcher = build_searcher(true);
    let mut sink = BlockSink { hits: Vec::new() };

    let _ = searcher.search_slice(matcher, chunk, &mut sink);

    let hits = sink
        .hits
        .into_iter()
        .map(|(line_number, bytes)| {
            let (line, ranges) = decode_line_with_ranges(matcher, &bytes, max_line_bytes);

            BlockHit { line_number, line, ranges }
        })
        .collect();

    BlockOutcome { lines_in_block: count_lines(chunk), hits }
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

/// Drop one trailing `\n`, and a `\r` immediately before it.
///
/// Only as a pair: a lone `\r` in the middle of a line under netgrep's
/// `\n`-terminator semantics is ordinary content, and a file using bare CR line
/// endings is one line as far as the line SPLITTER is concerned — it still
/// only ever breaks on `\n`. `^`/`$` disagree since `crlf(true)`: they treat a
/// bare `\r` as a line boundary too, so the anchors and the returned line can
/// now describe different boundaries for the same bytes. Published as
/// `bare-cr-anchors` in `docs/guide/caveats.data.json`.
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
