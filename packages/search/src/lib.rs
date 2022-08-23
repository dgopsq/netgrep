use grep::regex::RegexMatcher;
use grep::searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use js_sys::Array;
use wasm_bindgen::prelude::*;

/// Use `wee_alloc` as the global allocator.
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

/// Search a bytes array for the given pattern. This function
/// uses `ripgrep` under the hood.
#[wasm_bindgen]
pub fn search_bytes(chunk: &[u8], pattern: &str) -> SearchResult {
    let matcher = RegexMatcher::new_line_matcher(pattern).unwrap();

    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(false)
        .build();

    let mut sink = MemSink {
        matches_count: 0,
        lines: Vec::new(),
    };

    let _ = searcher.search_slice(&matcher, chunk, &mut sink);

    serialize_memsink(sink)
}

/// An in-memory `Sink` implementation in order
/// to store the matches in a structured way instead
/// of just writing on a stdout.
pub struct MemSink {
    matches_count: u64,
    lines: Vec<String>,
}

impl Sink for MemSink {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &Searcher,
        mat: &SinkMatch<'_>,
    ) -> Result<bool, std::io::Error> {
        self.matches_count += 1;

        let match_str = std::str::from_utf8(mat.bytes()).unwrap_or("UNKNOWN");

        self.lines.push(match_str.to_string());

        Ok(true)
    }
}

/// The struct describing a search result which
/// can be passed to JavaScript.
#[wasm_bindgen]
pub struct SearchResult {
    pub count: u16,

    #[wasm_bindgen(getter_with_clone)]
    pub lines: Array,
}

/// Transform a `MemSink` into a `SearchResult` in
/// order to pass a result to JavaScript.
fn serialize_memsink(mem_sink: MemSink) -> SearchResult {
    SearchResult {
        // This is a possibly unsafe casting from a bigger
        // to a smaller type to have a better type definition.
        count: mem_sink.matches_count.try_into().unwrap_or(0),

        // This could be a bottleneck since
        // it needs to re-compute the whole array
        // of results - O(N).
        lines: Array::from_iter(mem_sink.lines.into_iter().map(JsValue::from)),
    }
}
