/**
 * The syntax theme for the guide's code blocks, built from this site's own
 * palette: neutrals plus the one teal accent, and nothing else.
 *
 * The rest of the page is near-black with a single accent colour; a
 * general-purpose theme puts reds, oranges, purples and blues on what is by
 * some margin its most colourful element. So colour carries meaning here
 * instead: teal marks what a reader scans a sample for — keywords and string
 * literals — a second, paler teal marks constants, and everything else is a
 * step on the neutral ramp, with comments at the bottom of it and punctuation
 * quieter than the code it separates.
 *
 * Hex rather than `oklch()`: Shiki parses these values and keys its
 * colour-replacement map on the lowercased hex string, and understands no
 * other notation. Each below is the sRGB rendering of a token in
 * `src/index.css` — change one there and recompute it here.
 */

/** `--card: oklch(0.185 0.005 240)` — the same panel colour the `<pre>` sits on. */
const BACKGROUND = '#111315';

/** `--foreground: oklch(0.96 0.002 240)` — identifiers, function and type names. */
const CODE = '#f1f2f3';

/** `--muted-foreground: oklch(0.68 0.008 240)` — punctuation, brackets, operators. */
const PUNCTUATION = '#94999d';

/**
 * `oklch(0.60 0.008 240)` — one step below `--muted-foreground` on the same
 * neutral ramp, and the dimmest step that still clears 4.5:1 against the block
 * background. Comments in a guide are prose, not decoration.
 */
const COMMENT = '#7c8185';

/** `--primary: oklch(0.812 0.128 181)` — keywords and string literals. */
const ACCENT = '#47dcc6';

/**
 * `oklch(0.885 0.06 181)` — the accent hue lightened and desaturated, so
 * constants read as a second step of the same colour rather than a second
 * colour.
 */
const ACCENT_PALE = '#aee7db';

/**
 * A TextMate theme, which is what Shiki takes in place of a bundled theme name.
 *
 * Scope selectors are matched longest-prefix-first, which is what lets
 * `keyword.operator` pull symbolic operators back out of the teal that
 * `keyword` gives the rest, and `keyword.operator.new` push `new` back into it.
 */
export const netgrepTheme = {
  name: 'netgrep',
  type: 'dark' as const,

  colors: {
    'editor.background': BACKGROUND,
    'editor.foreground': CODE,
  },

  settings: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: COMMENT },
    },
    {
      // Also catches a string's own quotes, which are
      // `punctuation.definition.string` — so a literal reads as teal text
      // between quiet delimiters.
      scope: [
        'punctuation',
        'meta.brace',
        'keyword.operator',
        // `=>`, which TypeScript's grammar files under `storage` with the
        // declaration keywords. It is a symbol, so it belongs here.
        'storage.type.function.arrow',
      ],
      settings: { foreground: PUNCTUATION },
    },
    {
      scope: [
        'keyword',
        'storage',
        'string',
        // `new`, `typeof`, `instanceof`, `in`, `of`, `await`: words, not
        // symbols, and grouped with the operators by the grammar rather than
        // by anything a reader would recognise.
        'keyword.operator.new',
        'keyword.operator.expression',
      ],
      settings: { foreground: ACCENT },
    },
    {
      scope: ['constant', 'support.constant'],
      settings: { foreground: ACCENT_PALE },
    },
  ],
};
