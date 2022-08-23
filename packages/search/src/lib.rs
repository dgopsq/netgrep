use grep::printer::StandardBuilder;
use grep::regex::RegexMatcher;
use grep::searcher::{BinaryDetection, SearcherBuilder};
use wasm_bindgen::prelude::*;

// Use `wee_alloc` as the global allocator.
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
pub fn search_bytes(chunk: &[u8], pattern: &str) -> JsValue {
    let matcher = RegexMatcher::new_line_matcher(pattern).unwrap();

    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(false)
        .build();

    let mut printer = StandardBuilder::new()
        .only_matching(true)
        .build_no_color(Vec::new());

    let _ = searcher.search_slice(&matcher, chunk, printer.sink(&matcher));

    let result = printer.has_written();

    JsValue::from_bool(result)
}
