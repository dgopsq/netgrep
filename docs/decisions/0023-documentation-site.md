# 0023 — A documentation site, and one source for the caveat list

**Status:** Accepted. **Amends [0017](0017-example-as-hosted-demo.md)**: the demo is now a two-page site, and
three build-time dependencies join the maintenance path that record created. It also replaces the
hand-maintenance tables in
[AGENTS.md §2.3](../../AGENTS.md#23-️-fixing-a-defect-is-not-finished-until-the-demo-site-stops-warning-about-it)
with a generator and a CI check.

No issue preceded this one. As with [0022](0022-capture-ranges.md), the argument was made in a written design
and reviewed before any code was written; this record is the part of it worth keeping.

## Context

**The README was 312 lines because it was the only place a reference could live.** After the install it carried
the whole API — batching, the matching line, match ranges, `maxLineBytes`, the regex dialect, cancellation,
caching, packaging, the limitations — and **six `> [!…]` callouts** competing for the same reader's alarm. Two
audiences were being served one document: someone deciding whether to depend on the package, for whom it was
far too long, and someone looking up what `searchBatch` does on a 404, for whom it was badly organised. Neither
was well served, and every new capability made it worse: 0022 added a section to a file that was already the
problem.

**The demo had nowhere to send anyone.** [0017](0017-example-as-hosted-demo.md) argued that the site's audience
needs to watch the thing work before it reads the caveats, and that argument still holds — but the only link
off that page went to GitHub. A visitor who typed a query, saw it resolve mid-download and wanted the API had
to leave the site to find one.

**And a limitation lived on three surfaces at once.** `limitations.tsx` held a hand-typed `CAVEATS` array, the
README held a hand-written list, and [`ARCHITECTURE.md`](../ARCHITECTURE.md) described the same defects a third
time. Nothing connected them except AGENTS.md §2.3, which admitted in its own text that nothing enforced it —
and it had already failed: on 2026-07-30 four decision records, `ARCHITECTURE.md` and §2.3 itself were all
still describing a defect that had just been fixed. A site whose only value is accuracy was one forgotten edit
away from lying, permanently, in public.

## Decision

**The canonical prose is [`docs/guide/`](../guide/), and it is markdown that reads on GitHub.** Six
hand-written files and one generated. They are repository documents first: links between them are relative and
resolve on GitHub, links out of them point at the repo, and the site is a *rendering* of them rather than their
home. That ordering is the load-bearing part — a guide whose canonical form is a built page is one a
contributor edits blind, and reviews blind.

**`/docs` is a second real document, not a route.** `vite.config.ts` gains a second rollup input and
`appType: 'mpa'`; a Vite plugin reads the seven markdown files at build time and splices the body, the
table of contents and the site nav into `docs/index.html` through `transformIndexHtml`. There is **no router,
no React and no markdown parser in the browser**. The page is complete with JavaScript disabled, including its
stylesheet, because Vite emits a real `<link rel="stylesheet">` into the built HTML.

What that buys is measurable, and it is the reason to care on this site specifically: `/docs` ships
**0.36 kB** of JavaScript — an `IntersectionObserver` that highlights the table-of-contents entry you are
reading under, and nothing else — against the demo page's **248 kB** React bundle. A page whose subject is
download cost cannot ship 50 KB of parser to display prose about download cost.

**One data file, three renderings, and CI fails when they disagree.**
[`docs/guide/caveats.data.json`](../guide/caveats.data.json) is the only place a limitation is written.
`pnpm docs:sync` renders it onto `docs/guide/07-limitations.md`, onto
`packages/example/src/data/caveats.generated.ts`, and into the block between two markers in `README.md`;
`pnpm docs:sync --check` writes nothing and exits 1, and runs in CI's `js` job. Fixing a defect is now
**deleting one entry** and running one command, in the PR that fixes it. The README's bullets link to
`/docs/#<id>` — the caveat's `id`, never a slug of its title, because "No ranking" has been retitled twice
already and a fragment that tracks a title is a link that rots on a rewording.

### Why not a router, MDX or a docs generator

Two routes do not justify a runtime dependency. React Router, MDX and every docs generator worth the name bring
a dependency tree that **0017 explicitly put on the maintenance path** — that record's whole cost was accepting
that the demo's dependencies are now maintained, and the honest way to hold that cost down is to add few of
them. A build-time render costs the browser nothing and the maintainer three devDependencies (`markdown-it`,
`@shikijs/markdown-it`, `@types/markdown-it`), none of which appears in the shipped bundle.

A generator would also have taken the guide's canonical form with it. Docusaurus and its relatives want front
matter, a sidebar file and their own link syntax; the moment the markdown stops being ordinary markdown it
stops rendering on GitHub, and `docs/guide/` becomes source for a build rather than something a reader can open
in the repository. The rendering is the derived artefact here, and inverting that is the whole cost.

The one thing this gives up is what generators are actually good at — versioned docs, a plugin ecosystem,
search — and the first two are refused below.

### Why the site's caveat list is still not the README's

This is the part most likely to be "simplified" later, so it is written out. **The three surfaces have three
different memberships, on purpose, and flattening them into one list is the mistake this design exists to
prevent.**

| Field | What it decides |
|---|---|
| `kind` | `defect` (a real bug, listed in the README) or `by-design` (never going to be fixed — shown on the site and in the guide, and kept out of the README's *defect* list, where it would be a bug report for a decision) |
| `demoCorpusCanTrigger` | Whether **this corpus** can reach it. `$` on CRLF and the 64 KB line ceiling are both `false`: every corpus file is LF and its longest line is 76 bytes |

The `demoCorpusCanTrigger` filter is not tidying. The demo's list is worth reading precisely because every
entry on it is live *on the page you are looking at* — a visitor can go and reproduce any of them. Adding a
caveat the corpus cannot trigger dilutes exactly that, and a diluted list is one nobody checks. The README's
audience is the opposite: they will run netgrep over their own files, where CRLF and minified JavaScript are
entirely reachable, so for them those two are the point.

And the demo's third card, **"This demo runs with the cache off", is not library data at all.** It describes
this page's configuration — no library fix retires it — so it stays hand-written in
`packages/example/src/data/visible-caveats.ts` and must never move into the shared file. `visible-caveats.ts`
carries the curation rule as a comment and `visible-caveats.spec.ts` pins the resulting list, so a future
"unify these" refactor fails a test rather than passing review.

So: the guide shows all five entries, split into defects and by-design; the README lists the four defects; the
demo shows two library caveats plus its own. Three memberships, one source, no copy.

## Consequences

- **`/docs` describes the released version; `docs/guide/` on `main` describes `main`.** The site deploys on
  release ([0017's amendment](0017-example-as-hosted-demo.md#amendment-the-site-deploys-on-release-not-on-every-push-to-main-2026-07-31),
  [0021](0021-release-please.md)), which is right for both audiences — a visitor should read the API they can
  install, and a contributor should read the repository they are editing. The cost is a lag with no warning on
  it: documentation written for unreleased behaviour sits correct-in-the-repo and absent-from-the-site until
  the next release. Worse, a `docs:` commit neither releases nor deploys, so a guide fix typed that way waits
  for some other component. Hard rule 3 already says this about demo copy; it now also applies to the guide.
- **Three more build-time dependencies on the demo's maintenance path**, per 0017. They are `devDependencies`
  and none of them ships, but rule 2 applies to them the same way: a version change is its own task.
- **The README now contains a generated block, and hand-editing it is silently pointless.** Anything between
  `<!-- BEGIN GENERATED CAVEATS -->` and `<!-- END GENERATED CAVEATS -->` is overwritten by the next
  `pnpm docs:sync`, and `docs:sync --check` fails CI in the meantime. The splice refuses to run at all if a
  marker is missing or the two are out of order, rather than producing a plausible-looking README with the
  section duplicated.
- **The data file carries three lengths of the same fact**, which looks redundant and is not: `short` is a
  one-line README bullet, `body` is the guide's full explanation with links and a backlog reference, and
  `demoBody` is card copy — plain text, because it renders into a `<dd>` where markdown would show as literal
  backticks, and phrased for the page it is on ("sort these cards", not "sort files"). `demoBody` is `null` for
  entries the demo does not show. Collapsing the three would mean one surface getting prose written for
  another, which is the failure this record's context section is about.
- **`ARCHITECTURE.md` and AGENTS.md §7 still describe the same defects in their own words**, and are not
  generated. That is deliberate — they explain the *mechanism* and name the file and the pinning test, for
  contributors — but it is honest to record that the "one source" claim covers the consumer-facing caveat list
  and not every mention of a defect in the repository.
- **§2.3 stops being a list of things to remember and becomes a list of two fields to decide.** What is still
  unenforced is named there rather than implied: the hero copy and the `StatsBar` line, which state the scope
  of a result and the 1.17 MB WebAssembly download, are checked by nobody.

## Rejected alongside

[AGENTS.md §1](../../AGENTS.md#1-what-this-project-is) asks that a change of shape name what it does **not**
open the door to. A documentation site is an unusually inviting surface, so:

| Ask | Why not |
|---|---|
| **Render `docs/decisions/` on the site** | These records are written for contributors and they argue with each other — half of them amend or supersede another, and several say plainly where the earlier reasoning was wrong. That is the right register for a repository and the wrong one for a page whose visitor is deciding whether the library works. They stay on GitHub, where the audience already is. |
| **Migrate `ARCHITECTURE.md` into the guide** | Different question, different reader. The guide answers "how do I use this"; `ARCHITECTURE.md` answers "how does this work inside", names `MAX_TAIL_BYTES` and `BinaryDetection::quit`, and is read alongside the source. Merging them would double the guide's length with material that helps no consumer, and would put internals on a page that must stay short enough to read. |
| **Search over the documentation** | Tempting, and the temptation is the problem: netgrep searching its own docs would be a demo, not a feature. The corpus is seven files on **one page**, where `Ctrl-F` is better than anything netgrep can offer — a boolean per file is not navigation — and doing it would ship the 1.17 MB WebAssembly onto the one page in this project that currently ships 0.36 kB. |
| **Light mode** | The demo has been dark-only since 0017 and the guide matches it. A second theme means auditing every token in two palettes, and the site would then have two appearances and one set of eyes checking them. Cheap to add and permanently on the maintenance path — which is the shape of change this project refuses by default. |
| **Versioned documentation** | The obvious answer to the release lag in *Consequences*, and it is the wrong size of solution: it would mean a build per released version, a switcher, and stale copies of the guide kept alive forever, for a 0.x library with two published packages on one version. The lag is a few days and the repository always shows the truth. Revisit if netgrep ever ships a 1.0 with a supported previous major. |

None of these is refused because documentation is unwelcome. They are refused because `/docs` is worth having
only while it stays a page that loads instantly, reads without JavaScript, and cannot disagree with the README.
