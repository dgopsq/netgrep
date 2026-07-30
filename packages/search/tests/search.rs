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

/// Assert-friendly wrapper: bytes in, bool out, exactly as the module comment
/// above describes.
///
/// The engine itself returns `Result<bool, String>` — an invalid pattern is a
/// domain error, not a panic. Tests that are *about* a valid pattern say so by
/// using this and letting a compile failure surface as a test failure; the two
/// in `documented_defects` that are about the error itself call
/// `try_search_bytes` directly.
///
/// These call `try_search_bytes` rather than the `#[wasm_bindgen]` export
/// `search_bytes`, because the latter's error type cannot be constructed on a
/// native target. See the comment on `try_search_bytes` in `lib.rs`.
#[cfg(test)]
fn matches(haystack: &[u8], pattern: &str) -> bool {
    // Leading `::` because the test module below is also called `search`.
    ::search::try_search_bytes(haystack, pattern).expect("the pattern should compile")
}

#[cfg(test)]
mod search {
    use super::matches;
    use ::search::try_search_bytes;

    const POEM: &str = "One Wiseman came to Jhaampe-town.\n\
                        He set aside both Queen and Crown\n\
                        Did his task and fell asleep\n\
                        Gave his bones to the stones to keep.\n";

    // ---------------------------------------------------------------
    // Matching basics
    // ---------------------------------------------------------------

    #[test]
    fn test_search_bytes() {
        assert!(matches(POEM.as_bytes(), "set aside"));
    }

    #[test]
    fn test_absent_pattern_does_not_match() {
        assert!(!matches(POEM.as_bytes(), "dragon"));
    }

    #[test]
    fn test_empty_haystack_never_matches() {
        assert!(!matches(b"", "anything"));

        // Not even the empty pattern, which matches every line of anything
        // else: there are no lines here to match.
        assert!(!matches(b"", ""));
    }

    #[test]
    fn test_empty_pattern_matches_any_content() {
        // Worth pinning because it is the shape of a search box on its first
        // keystroke, and "matches everything" is a defensible answer only as
        // long as it is the deliberate one.
        assert!(matches(b"anything at all", ""));
    }

    #[test]
    fn test_pattern_longer_than_the_haystack() {
        assert!(!matches(b"ab", "abcdef"));
    }

    #[test]
    fn test_matches_on_the_final_line_without_a_trailing_newline() {
        // A chunk boundary lands mid-file far more often than on a line
        // terminator, so the last line handed to the engine usually has none.
        assert!(matches(b"first\nneedle", "needle"));
    }

    #[test]
    fn test_matches_within_a_very_long_line() {
        // No line-length or heap limit is configured on the searcher, so a
        // minified file arriving as one enormous line still searches.
        let mut haystack = vec![b'x'; 200_000];
        haystack.extend_from_slice(b"needle");

        assert!(matches(&haystack, "needle"));
    }

    // ---------------------------------------------------------------
    // Smart case
    // ---------------------------------------------------------------

    #[test]
    fn test_search_bytes_smart_case() {
        assert!(matches(POEM.as_bytes(), "both queen and crown"));
    }

    #[test]
    fn test_smart_case_an_uppercased_pattern_is_case_sensitive() {
        // The other half of `case_smart(true)`: a capital anywhere in the
        // pattern is read as intent, and the search stops being lenient.
        assert!(!matches(b"one wiseman came", "Wiseman"));
        assert!(matches(b"One Wiseman came", "Wiseman"));
    }

    #[test]
    fn test_an_explicit_case_insensitive_flag_still_wins() {
        assert!(matches(b"ONE WISEMAN", "(?i)Wiseman"));
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
        assert!(matches(POEM.as_bytes(), "Queen (and|or) Crown"));
        assert!(matches(POEM.as_bytes(), r"Jhaampe-\w+"));
        assert!(matches(b"order 1138 shipped", r"\d{4}"));
    }

    #[test]
    fn test_word_boundaries() {
        assert!(matches(b"a needle b", r"\bneedle\b"));
        assert!(!matches(b"needlepoint", r"\bneedle\b"));
    }

    #[test]
    fn test_repetition_and_anchoring_together() {
        assert!(matches(b"aaaa\nbbbb\n", "^a{4}$"));
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
        assert!(matches(b"Needle x\nother\n", "^Needle"));
        assert!(matches(b"other\nNeedle x\n", "^Needle"));
        assert!(matches(b"a\nb\nNeedle x\n", "^Needle"));
        assert!(!matches(b"x Needle\n", "^Needle"));
    }

    #[test]
    fn test_dollar_anchors_to_the_end_of_any_line() {
        assert!(matches(b"other\nxx Needle\n", "Needle$"));
        assert!(!matches(b"Needle xx\n", "Needle$"));
    }

    #[test]
    fn test_a_match_cannot_span_a_line_terminator() {
        // `.` excludes the line terminator, and no multiline mode is enabled,
        // so a pattern can never straddle two lines. This is the engine-level
        // half of why netgrep answers "does this pattern occur on some line".
        //
        // ⚠️ LOAD-BEARING FOR packages/netgrep/src/lib/splitAtLastLine.ts,
        // which carries the incomplete trailing LINE between `fetch` chunks
        // because a line is the largest unit a match can occupy.
        //
        // If this goes red, BACKLOG 3a is back and no JavaScript test will
        // notice. Relaxing an assertion here means growing that tail to cover
        // whatever now matches across lines, not accepting the new behaviour.
        assert!(!matches(b"alpha\nbeta", "alpha.beta"));
        assert!(!matches(b"alpha\nbeta", "(?s)alpha.beta"));

        // The escape hatches, all closed: grep-regex strips the terminator from
        // character classes rather than trusting the pattern to avoid it.
        assert!(!matches(b"alpha\nbeta", "alpha[^x]beta"));
        assert!(!matches(b"alpha\nbeta", r"alpha\sbeta"));
        assert!(!matches(b"alpha\nbeta", r"alpha[\s\S]beta"));
        assert!(!matches(b"alpha\nbeta", r"alpha\W beta"));

        // And a literal terminator is REJECTED, not quietly ignored, so a
        // cross-line match cannot even be asked for.
        for pattern in [r"alpha\nbeta", "alpha\nbeta", r"alpha\x0abeta"] {
            assert!(
                try_search_bytes(b"alpha\nbeta", pattern).is_err(),
                "{pattern:?} should be rejected, not merely unmatched"
            );
        }
    }

    // ---------------------------------------------------------------
    // Encoding
    // ---------------------------------------------------------------

    #[test]
    fn test_matches_non_ascii_text() {
        assert!(matches("un café noir".as_bytes(), "café"));
        assert!(matches("naïve".as_bytes(), r"na\w+ve"));
    }

    #[test]
    fn test_smart_case_applies_to_non_ascii_text() {
        assert!(matches("un CAFÉ noir".as_bytes(), "café"));
        assert!(!matches("un café noir".as_bytes(), "CAFÉ"));
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

        assert!(matches(&utf16, "needle"));

        // Without the BOM there is nothing to sniff, and the same text reads
        // as NUL-separated bytes.
        assert!(!matches(&utf16[2..], "needle"));
    }

    #[test]
    fn test_a_utf8_bom_does_not_hide_the_first_line() {
        assert!(matches(&[0xef, 0xbb, 0xbf, b'n', b'e', b'e', b'd'], "need"));
    }

    // ---------------------------------------------------------------
    // Compiled-matcher reuse
    //
    // The engine keeps the last compiled pattern and reuses it, because
    // netgrep calls it once per chunk with the same pattern every time. That
    // cache is the only piece of state in `lib.rs`, and its failure mode is
    // the worst one this library has: answering with the previous pattern's
    // matcher is a wrong boolean, silently, rather than a crash.
    // ---------------------------------------------------------------

    #[test]
    fn test_a_changed_pattern_is_not_answered_by_the_previous_matcher() {
        assert!(matches(b"alpha only", "alpha"));
        assert!(!matches(b"alpha only", "beta"));
        assert!(matches(b"alpha only", "alpha"));
    }

    #[test]
    fn test_two_patterns_differing_only_in_case_are_not_confused() {
        // Sharper than the test above: smart case is decided when the pattern
        // is COMPILED, so these two need genuinely different matchers even
        // though they are the same length and differ by one bit.
        assert!(matches(b"one wiseman", "wiseman"));
        assert!(!matches(b"one wiseman", "Wiseman"));
        assert!(matches(b"one wiseman", "wiseman"));
    }

    #[test]
    fn test_a_failed_compile_does_not_wedge_the_next_pattern() {
        // A search box produces invalid patterns constantly on the way to a
        // valid one. The failure is cached — otherwise it would be recompiled
        // once per chunk per url — so what matters is that the cache is
        // replaced, not consulted, when the pattern changes.
        let first = try_search_bytes(b"anything", "(").expect_err("`(` is not valid regex");
        let second = try_search_bytes(b"anything", "(").expect_err("and still is not");

        assert_eq!(first, second);

        assert!(matches(b"anything", "any"));
    }

    #[test]
    fn test_a_stray_invalid_byte_does_not_hide_the_line() {
        // A single 0xff is not a BOM and is not a NUL, so it neither
        // transcodes nor quits — the rest of the line still matches. Pinned
        // because the two behaviours that DO blank a line (BOM sniffing above,
        // binary detection below) make it reasonable to assume this one does
        // too.
        assert!(matches(&[0xff, b' ', b'x', b'y'], "xy"));
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
///
/// And the published demo warns its visitors about these, so a fix is not
/// finished until it stops: drop the caveat from the `CAVEATS` array in
/// `packages/example/src/components/limitations.tsx` in the same PR. Nothing
/// checks that — a green `cargo test` is not evidence the site is honest.
/// See AGENTS.md §2.3.
#[cfg(test)]
mod documented_defects {
    use super::matches;
    use ::search::try_search_bytes;

    #[test]
    fn backlog_3c_fixed_an_invalid_pattern_is_an_error() {
        // This assertion used to sit here as `#[should_panic]`, pinning a real
        // bug: `.build(pattern).unwrap()` trapped the WASM instance —
        // surfacing in the browser as `RuntimeError: unreachable` — for input
        // that arrives routinely from a user's search box.
        //
        // `search_bytes` now returns a `Result`, so per the block comment above
        // the assertion is inverted in the same PR that changed it. It asserts
        // the message too: a bare `is_err()` would also pass if the pattern had
        // failed to compile for some entirely different reason.
        let error = try_search_bytes(b"anything", "(").expect_err("`(` is not valid regex");

        assert!(
            error.contains("unclosed group"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn backlog_3c_fixed_a_pattern_containing_a_newline_is_an_error() {
        // The same defect by a different route, and a likelier one: the pattern
        // is valid regex, but `line_terminator(Some(b'\n'))` forbids a literal
        // newline in it. Pasting two lines into a search box is enough.
        //
        // The `#[should_panic]` this replaces matched `NotAllowed`, the Debug
        // name of the error variant. What a caller now receives is the Display
        // form, which is a sentence.
        let error = try_search_bytes(b"alpha\nbeta", "alpha\nbeta")
            .expect_err("a literal newline is rejected by the line terminator");

        assert!(
            error.contains(r#"the literal "\n" is not allowed"#),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn backlog_3f_one_nul_byte_discards_the_whole_chunk() {
        // `BinaryDetection::quit(b'\x00')` does not stop AT the NUL; it
        // abandons everything it was given. The match is dropped even when it
        // precedes the NUL, and even when it is on an earlier line.
        assert!(matches(b"needle here", "needle"));

        assert!(!matches(b"needle here\x00tail", "needle"));
        assert!(!matches(b"needle here\n\x00tail", "needle"));
        assert!(!matches(b"\x00needle here", "needle"));
    }

    #[test]
    fn backlog_17_dollar_does_not_match_before_a_carriage_return() {
        // On CRLF input the line terminator is `\n`, so `\r` is the last
        // character of the line and `$` sits behind it. A `$`-anchored pattern
        // therefore misses silently on any Windows-authored file, while the
        // same pattern unanchored matches fine.
        assert!(matches(b"needle\r\nnext\r\n", "needle"));
        assert!(!matches(b"needle\r\nnext\r\n", "needle$"));

        // `^` is unaffected — the CR is at the other end of the line.
        assert!(matches(b"a\r\nneedle\r\n", "^needle"));

        // And the LF-only case, to show the anchor itself works.
        assert!(matches(b"needle\nnext\n", "needle$"));
    }
}
