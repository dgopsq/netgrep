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
//! `search_bytes` is bytes in, bool out; `search_bytes_line` is bytes in, the
//! first matching line out. Everything that depends only on those bytes — regex
//! syntax, smart case, line semantics, encoding, binary detection, and what a
//! returned line contains — is cheapest to pin here: no browser to boot, and a
//! failure names the engine rather than the streaming loop wrapped around it.
//!
//! Anything involving `fetch`, chunking, aborting or the WASM boundary belongs
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

/// Ranges variant of `matches_line`: bytes in, `(line, flat utf16 ranges)` out.
#[cfg(test)]
fn line_ranges(haystack: &[u8], pattern: &str, cap: usize) -> Option<(String, Vec<u32>)> {
    ::search::try_search_bytes_line_ranges(haystack, pattern, cap)
        .expect("the pattern should compile")
}

/// Assert-friendly wrapper around the line-returning entry point.
///
/// `None` is "no match"; `Some` carries the line. The same note as `matches`
/// applies about calling `try_search_bytes_line` rather than the
/// `#[wasm_bindgen]` export.
#[cfg(test)]
fn first_line(haystack: &[u8], pattern: &str, max_line_bytes: usize) -> Option<String> {
    ::search::try_search_bytes_line(haystack, pattern, max_line_bytes)
        .expect("the pattern should compile")
}

/// The matching line, rather than the boolean — BACKLOG 19.
///
/// Everything here is about what `search_bytes_line` returns *given* a match;
/// whether something matches at all is `mod search` above, and is deliberately
/// not re-asserted. All three entry points share one compiled matcher and one
/// searcher configuration, so matching semantics cannot diverge between them —
/// `test_the_three_entry_points_share_one_matcher` is the assertion that keeps
/// that true.
#[cfg(test)]
mod matching_line {
    use super::{first_line, line_ranges, matches};
    use ::search::try_search_bytes_line;

    /// Comfortably above every line used here, so a test only exercises the cap
    /// when it says so.
    const NO_CAP: usize = 4096;

    const POEM: &str = "One Wiseman came to Jhaampe-town.\n\
                        He set aside both Queen and Crown\n\
                        Did his task and fell asleep\n\
                        Gave his bones to the stones to keep.\n";

    // ---------------------------------------------------------------
    // What comes back
    // ---------------------------------------------------------------

    #[test]
    fn test_returns_the_whole_line_not_the_match() {
        // The point of the feature: a boolean says "yes", this says what was
        // read. The pattern is three characters and the answer is a sentence.
        assert_eq!(
            first_line(POEM.as_bytes(), "aside", NO_CAP).as_deref(),
            Some("He set aside both Queen and Crown")
        );
    }

    #[test]
    fn test_no_match_is_none() {
        assert_eq!(first_line(POEM.as_bytes(), "dragon", NO_CAP), None);
    }

    #[test]
    fn test_returns_the_first_matching_line_not_the_last() {
        // `LineSink::matched` stops at the first hit. Keep searching and this
        // would hold the LAST matching line — the one place that short-circuit
        // is observable rather than merely faster.
        let haystack = b"needle one\nneedle two\nneedle three\n";

        assert_eq!(
            first_line(haystack, "needle", NO_CAP).as_deref(),
            Some("needle one")
        );
    }

    // ---------------------------------------------------------------
    // Line terminators
    // ---------------------------------------------------------------

    #[test]
    fn test_the_trailing_newline_is_stripped() {
        assert_eq!(
            first_line(b"alpha\nbeta\n", "alpha", NO_CAP).as_deref(),
            Some("alpha")
        );
    }

    #[test]
    fn test_a_carriage_return_before_the_newline_is_stripped_too() {
        // On CRLF input the `\r` is the last byte of the line under netgrep's
        // `\n`-terminator semantics, so without this it would render as a
        // control character in whatever the caller displays. Note BACKLOG 17
        // is untouched by this: `$` still cannot match here, because the
        // stripping happens after matching, not before.
        assert_eq!(
            first_line(b"alpha\r\nbeta\r\n", "alpha", NO_CAP).as_deref(),
            Some("alpha")
        );
    }

    #[test]
    fn test_a_lone_carriage_return_is_content() {
        // Not a terminator here, so not structure: only the `\r\n` PAIR is
        // dropped. A file with bare CR endings is one line to this engine, and
        // pretending otherwise would silently truncate it.
        assert_eq!(
            first_line(b"alpha\rbeta\n", "alpha", NO_CAP).as_deref(),
            Some("alpha\rbeta")
        );
    }

    #[test]
    fn test_an_unterminated_final_line_comes_back_whole() {
        // The common case at a chunk boundary, and at the end of a file with no
        // trailing newline.
        assert_eq!(
            first_line(b"alpha\nbeta", "beta", NO_CAP).as_deref(),
            Some("beta")
        );
    }

    #[test]
    fn test_a_match_on_an_empty_line_is_an_empty_string() {
        // ⚠️ LOAD-BEARING FOR Netgrep.ts, which must test the result against
        // `undefined` rather than for truthiness. An empty string is a MATCH,
        // and it is falsy in JavaScript.
        assert_eq!(
            first_line(b"alpha\n\nbeta\n", "^$", NO_CAP).as_deref(),
            Some("")
        );
    }

    // ---------------------------------------------------------------
    // The cap
    // ---------------------------------------------------------------

    #[test]
    fn test_a_long_line_is_truncated_to_the_cap() {
        let mut haystack = vec![b'x'; 10_000];
        haystack.extend_from_slice(b"needle\n");

        let line = first_line(&haystack, "needle", 64).expect("it matches");

        assert_eq!(line.len(), 64);
        assert!(line.chars().all(|c| c == 'x'));
    }

    #[test]
    fn test_the_cap_applies_to_content_not_to_the_terminator() {
        // Stripping happens before truncation, so a line exactly at the cap
        // survives intact rather than losing its last character to a `\n` that
        // is not part of it.
        assert_eq!(first_line(b"abcde\n", "abc", 5).as_deref(), Some("abcde"));
    }

    #[test]
    fn test_truncation_does_not_split_a_utf8_character() {
        // Five two-byte characters, cut at an odd offset. Splitting the third
        // would produce a replacement character at the end of the line — the
        // most visible possible place for one.
        let line = first_line("ééééé\n".as_bytes(), "é", 5).expect("it matches");

        assert_eq!(line, "éé");
        assert!(!line.contains('\u{FFFD}'));
    }

    #[test]
    fn test_a_cap_of_zero_yields_an_empty_string_not_none() {
        // Degenerate, and unreachable through `Netgrep.ts`, which clamps to at
        // least 1. Pinned so that if it ever IS reached the answer is still
        // "matched", not "did not match".
        assert_eq!(first_line(b"needle\n", "needle", 0).as_deref(), Some(""));
    }

    // ---------------------------------------------------------------
    // Encoding
    // ---------------------------------------------------------------

    #[test]
    fn test_non_ascii_content_survives_intact() {
        assert_eq!(
            first_line("il a bu un café noir\n".as_bytes(), "café", NO_CAP).as_deref(),
            Some("il a bu un café noir")
        );
    }

    #[test]
    fn test_invalid_utf8_decodes_lossily_rather_than_failing() {
        // A latin-1 file, which the engine matches happily because it works on
        // bytes. The line has to become a JavaScript string somehow, and a
        // replacement character is the only answer that still returns the rest
        // of the line. Documented, because it is a class of wrong output the
        // boolean API could not produce.
        let line = first_line(b"caf\xE9 noir\n", "caf", NO_CAP).expect("it matches");

        assert_eq!(line, "caf\u{FFFD} noir");
    }

    // ---------------------------------------------------------------
    // Shared state with `search_bytes`
    // ---------------------------------------------------------------

    #[test]
    fn test_the_three_entry_points_share_one_searcher_configuration() {
        // All three go through `build_searcher`, so binary detection cannot
        // differ between them. That matters more than it looks: a divergence
        // would change `result` — adding `capture: 'line-ranges'` to a working
        // search would change its ANSWER, not just what came back alongside it.
        //
        // Asserted through the observable behaviour rather than the builder,
        // because the builder is not comparable. The input still carries a NUL
        // because that is the setting most able to diverge — it used to abandon
        // the whole block and now searches it as text.
        assert!(matches(b"needle here\x00tail", "needle"));
        assert_eq!(
            first_line(b"needle here\x00tail", "needle", NO_CAP).as_deref(),
            Some("needle here\u{0}tail")
        );
        assert_eq!(
            line_ranges(b"needle here\x00tail", "needle", NO_CAP),
            Some(("needle here\u{0}tail".to_string(), vec![0, 6]))
        );

        // The control, so this is pinning the shared config rather than an
        // input that never matched.
        assert!(matches(b"needle here", "needle"));
        assert_eq!(
            first_line(b"needle here", "needle", NO_CAP).as_deref(),
            Some("needle here")
        );
        assert_eq!(
            line_ranges(b"needle here", "needle", NO_CAP),
            Some(("needle here".to_string(), vec![0, 6]))
        );
    }

    #[test]
    fn test_the_three_entry_points_share_one_matcher() {
        // All three go through `with_matcher`, so a pattern compiled by one is
        // reused by the others. That is the point — but it also means a stale
        // slot would let one entry point answer with another's matcher, which
        // is the same silent-wrong-answer failure `mod search` guards for
        // `search_bytes` alone.
        assert!(matches(b"one wiseman", "wiseman"));
        assert_eq!(
            first_line(b"one wiseman", "wiseman", NO_CAP).as_deref(),
            Some("one wiseman")
        );
        assert_eq!(
            line_ranges(b"one wiseman", "wiseman", NO_CAP),
            Some(("one wiseman".to_string(), vec![4, 11]))
        );

        // Smart case is decided at compile time, so these need different
        // matchers despite differing by one bit.
        assert_eq!(first_line(b"one wiseman", "Wiseman", NO_CAP), None);
        assert_eq!(line_ranges(b"one wiseman", "Wiseman", NO_CAP), None);
        assert!(matches(b"one wiseman", "wiseman"));
    }

    #[test]
    fn test_an_invalid_pattern_is_an_error_here_too() {
        let error =
            try_search_bytes_line(b"anything", "(", NO_CAP).expect_err("`(` is not valid regex");

        assert!(
            error.contains("unclosed group"),
            "unexpected error: {error}"
        );

        // And the memo is replaced rather than consulted afterwards.
        assert_eq!(
            first_line(b"anything", "any", NO_CAP).as_deref(),
            Some("anything")
        );
    }
}

/// Ranges within the matching line.
///
/// `line_ranges` returns the same line as `first_line` plus flat `[start,
/// end, …]` pairs in UTF-16 code units, so a caller can `line.slice(start,
/// end)` in JavaScript without conversion.
#[cfg(test)]
mod line_ranges_tests {
    use super::line_ranges;

    #[test]
    fn test_ranges_for_a_single_match() {
        let (line, ranges) = line_ranges(b"one needle here\n", "needle", 4096).unwrap();
        assert_eq!(line, "one needle here");
        assert_eq!(ranges, vec![4, 10]);
    }

    #[test]
    fn test_no_match_returns_none() {
        assert!(line_ranges(b"nothing here\n", "dragon", 4096).is_none());
    }

    #[test]
    fn test_all_matches_within_the_line_not_just_the_first() {
        let (_, ranges) = line_ranges(b"cat and cat and cat\n", "cat", 4096).unwrap();
        assert_eq!(ranges, vec![0, 3, 8, 11, 16, 19]);
    }

    #[test]
    fn test_ranges_are_for_the_first_matching_line_only() {
        // The second matching line contributes nothing: the search stops at the
        // first, exactly as the boolean and line variants do.
        let (line, ranges) = line_ranges(b"a cat\nanother cat cat\n", "cat", 4096).unwrap();
        assert_eq!(line, "a cat");
        assert_eq!(ranges, vec![2, 5]);
    }

    #[test]
    fn test_offsets_are_utf16_units_not_bytes() {
        // 'é' is 2 bytes in UTF-8 but 1 UTF-16 unit; '𝄞' (U+1D11E) is 4 bytes
        // in UTF-8 and a surrogate PAIR — 2 UTF-16 units. Byte offsets would be
        // 6 and 12; char offsets 2 and 8; only UTF-16 gives 3 and 9.
        let (_, ranges) = line_ranges("é𝄞needle\n".as_bytes(), "needle", 4096).unwrap();
        assert_eq!(ranges, vec![3, 9]);
    }

    #[test]
    fn test_offsets_follow_lossy_decoding() {
        // A truncated 3-byte sequence (0xE0 0xA0 with no valid continuation)
        // decodes to exactly ONE U+FFFD (1 UTF-16 unit), so the match sits at
        // UTF-16 index 1, not at byte index 2. `[0xFF, 0xFE]` was avoided here:
        // it is the UTF-16LE BOM, and `grep_searcher` sniffs and transcodes it
        // before matching, so it never reaches this decoding path at all.
        let mut haystack = vec![0xE0, 0xA0];
        haystack.extend_from_slice(b"needle\n");
        let (line, ranges) = line_ranges(&haystack, "needle", 4096).unwrap();
        // Derive the expectation from the decoded line itself, so the test states
        // the actual invariant: ranges index into `line` as a JS string would.
        let expected_start = line.chars().take_while(|c| *c == '\u{FFFD}').count() as u32;
        assert_eq!(
            line,
            format!("{}needle", "\u{FFFD}".repeat(expected_start as usize))
        );
        assert_eq!(ranges, vec![expected_start, expected_start + 6]);
    }

    #[test]
    fn test_a_match_past_the_cap_is_dropped() {
        // The line matched, but the only match sits beyond `max_line_bytes`, so
        // the returned string cannot show it: ranges is EMPTY, result stays true.
        let (line, ranges) = line_ranges(b"aaaa needle\n", "needle", 4).unwrap();
        assert_eq!(line, "aaaa");
        assert!(ranges.is_empty());
    }

    #[test]
    fn test_a_match_straddling_the_cap_is_clamped() {
        let (line, ranges) = line_ranges(b"aa needle\n", "needle", 6).unwrap();
        assert_eq!(line, "aa nee");
        assert_eq!(ranges, vec![3, 6]);
    }

    #[test]
    fn test_a_match_on_an_empty_line_is_an_empty_range() {
        let (line, ranges) = line_ranges(b"x\n\ny\n", "^$", 4096).unwrap();
        assert_eq!(line, "");
        assert_eq!(ranges, vec![0, 0]);
    }

    #[test]
    fn test_crlf_terminator_is_stripped_before_ranges() {
        // `\r` is structure, not content: it must be outside both the line and
        // any range touching the line's end.
        let (line, ranges) = line_ranges(b"needle\r\n", "needle", 4096).unwrap();
        assert_eq!(line, "needle");
        assert_eq!(ranges, vec![0, 6]);
    }

    #[test]
    fn test_smart_case_applies_to_ranges() {
        // Lowercase pattern, capitalised text: the range must cover what the
        // ENGINE matched, which a case-sensitive JS re-match would miss entirely.
        let (_, ranges) = line_ranges(b"Needle\n", "needle", 4096).unwrap();
        assert_eq!(ranges, vec![0, 6]);
    }

    #[test]
    fn test_invalid_pattern_is_a_domain_error() {
        assert!(::search::try_search_bytes_line_ranges(b"x\n", "a(", 4096).is_err());
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
/// finished until it stops: delete the caveat from
/// `docs/guide/caveats.data.json` and run `pnpm docs:sync` in the same PR.
/// That is checked now — `pnpm docs:sync --check` fails CI when the guide, the
/// README and the demo disagree with that file. A green `cargo test` still is
/// not evidence of it either way, so do the deletion here.
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
    fn backlog_3f_fixed_a_nul_byte_no_longer_discards_the_block() {
        // `BinaryDetection::quit(b'\x00')` abandoned everything it was given on
        // the first NUL, so a match was dropped even when it preceded the NUL
        // and even when it sat on an earlier line. `BinaryDetection::none()`
        // searches the bytes as text and reports what is there.
        assert!(matches(b"needle here", "needle"));

        assert!(matches(b"needle here\x00tail", "needle"));
        assert!(matches(b"needle here\n\x00tail", "needle"));
        assert!(matches(b"\x00needle here", "needle"));

        // The cost of the fix, pinned so it is not mistaken for an oversight:
        // nothing now declines to search binary input, so a pattern that occurs
        // inside a `.png` is reported like any other match. The caller decides
        // what it is pointing at.
        assert!(matches(b"\x89PNG\r\n\x1a\nIHDRneedle", "needle"));
    }

    #[test]
    fn backlog_17_fixed_dollar_matches_before_a_carriage_return() {
        // The searcher's line terminator is `\n`, so on Windows-authored text
        // the `\r` was the last character of the line and `$` sat behind it. A
        // `$`-anchored pattern therefore missed silently on any CRLF file while
        // the same pattern unanchored matched. `crlf(true)` on the matcher makes
        // the anchors treat `\r\n` as the ending.
        assert!(matches(b"needle\r\nnext\r\n", "needle"));
        assert!(matches(b"needle\r\nnext\r\n", "needle$"));

        // `^` was never affected — the CR is at the other end of the line — and
        // must not become affected.
        assert!(matches(b"a\r\nneedle\r\n", "^needle"));

        // The LF-only case still works, which is the half that could regress:
        // `crlf(true)` sets the matcher's line terminator, and this asserts it
        // was not moved off `\n`.
        assert!(matches(b"needle\nnext\n", "needle$"));
        assert!(matches(b"a\nneedle\n", "^needle"));
    }
}
