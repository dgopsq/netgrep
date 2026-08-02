# 0026 — The demo is a log dashboard over four large files

**Status: ACCEPTED (2026-08-02).** Supersedes the **corpus half** of
[0017](0017-example-as-hosted-demo.md); amends [0023](0023-documentation-site.md) and
[0025](0025-streaming-grep-over-http.md).

(The split status is deliberate, by the test [0024](0024-remove-the-in-memory-cache.md) states: a record is
amended when its decision survives in altered form and superseded when it survives in none. Almost all of 0017
survives untouched — the example is still the public demo, its dependencies are still on the maintenance path,
`searchBatchWithCallback` is still what drives it, and the base-path hazard its `story-url.ts` guarded against
is still guarded, now by `data/logs.ts`. Its **Corpus** row survives in no form: not a smaller grid, not fewer
stories, not the same files renamed. `public/stories/`, `stories.ts`, `story-url.ts`, `story-card.tsx`,
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
searching the one size of corpus for which netgrep's properties do not matter.

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
| Reported | elapsed time from the run's first byte requested to each source's own answer. Nothing else |

**The files are repetitive, and the page's honesty depends on saying so here.** Each is one ~512 KB seed
concatenated to itself until it passes its target, with four `NETGREP-MARKER-<pct>` lines injected at 25%,
50%, 75% and 99% of the way through. The lines are real: they are unmodified log output from real Apache,
ZooKeeper, Hadoop and OpenSSH deployments, which is what keeps the regex examples on the page real — a visitor
who types `sshd\[[0-9]+\]: Failed` is matching text a real sshd emitted. The **volume** is manufactured, and a
visitor who scrolls one of these files will see the same few thousand lines come round again. The consequence
that matters is not aesthetic: **every non-marker term in the corpus recurs within the first megabyte**, so
the four markers are the only genuinely deep needles in 408 MB. Any claim the page makes about a *deep* match
rests on them, and the suggestion chips label them as what they are.

**What the page measures is elapsed time, and nothing is added to make it look more measured than that.**
netgrep exposes no byte counter, and peak memory is not reliably measurable from inside a tab, so a progress
bar here would be an animation impersonating a measurement and a memory figure would be a fabrication. Each
row reports when its source answered; the stats bar reports the first match and the last answer. That is the
whole instrument. **Do not add a number to the page to make it look measured** — this is 0025's instruction,
restated because a dashboard is exactly the shape of page that invites one.

**Elapsed time is enough, because the difference is now seconds wide.** Measured in Chrome against the built
site: a match near the head of a file answers at **~16 ms** while the 240 MB OpenSSH read is still streaming;
all four sources settle at **~1.8 s**; and `NETGREP-MARKER-25` against OpenSSH answers at **~467 ms** where a
full read of that same file takes ~1.8 s. Three numbers a visitor can read off the page, none of which the old
grid could produce, because at 46 KB all three would have been the same number.

**The grid is deleted rather than kept beside the logs.** It earned its place by showing batching and
independent resolution — and the dashboard shows both, over four sources instead of 56, with the difference
that the resolutions are now seconds apart and legible. What the grid could never show, the logs show:
constant memory over input no tab could hold. Keeping it would have cost a second corpus, a second data
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
to survive the removal**, and it is still in the stats bar in as many words, beside the corpus total: the cost
is the most important true thing this page can tell a visitor about netgrep's shape, it is the direct
consequence of having no index, and a page that quietly stopped mentioning it after removing the one control
that demonstrated it would have hidden a cost by deleting its evidence. Anyone who types a miss still gets
one, timed as honestly as everything else. Stating a cost and not soliciting it are compatible; stating it and
then suppressing it are not.

## Consequences

**The Pages artifact is 438 MB, and the upload path is the risk this PR carries.** `actions/upload-pages-artifact`
tars and gzips, so the upload itself should be tens of megabytes, but the tar step walks the whole directory.
Nothing about that was verifiable before merging, and CI is where it will show if it shows at all.

**`pnpm dev` and `pnpm build:example` now depend on a generation step.** `prebuild` and `predev` run
`build-logs.mjs`, which skips any file already at its target — so the cost is paid once per checkout, at
**0.77 s** for all four files, and `pnpm build:example` measures **~5 s** end to end. The generator streams and
waits on `drain`, so writing 428 MB peaks at **~52 MB** of RSS; it is not a script that needs the file it is
writing to fit in memory, which would be an odd thing for this project to ship.

**The seeds are a permanent ~2 MB in git, and that is the price of not depending on a research host.** They
are committed because every alternative is worse (see the table below), and they are the only part of the
corpus in version control: `public/logs/` and its generated `manifest.json` are gitignored, and the app treats
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
for exactly the reason 0025 gave. What changed is that the corpus no longer contradicts the claim.

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
| A progress bar, a bytes-read counter, or a memory figure | Nothing in the library reports progress and nothing in the tab reports honest per-stream memory. Each would be an invented number on the page least able to afford one — [0025](0025-streaming-grep-over-http.md) |
| Keep the story grid below the dashboard | A second corpus and a second pipeline to demonstrate a subset of what the first one demonstrates |
