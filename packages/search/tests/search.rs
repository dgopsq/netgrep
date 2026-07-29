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
//!
//! WHAT BELONGS HERE, AND WHAT DOES NOT
//! ------------------------------------
//! `search_bytes` is bytes in, bool out. Everything that depends only on those
//! bytes — regex syntax, smart case, line semantics, encoding, binary
//! detection — is cheapest to pin here: no browser to boot, and a failure
//! names the engine rather than the streaming loop wrapped around it.
//!
//! Anything involving `fetch`, chunking, caching or the WASM boundary belongs
//! in `Netgrep.integration.spec.ts` instead. The two suites overlap on purpose
//! at exactly one point — smart case — because that is the behaviour most
//! likely to change silently under a dependency bump, and knowing *which*
//! layer moved is worth one duplicated assertion.

#[cfg(test)]
mod search {
    use search::search_bytes;

    const POEM: &str = "One Wiseman came to Jhaampe-town.\n\
                        He set aside both Queen and Crown\n\
                        Did his task and fell asleep\n\
                        Gave his bones to the stones to keep.\n";

    // ---------------------------------------------------------------
    // Matching basics
    // ---------------------------------------------------------------

    #[test]
    fn test_search_bytes() {
        assert!(search_bytes(POEM.as_bytes(), "set aside"));
    }

    #[test]
    fn test_absent_pattern_does_not_match() {
        assert!(!search_bytes(POEM.as_bytes(), "dragon"));
    }

    #[test]
    fn test_empty_haystack_never_matches() {
        assert!(!search_bytes(b"", "anything"));

        // Not even the empty pattern, which matches every line of anything
        // else: there are no lines here to match.
        assert!(!search_bytes(b"", ""));
    }

    #[test]
    fn test_empty_pattern_matches_any_content() {
        // Worth pinning because it is the shape of a search box on its first
        // keystroke, and "matches everything" is a defensible answer only as
        // long as it is the deliberate one.
        assert!(search_bytes(b"anything at all", ""));
    }

    #[test]
    fn test_pattern_longer_than_the_haystack() {
        assert!(!search_bytes(b"ab", "abcdef"));
    }

    #[test]
    fn test_matches_on_the_final_line_without_a_trailing_newline() {
        // A chunk boundary lands mid-file far more often than on a line
        // terminator, so the last line handed to the engine usually has none.
        assert!(search_bytes(b"first\nneedle", "needle"));
    }

    #[test]
    fn test_matches_within_a_very_long_line() {
        // No line-length or heap limit is configured on the searcher, so a
        // minified file arriving as one enormous line still searches.
        let mut haystack = vec![b'x'; 200_000];
        haystack.extend_from_slice(b"needle");

        assert!(search_bytes(&haystack, "needle"));
    }

    // ---------------------------------------------------------------
    // Smart case
    // ---------------------------------------------------------------

    #[test]
    fn test_search_bytes_smart_case() {
        assert!(search_bytes(POEM.as_bytes(), "both queen and crown"));
    }

    #[test]
    fn test_smart_case_an_uppercased_pattern_is_case_sensitive() {
        // The other half of `case_smart(true)`: a capital anywhere in the
        // pattern is read as intent, and the search stops being lenient.
        assert!(!search_bytes(b"one wiseman came", "Wiseman"));
        assert!(search_bytes(b"One Wiseman came", "Wiseman"));
    }

    #[test]
    fn test_an_explicit_case_insensitive_flag_still_wins() {
        assert!(search_bytes(b"ONE WISEMAN", "(?i)Wiseman"));
    }

    // ---------------------------------------------------------------
    // Regex features
    //
    // The public API takes "anything ripgrep can understand", so these pin
    // that the pattern really does reach a regex engine rather than a
    // substring search.
    // ---------------------------------------------------------------

    #[test]
    fn test_alternation_and_character_classes() {
        assert!(search_bytes(POEM.as_bytes(), "Queen (and|or) Crown"));
        assert!(search_bytes(POEM.as_bytes(), r"Jhaampe-\w+"));
        assert!(search_bytes(b"order 1138 shipped", r"\d{4}"));
    }

    #[test]
    fn test_word_boundaries() {
        assert!(search_bytes(b"a needle b", r"\bneedle\b"));
        assert!(!search_bytes(b"needlepoint", r"\bneedle\b"));
    }

    #[test]
    fn test_repetition_and_anchoring_together() {
        assert!(search_bytes(b"aaaa\nbbbb\n", "^a{4}$"));
    }

    // ---------------------------------------------------------------
    // Line semantics
    //
    // The searcher is given `line_terminator(Some(b'\n'))`, which makes `^`,
    // `$` and `.` line-scoped rather than chunk-scoped. `^` used to anchor to
    // the chunk instead whenever smart case left the pattern case-sensitive —
    // see BACKLOG 3e, fixed upstream — so this is guarded from both sides.
    // ---------------------------------------------------------------

    #[test]
    fn test_caret_anchors_to_any_line_not_just_the_first() {
        assert!(search_bytes(b"Needle x\nother\n", "^Needle"));
        assert!(search_bytes(b"other\nNeedle x\n", "^Needle"));
        assert!(search_bytes(b"a\nb\nNeedle x\n", "^Needle"));
        assert!(!search_bytes(b"x Needle\n", "^Needle"));
    }

    #[test]
    fn test_dollar_anchors_to_the_end_of_any_line() {
        assert!(search_bytes(b"other\nxx Needle\n", "Needle$"));
        assert!(!search_bytes(b"Needle xx\n", "Needle$"));
    }

    #[test]
    fn test_a_match_cannot_span_a_line_terminator() {
        // `.` excludes the line terminator, and no multiline mode is enabled,
        // so a pattern can never straddle two lines. This is the engine-level
        // half of why netgrep answers "does this pattern occur on some line".
        assert!(!search_bytes(b"alpha\nbeta", "alpha.beta"));
        assert!(!search_bytes(b"alpha\nbeta", "(?s)alpha.beta"));
    }

    // ---------------------------------------------------------------
    // Encoding
    // ---------------------------------------------------------------

    #[test]
    fn test_matches_non_ascii_text() {
        assert!(search_bytes("un café noir".as_bytes(), "café"));
        assert!(search_bytes("naïve".as_bytes(), r"na\w+ve"));
    }

    #[test]
    fn test_smart_case_applies_to_non_ascii_text() {
        assert!(search_bytes("un CAFÉ noir".as_bytes(), "café"));
        assert!(!search_bytes("un café noir".as_bytes(), "CAFÉ"));
    }

    #[test]
    fn test_a_utf16_bom_is_honoured_and_the_text_transcoded() {
        // `grep-searcher` sniffs a BOM and transcodes before matching, so a
        // UTF-16 file is searched with a plain UTF-8 pattern. Surprising
        // enough — and free enough — to be worth pinning.
        //
        // Note this only holds for bytes that CARRY the BOM. netgrep hands the
        // engine one `fetch` chunk at a time, so in a real UTF-16 download only
        // the first chunk is transcoded; see the note on BACKLOG 3a in
        // `Netgrep.integration.spec.ts`.
        let mut utf16 = vec![0xff, 0xfe];
        for unit in "needle here".encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }

        assert!(search_bytes(&utf16, "needle"));

        // Without the BOM there is nothing to sniff, and the same text reads
        // as NUL-separated bytes.
        assert!(!search_bytes(&utf16[2..], "needle"));
    }

    #[test]
    fn test_a_utf8_bom_does_not_hide_the_first_line() {
        assert!(search_bytes(&[0xef, 0xbb, 0xbf, b'n', b'e', b'e', b'd'], "need"));
    }

    #[test]
    fn test_a_stray_invalid_byte_does_not_hide_the_line() {
        // A single 0xff is not a BOM and is not a NUL, so it neither
        // transcodes nor quits — the rest of the line still matches. Pinned
        // because the two behaviours that DO blank a line (BOM sniffing above,
        // binary detection below) make it reasonable to assume this one does
        // too.
        assert!(search_bytes(&[0xff, b' ', b'x', b'y'], "xy"));
    }
}

/// ---------------------------------------------------------------------
/// DOCUMENTED DEFECTS — these assertions pin behaviour that is WRONG.
/// ---------------------------------------------------------------------
///
/// Read this before changing anything below. It is the `search` crate's half
/// of the block at the bottom of `Netgrep.integration.spec.ts`; the rules are
/// the same, and `AGENTS.md` §2.1 and
/// `docs/decisions/0011-tests-that-assert-known-bugs.md` state them.
///
/// In short: these assert what netgrep does today, not what it should do. They
/// exist to catch *unintended* change during a dependency bump — an assertion
/// describing the correct-but-unimplemented behaviour would fail today and
/// tell us nothing. **When one is genuinely fixed, invert it in the same PR.**
///
/// They sit here as well as in the integration suite because these particular
/// defects live in `lib.rs`, and a failure at this level says so without a
/// browser, a stream or a cache in the way.
///
/// Tracked in `docs/BACKLOG.md`.
#[cfg(test)]
mod documented_defects {
    use search::search_bytes;

    #[test]
    #[should_panic(expected = "unclosed group")]
    fn backlog_3c_an_invalid_pattern_panics() {
        // `.build(pattern).unwrap()`. Patterns come straight from a user's
        // search box, so a stray `(` traps the WASM instance — surfacing in
        // the browser as `RuntimeError: unreachable` — instead of a catchable
        // domain error.
        search_bytes(b"anything", "(");
    }

    #[test]
    #[should_panic(expected = "NotAllowed")]
    fn backlog_3c_a_pattern_containing_a_newline_panics() {
        // The same defect by a different route, and a likelier one: the
        // pattern is valid regex, but `line_terminator(Some(b'\n'))` forbids a
        // literal newline in it. Pasting two lines into a search box is enough.
        search_bytes(b"alpha\nbeta", "alpha\nbeta");
    }

    #[test]
    fn backlog_3f_one_nul_byte_discards_the_whole_chunk() {
        // `BinaryDetection::quit(b'\x00')` does not stop AT the NUL; it
        // abandons everything it was given. The match is dropped even when it
        // precedes the NUL, and even when it is on an earlier line.
        assert!(search_bytes(b"needle here", "needle"));

        assert!(!search_bytes(b"needle here\x00tail", "needle"));
        assert!(!search_bytes(b"needle here\n\x00tail", "needle"));
        assert!(!search_bytes(b"\x00needle here", "needle"));
    }

    #[test]
    fn backlog_17_dollar_does_not_match_before_a_carriage_return() {
        // On CRLF input the line terminator is `\n`, so `\r` is the last
        // character of the line and `$` sits behind it. A `$`-anchored pattern
        // therefore misses silently on any Windows-authored file, while the
        // same pattern unanchored matches fine.
        assert!(search_bytes(b"needle\r\nnext\r\n", "needle"));
        assert!(!search_bytes(b"needle\r\nnext\r\n", "needle$"));

        // `^` is unaffected — the CR is at the other end of the line.
        assert!(search_bytes(b"a\r\nneedle\r\n", "^needle"));

        // And the LF-only case, to show the anchor itself works.
        assert!(search_bytes(b"needle\nnext\n", "needle$"));
    }
}
