//! Rust-level tests for the search engine.
//!
//! These run NATIVELY, under a plain `cargo test` — no browser, no WebDriver.
//!
//! They used to be `wasm-bindgen-test`s with `run_in_browser`, driven by
//! `wasm-pack test --chrome --headless`. That harness downloaded the newest
//! ChromeDriver on every run, which could not drive an older locally installed
//! Chrome, and it overrode `CHROMEDRIVER`, so the mismatch was not fixable by
//! hand. It cost every contributor a broken command to guard two assertions
//! about pure byte-in/bool-out logic that has nothing browser-specific in it.
//!
//! The browser is still covered, and covered better: the TypeScript
//! integration suite drives this same compiled engine through the real
//! streaming loop in a real headless Chromium. See decision 0013.

#[cfg(test)]
mod search {
    const POEM: &str = "One Wiseman came to Jhaampe-town. \
                        He set aside both Queen and Crown \
                        Did his task and fell asleep \
                        Gave his bones to the stones to keep.";

    #[test]
    fn test_search_bytes() {
        let result = search::search_bytes(POEM.as_bytes(), "set aside");

        assert!(result);
    }

    #[test]
    fn test_search_bytes_smart_case() {
        let result = search::search_bytes(POEM.as_bytes(), "both queen and crown");

        assert!(result);
    }
}
