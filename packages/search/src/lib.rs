use grep::regex::RegexMatcher;
use grep::searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use wasm_bindgen::prelude::*;

/// Use `wee_alloc` as the global allocator.
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

/// Search a bytes array for the given pattern. This function
/// uses `ripgrep` under the hood.
#[wasm_bindgen]
pub fn search_bytes(chunk: &[u8], pattern: &str) -> bool {
    let matcher = RegexMatcher::new_line_matcher(pattern).unwrap();

    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(false)
        .build();

    let mut sink = MemSink { match_count: 0 };

    let _ = searcher.search_slice(&matcher, chunk, &mut sink);

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
