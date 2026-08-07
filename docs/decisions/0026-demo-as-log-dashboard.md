# 0026 — The demo is a log dashboard over four large files

**Status: ACCEPTED (2026-08-02), amended (2026-08-03), amended by
[0028](0028-demo-as-live-grep.md) (2026-08-07)** — the page reports bytes read per source, and the dashboard
this record describes has since been replaced by a live grep over one source at a time. See the two
*Amendment* sections at the end; this record's corpus and every measurement in it stand. Supersedes the row labelled `Corpus` in [0017](0017-example-as-hosted-demo.md);
amends [0023](0023-documentation-site.md) and [0025](0025-streaming-grep-over-http.md).

(The split status is deliberate, by the test [0024](0024-remove-the-in-memory-cache.md) states: a record is
amended when its decision survives in altered form and superseded when it survives in none. Almost all of 0017
survives untouched — the example is still the public demo, its dependencies are still on the maintenance path,
~~`searchBatchWithCallback` is still what drives it~~ **(2026-08-06: it is driven by one `grep()` per source
now; the class is deleted. The premise this parenthetical rests on is unaffected — what mattered was that each
source resolves on its own rather than behind the slowest, and it still does)**, and the base-path hazard its
`story-url.ts` guarded against is still guarded, now by `data/logs.ts`. Its row labelled `Corpus` survives in no form: not a smaller grid,
not fewer stories, not the same files renamed. `public/stories/`, `stories.ts`, `story-url.ts`, `story-card.tsx`,
`build-manifest.mjs` and `use-flip.ts` are deleted, and the argument that produced that row — the eleven canon
and omnibus files were supersets of the other 56 — is now about a choice nobody in this repository makes. So
that row is superseded and the rest of the record stands. 0023 and 0025 are amended rather than superseded
because each specified demo copy or demo structure this record rewrites while leaving its own decision in
force.)

## Context

**0025 ended by naming a gap, and it was worse than a gap in the copy.** The hero's accent reads *on files
your tab could never hold*, over a grid of 56 Sherlock Holmes short stories: 2.6 MB in total, 46 KB on
average. Every one of those files fits in a tab several thousand times over, so the accent was not merely
unproven — the page beneath it was a standing counterexample.

**The second property fared no better.** *An answer before the last byte* is netgrep's defining behaviour, and
a 46 KB file arrives in one or two chunks: the answer comes before the last byte by a margin no human can
perceive, on a download that was over before the spinner rendered. The grid showed 56 cards flipping in a
fraction of a second, which demonstrates **batching** and **independent per-file resolution** — both real, both
worth showing — and demonstrates nothing whatever about answering early or about memory. A visitor watching it
had to take the two headline claims on trust while watching evidence for neither.

**Nothing about that is fixable by editing copy.** A page can only measure the workload it is given, and 2.6 MB
of prose is not the workload the project positions itself around. 0025's niche is a person handed a URL for a
file they cannot open any other way, and that file is large — that is *why* they cannot open it. The demo was
searching the one size of file for which netgrep's properties do not matter.

## Decision

Four generated log files, one dashboard row each.

| | |
|---|---|
| Sources | Apache httpd 8.3 MB · ZooKeeper 40.0 MB · Hadoop YARN 120.1 MB · OpenSSH 240.2 MB |
| Total | 428,480,475 bytes — 408.6 MB, read in full by any query that matches nothing |
| Seeds | four ~512 KB prefixes of loghub-2.0, CC BY 4.0, committed under `packages/example/seeds/` |
| Generation | `scripts/build-logs.mjs`, tiling each seed to a target from `logs.config.json`, into a gitignored `public/logs/` |
| Served as | `.txt` — see below; the extension is a bandwidth decision, not a naming one |
| Layout | four rows, smallest source first, never reordered |
| Reported | elapsed time from the run's first byte requested to each source's own answer, and — from the amendment below — how much of that source was read before it answered. Nothing else |

**The files are repetitive, and the page's honesty depends on saying so here.** Each is one ~512 KB seed
concatenated to itself until it passes its target, with four `NETGREP-MARKER-<pct>` lines injected at 25%,
50%, 75% and 99% of the way through. The lines are real: they are unmodified log output from real Apache,
ZooKeeper, Hadoop and OpenSSH deployments, which is what keeps the regex examples on the page real — a visitor
who types `sshd\[[0-9]+\]: Failed` is matching text a real sshd emitted. The **volume** is manufactured, and a
visitor who scrolls one of these files will see the same few thousand lines come round again. The consequence
that matters is not aesthetic: **every non-marker term in these files recurs within the first megabyte**, so
the four markers are the only genuinely deep needles in 408 MB. Any claim the page makes about a *deep* match
rests on them, and the suggestion chips label them as what they are.

**Everything the page reports is measured, and nothing is added to make it look more measured than that.**
Each row reports when its source answered and how much of it was read to get there; the stats bar reports the
first match, the last answer, and the total read. That is the whole instrument. A **progress bar** is still
refused, because netgrep exposes no progress and a bar here would be an animation impersonating a measurement.
A **memory figure** is still refused, because peak memory is not reliably measurable from inside a tab and any
number for it would be a fabrication. **Do not add a number to the page to make it look measured** — this is
0025's instruction, restated because a dashboard is exactly the shape of page that invites one.

(This paragraph originally concluded that bytes read were unmeasurable too, from the true premise that the
*library* exposes no byte counter. That conclusion does not follow: the demo owns its page, and can count at
its own `fetch` boundary. It does — see the *Amendment* at the end.)

**Elapsed time is enough, because the difference is now seconds wide.** Measured in Chrome against the built
site: a match near the head of a file answers at **~16 ms** while the 240 MB OpenSSH read is still streaming;
all four sources settle at **~1.8 s**; and `NETGREP-MARKER-25` against OpenSSH answers at **~467 ms** where a
full read of that same file takes ~1.8 s. Three numbers a visitor can read off the page, none of which the old
grid could produce, because at 46 KB all three would have been the same number.

**The grid is deleted rather than kept beside the logs.** It earned its place by showing batching and
independent resolution — and the dashboard shows both, over four sources instead of 56, with the difference
that the resolutions are now seconds apart and legible. What the grid could never show, the logs show:
constant memory over input no tab could hold. Keeping it would have cost a second set of files, a second data
pipeline and a page arguing with itself about which half is the demonstration.

**The logs are served as `.txt`, and that is a bandwidth decision.** GitHub Pages compresses `text/plain`;
`.log` is served as `application/octet-stream`, which it does not compress. Measured locally over the four
generated files, gzip reaches **16.4×** at level 9 and 15.2× at the default level 6 — so a full-miss query
costs roughly **26 MB** on the wire as `.txt` against the full **408.6 MB** as `.log`. (The ratio is this
machine's `gzip`, not Pages' encoder, and the octet-stream half is inferred from its content-type behaviour
rather than measured against the live host. The order of magnitude is the point and it is not in doubt.) An
extension is a cheap thing to get right and a 380 MB thing to get wrong.

**A query that matches nothing reads every byte of all four files, the page says so, and no suggestion offers
one.** Those are two halves of one decision and both are deliberate. `kernel panic` was on the suggestion
chips and is gone: a chip is an invitation, and inviting a visitor to spend 408 MB of their connection — on a
phone, on a metered link — to be shown a row of dashes is not a demonstration, it is a bill. Every remaining
suggestion matches something, and that is a rule rather than the current state of a list. **The statement had
to survive the removal**, and it is still in the stats bar in as many words, beside the log total: the cost
is the most important true thing this page can tell a visitor about netgrep's shape, it is the direct
consequence of having no index, and a page that quietly stopped mentioning it after removing the one control
that demonstrated it would have hidden a cost by deleting its evidence. Anyone who types a miss still gets
one, timed as honestly as everything else. Stating a cost and not soliciting it are compatible; stating it and
then suppressing it are not.

## Consequences

**The Pages artifact is 410 MB, and the upload path is the risk this PR carries.** `actions/upload-pages-artifact`
tars and gzips, so the upload itself should be tens of megabytes, but the tar step walks the whole directory.
Nothing about that was verifiable before merging, and CI is where it will show if it shows at all.

**The other quota is the host's, and it is the one this record nearly missed.** GitHub Pages publishes a soft
limit of roughly 100 GB of bandwidth a month. A query matching nothing reads all four files, which is ~26 MB
compressed — so on the order of 3,800 such queries would exhaust it, and GitHub's remedy is to throttle or
disable the site. Two things already blunt it: serving `.txt` buys the 16× that turns 408 MB into 26 MB, and
Pages' own `max-age=600` means a visitor trying several patterns pays once. It is recorded here because the
reasoning above is careful about the *visitor's* bandwidth and was silent about the host's, and a record that
argues one and not the other looks complete when it is not.

**`pnpm dev` and `pnpm build:example` now depend on a generation step.** `prebuild` and `predev` run
`build-logs.mjs`, which skips any file already at its target — so the cost is paid once per checkout, at
**0.77 s** for all four files, and `pnpm build:example` measures **~5 s** end to end. The generator streams and
waits on `drain`, so writing 428 MB peaks at **~52 MB** of RSS; it is not a script that needs the file it is
writing to fit in memory, which would be an odd thing for this project to ship.

**The seeds are a permanent ~2 MB in git, and that is the price of not depending on a research host.** They
are committed because every alternative is worse (see the table below), and they are the only log data in
version control: `public/logs/` and its generated `manifest.json` are gitignored, and the app treats
the manifest as optional, falling back to the configured targets — a clean clone that has not run the
generator must not fail to typecheck over a file nobody committed.

**CC BY 4.0 attribution is now a standing obligation on the page.** `seeds/NOTICE.md` carries the citation and
the record link for the repository; the demo's footer carries the attribution and the licence link for
visitors. Neither is decoration and neither may be tidied away: the footer line is a licence term, and the
first person to remove it as clutter will not know that.

**0025's open gap is half closed, and the remaining half is named so it is not mistaken for closed.** That
record said the demo claims something it cannot demonstrate and that PR 4 would close the timing half. It does:
elapsed-at-answer against elapsed-for-a-full-read is now visible per source. **Constant memory is still not
demonstrated on the page and will not be** — it stays a documented property a visitor can check in devtools,
for exactly the reason 0025 gave. What changed is that the demo's data no longer contradicts the claim.

**[`BACKLOG`](../BACKLOG.md) item 23 stopped being invisible.** Chunk searching runs on the main thread, and
its entry said the demo does not show it because 56 files of prose are matched faster than a frame. Reading
240 MB through the WASM matcher between paints is a different proposition, and the item's text is updated to
say so. It is still not planned here — a worker is its own record — but it is now a thing a visitor could
notice rather than a note kept against rediscovery.

**A demo-only change still has to be typed `fix(example):` or `feat(example):` to ship**, per
[0017](0017-example-as-hosted-demo.md)'s deploy amendment and [0021](0021-release-please.md). This record and
the repository documentation around it are `docs:`, and none of it reaches the site.

## Rejected alongside

| Ask | Why not |
|---|---|
| Fetch loghub from Zenodo at build time | A hard dependency on a research host for every build of this repository. When it is slow, or moves the record, or rate-limits a CI runner, the `bundle` job goes red for a reason that has nothing to do with netgrep — and it eventually will |
| Point the demo at a live Zenodo URL from the browser | No CORS, and the datasets are zip containers. netgrep would fail at the fetch, on the one page whose job is to show it working |
| A CORS proxy in front of that | A third-party runtime dependency on the page whose entire value is that it is accurate. Already refused in [0025](0025-streaming-grep-over-http.md) and refused again for the same reason |
| Commit the generated logs | A permanent multi-hundred-MB object in every clone, forever, to save a 0.77 s generation step |
| Synthesise the log lines instead of using real ones | Then the regex examples stop being real too. The page's value is that `sshd\[[0-9]+\]: Failed` matches text a real sshd wrote; against generated filler it would be a pattern matching a pattern |
| One large file instead of four | Four is what shows the property. A single row answering in 1.8 s is a number; four rows answering at 8, 40, 120 and 240 MB, read down against their sizes, is the demonstration that answering is paced by bytes read |
| A progress bar, or a memory figure | Nothing in the library reports progress and nothing in the tab reports honest per-stream memory. Each would be an invented number on the page least able to afford one — [0025](0025-streaming-grep-over-http.md). **A bytes-read counter was refused on this row and should not have been** — it is measurable at the demo's own `fetch`, and the amendment below ships it |
| Keep the story grid below the dashboard | A second set of files and a second pipeline to demonstrate a subset of what the first one demonstrates |

---

## Amendment (2026-08-03) — the page reports bytes read, measured at its own `fetch`

**The record above refused a bytes-read counter, and the refusal rested on a non sequitur.** The premise was
true: netgrep exposes no byte counter, and it still does not. The conclusion — therefore the page cannot
report one — does not follow, because the page is not limited to what the library tells it. It owns its own
document, and every byte of every log file passes through its own `fetch` on the way in. Counting there is a
measurement, not an estimate, and it is the half of the argument the page could not previously make:
*answered after reading 60 MB of 240 MB* is what cancelling a download looks like as a number, where elapsed
time alone leaves a visitor to infer it.

| | |
|---|---|
| How | `window.fetch` is wrapped once, in `packages/example/src/lib/scan-meter.ts`; a response for one of the four log URLs has its body piped through a counting `TransformStream`, and everything else is handed to the original untouched |
| Shown per row | bytes read and the share of that file, e.g. `760 KB · 8.9%`, beside the elapsed time |
| Shown in the stats bar | the run's total, next to the total size of the four logs — `Scanned 104.0 MB` against `Log data 408.6 MB` |
| Tied to the run | reset when a run starts and written only when a source answers *that* run, exactly as the verdict and the elapsed time are. A row that has not answered the query now in the box shows `—`, not the last query's count |

**⚠️ THE NUMBER IS DECOMPRESSED FILE CONTENT, NOT BANDWIDTH, AND THE LABEL HAS TO SURVIVE THAT TEST.** The logs
are served gzipped and compress about 16×, so a row reading `240.2 MB` was carried by roughly 15 MB on the
wire. The word chosen is **"Scanned"**: you scan bytes, you do not scan a network, so it cannot be read as a
transfer figure the way "downloaded", "transferred" or even "read" can. The stats bar says the rest in as many
words — *Scanned is uncompressed log content reaching the search, not bytes on the wire — these files are
served gzipped at about 16×* — and that sentence is a term of the measurement rather than a caption. Shortening
it until it stops distinguishing the two is how this page would come to overstate bandwidth by a factor of
sixteen.

**Patching a global is acceptable here and would not be acceptable in the library.** The demo owns its page,
nothing but netgrep requests those four URLs, and there is no other seam — netgrep calls `fetch` internally and
takes no hook for it. No library code was touched to get this number, and none should be: a
`onBytes` callback on the search API is a widening that would need its own record and its own argument.

**Resource Timing was probed first and is not usable for this.** `performance.getEntriesByType('resource')`
reports `encodedBodySize: 0` and `decodedBodySize: 0` for an **aborted** fetch in Chromium — which is
precisely the case this page exists to show — and reports a cache hit as `transferSize: 300` beside a full
body size. Anything built on it would read `0 MB` for the early match and be wrong twice over.

**Measured in Chrome against the built site**, four rows against the four sources, as a share of each file:

| Query | Apache 8.3 MB | ZooKeeper 40.0 MB | Hadoop 120.1 MB | OpenSSH 240.2 MB |
|---|---|---|---|---|
| `workerEnv` — matches Apache only, near its head | **8.9%** (760 KB) | 100% | 100% | 100% |
| `NETGREP-MARKER-25` | 32.3% | 27.4% | 25.2% | 25.0% |
| `NETGREP-MARKER-75` | 77.1% | 78.1% | 75.3% | 75.0% |
| a pattern matching nothing | 100% | 100% | 100% | 100% |

The marker rows land on their planted depths, which is the check that the count is real. **The overshoot is
real too and is not error**: a match is only found once the chunk carrying it has arrived, and more of the
transfer is already in flight by then — the smallest file overshoots most, because 8.3 MB is small enough that
a large fraction of it is in flight at any moment. The counter reports bytes that actually arrived, which is
the honest figure: those are the bytes cancellation did not save.

**Peak memory remains genuinely unmeasurable, and this amendment does not weaken that.** No browser API gives
an honest per-stream figure, so a memory number on this page would still be a fabrication. The distinction
this amendment draws is between a quantity the page can observe at its own boundary and one it cannot observe
at all — bytes in are the first, memory held is the second. **Do not add a number to the page to make it look
measured** stands exactly as written.

---

## Amendment (2026-08-07) — the dashboard is replaced by a live grep

The page this record describes no longer exists. [0028](0028-demo-as-live-grep.md) replaces the four-row
membership dashboard with a single-source live grep: one file at a time, every matching line streamed into a
virtualized feed as it arrives. The reason is not that anything here was wrong — it is that
[0027](0027-streaming-matching-lines.md) shipped enumeration, and a page that breaks out of `grep()` at the
first hit argues for `matches()` while calling `grep()`.

**Three positions in this record and the example README are reversed by 0028, each with its premise:**

- **The refused progress bar.** Refused on two grounds — netgrep exposed no progress, and `Content-Length` on
  a gzipped response is the compressed size, so there was no honest total to divide by. `GrepOptions
  .onProgress` and the generator's `manifest.json` now supply both. **The rule underneath is untouched:** no
  fabricated figure, and therefore still no memory figure.
- **"Every suggestion chip matches something."** Its premise was that a zero-match query was uniquely
  expensive because it defeated early exit across four files. Under enumeration every query reads its source
  to the last byte, so the premise is void rather than outweighed.
- **The `window.fetch` wrapper** documented in the amendment above, `packages/example/src/lib/scan-meter.ts`,
  is deleted. It reverse-engineered a figure the library now reports directly. The Resource Timing finding
  recorded above is retained history rather than current mechanism, and is worth keeping so nobody re-probes
  it.

**None of this record's measurements are retracted.** The ~16 ms early answer, the 8.9%-of-Apache figure, the
marker rows landing on their planted depths and the ~16× gzip ratio were all correctly measured and remain the
evidence for the claims they were taken for. What changed is what the page chooses to show, not what was true
when it was shown. The corpus, the seeds, the generation script, the `.txt` extension and the `Scanned`
wording all survive into 0028 unchanged.
