# 0028 — The demo is a live grep over one file

**Status: ACCEPTED (2026-08-07)** — supersedes the dashboard [0026](0026-demo-as-log-dashboard.md) describes,
and amends it rather than replacing it whole: 0026's corpus, its seeds, its generation and every measurement
in it survive untouched. What is replaced is the *shape of the page* built on top of them.

## Context

**The page argued for `matches()` while calling `grep()`.** `use-log-search.ts` opened one `grep()` per source
and broke out of the loop at the first hit — a `firstLine()` helper whose whole job was to stop. That is a
membership question, answered four times in parallel, and it was the right page to build when
[0026](0026-demo-as-log-dashboard.md) shipped: the API had no enumeration in it, and early exit was the
property worth showing.

[0027](0027-streaming-matching-lines.md) changed what there is to demonstrate. `grep()` now yields **every**
matching line, each with its file-absolute line number, and the last one cannot be known before the last byte.
A dashboard that stops at the first hit shows none of that. Worse, it teaches the opposite lesson by omission:
a visitor watching four rows resolve learns that netgrep answers early, and learns nothing about what it costs
to enumerate — which is the question anyone reaching for `grep()` actually has.

**The four-row layout had also run out of things to say.** Every row shows the same shape of answer against a
different file size. That is one measurement repeated four times, and the picker below shows it in a form the
visitor performs rather than reads.

## Decision

One source at a time, streaming every matching line into a virtualized feed.

| | |
|---|---|
| Sources | unchanged — Apache 8.3 MB · ZooKeeper 40.0 MB · Hadoop YARN 120.1 MB · OpenSSH 240.2 MB, chosen one at a time |
| Default | **Apache, 8.3 MB**, searching `error` on load — a pattern that matches all four sources, so the default pair can never open on an empty feed |
| Reads | the whole file, every query, with no `break` and no early exit |
| Retained | the first `MAX_RETAINED_HITS = 100,000` matching lines; every one past that is **counted and not stored** |
| Rendered | `@tanstack/react-virtual`, ~60 row elements in the DOM whatever the match count |
| Reported | matching lines, first match, scanned, elapsed, throughput — and a read meter against the manifest's real size |

**The default source moved to the smallest file, and that is a deliberate spend of someone else's bandwidth.**
The page auto-runs on load. Defaulting that to the 240 MB OpenSSH source would spend a quarter of a gigabyte
of every drive-by visitor's connection before they had asked for anything at all. The picker is directly under
the field, and a visitor who *chooses* the 240 MB file has demonstrated more to themselves than one who was
handed it.

**The retention ceiling is the page's budget, not the library's bound, and the page says so on screen.** The
arithmetic: OpenSSH at 240 MB is ~2.4 M lines, and a loose pattern (`e`, `sshd`) matches most of them. At ~100
characters a line, ~2 bytes per character plus per-object overhead, that is comfortably past half a gigabyte
retained — which ends the tab. 100,000 lines is ~45 MB: large, survivable, and ~100× more than anyone scrolls.
The count keeps rising after storage stops, so the total is the file's rather than a function of the page's
memory budget, and the feed's header reads `showing 100,000 of 2,413,882` with a note underneath stating that
**what is bounded is what the demo stores, not what netgrep holds**. A visitor who read the truncation and
concluded netgrep buffers would have learned the exact opposite of the thing being demonstrated.

**The line-number gutter is honest only because of these seeds.** [BACKLOG](../BACKLOG.md) item **3g**: `grep`'s
running line base gains a line at each 64 KB window slide inside a line carrying no terminator, so a number
past such a line is approximate. The longest line across all four seeds is 387 bytes, so this is unreachable
here — **which makes it a constraint on the seeds, not on the page**. A future seed carrying a 64 KB line
silently turns every number in that gutter into a guess, and neither the page nor CI would catch it.

## Three positions this reverses

Each was argued in writing. None is being quietly dropped.

**1 — The progress bar, refused by [0026](0026-demo-as-log-dashboard.md) and the example README.** The refusal
rested on two facts: netgrep exposed no progress, and there was no honest total to divide by, since
`Content-Length` on a gzipped response is the *compressed* size and would drive a bar finishing at a few per
cent. Both are now false. `GrepOptions.onProgress` reports cumulative decompressed bytes, and the generator's
`manifest.json` carries the real uncompressed size. The bar divides one measured number by another.

**The rule the refusal was protecting is unchanged and still binding:** no fabricated figure on this page. What
was refused was *an animation impersonating a measurement*, and that is still refused. **Memory held is still
not reported**, for exactly the reason 0026 and [0025](0025-streaming-grep-over-http.md) both give — no browser
API yields an honest per-stream figure — and **do not add a number to the page to make it look measured**
stands word for word.

**2 — The "every suggestion chip matches something" rule.** Its premise was that a zero-match query was
*uniquely* expensive: it defeated early exit and read all four sources to their last byte, so offering one as a
chip spent hundreds of megabytes to render a row of dashes. Under enumeration there is no early exit for it to
be expensive relative to — every query reads its source to the last byte, because the last matching line cannot
be known before it. **The premise is void, not outweighed.** The zero-match chip (`zzz-no-such-line`) is now the
cheapest honest way to show what a full read costs, which is the other half of the page's argument.

**3 — `lib/scan-meter.ts`, deleted.** 0026's amendment documents a `window.fetch` wrapper piping matching
responses through a counting `TransformStream`. It was a workaround for a missing library hook, and the hook
now exists. The measurement it produced is unchanged — the same cumulative decompressed bytes, from inside the
library instead of around it. 0026's finding that Resource Timing is unusable for this is **retained history,
not current mechanism**, and is worth keeping precisely so nobody re-probes it.

## Rejected alongside

| Refused | Why |
|---|---|
| A four-source interleaved feed | Unreadable and unattributable; 400 MB of a visitor's connection per query |
| `grep -m`-style early stop | The full scan is the subject; stopping early makes the file size meaningless |
| Auto-follow / tail mode | An unreadable blur that fights the visitor's scroll |
| A memory figure | Still unmeasurable from a tab; the refusal in [0026](0026-demo-as-log-dashboard.md) stands unchanged |
| Regenerating a larger seed | A heavier Pages artefact for a louder number; the picker already scales the claim |
| Presenting throughput as an engine benchmark | It measures the CDN and gzip inflation as much as ripgrep |

## Consequences

**Every query now costs a full read, and the page stops being able to hide it.** Under the dashboard a common
term answered in milliseconds and stopped; here the same term reads 8.3 MB, or 240.2 MB, to its last byte. That
is not a regression to be optimised away — it is the price of enumeration, stated by the page in as many words,
and it is what makes the source picker a demonstration rather than a menu.

**Throughput is end-to-end and is labelled as such wherever it appears.** It is bytes delivered over wall-clock
time, so on the published site it measures GitHub Pages and gzip inflation at least as much as it measures
ripgrep. Presented as an engine figure it would be a measurement of someone's CDN wearing this library's name.

**`Scanned` is decompressed file content, not bytes on the wire.** The logs are served gzipped at ~16×, so a
full bar reading `240.2 MB` was carried by roughly 15 MB of transfer. 0026 chose the word *Scanned* for this
reason and the choice carries forward; the sentence distinguishing the two moved from `stats-bar.tsx` to
`run-stats.tsx` and may not be shortened past the point where it still distinguishes them.

**One new dependency**, `@tanstack/react-virtual`, on a package whose dependencies are already on the
maintenance path under [0017](0017-example-as-hosted-demo.md). It earns its place: a loose pattern retains
100,000 rows, and a non-virtualized list of them is the failure this page would otherwise demonstrate by
accident.
