# 0021 — release-please cuts releases, and merging its PR is the trigger

**Status:** Accepted (2026-07-31).

## Context

Releases fired from hand-pushed git tags — `search-**` and `netgrep-**` — and the demo deployed on every push
to `main`. Three independent triggers, each `uses:`-ing the full test graph.

**It had stopped working, and nothing said so.** `@netgrep/search` and `@netgrep/netgrep` were both `0.1.5`
on npm while the manifests said `0.2.0`; that version was bumped, never tagged, never published. Everything
from #4 onward was unreleased — the fork removal, the web target, pnpm/Vitest/Biome, Playwright, the CI
rework, the chunk-boundary fix, the in-flight fetch registry, `captureLine`. `npm i @netgrep/netgrep` got you
the version *with* the chunk-boundary false negatives and the poisoned partial cache.

Three forces made that failure mode structural rather than careless:

**The release step was the only manual step in the pipeline**, so it was the only one that could be
forgotten, and forgetting it produced no signal at all — no red check, no stale badge, nothing.

**The demo made it worse rather than better.** It deployed from `main`, so it always showed the newest code.
[0017](0017-example-as-hosted-demo.md) makes the site's accuracy load-bearing and
[AGENTS.md §2.3](../../AGENTS.md) makes updating it part of fixing a defect — but the site was documenting a
library nobody could install. §2.3 worries about a site that warns about fixed defects; the live failure was
the mirror image.

**Two packages had to be released in the right order**, and nothing enforced it. `workspace:*` resolves to an
exact version at pack time, so `@netgrep/netgrep` does not install until `@netgrep/search` is on npm. That
was a documented rule (§6.5) rather than a property of anything.

## Decision

**release-please, in manifest mode, with three components; merging its release PR is the release.**

`search` and `netgrep` are locked to one version by the `linked-versions` plugin. They have shared a version
for the project's whole life, and `workspace:*` makes that pin exact anyway, so a `search` release without a
paired `netgrep` release reaches no consumer. The cost is a no-op republish of one when only the other
changed — two wasted version numbers, no wrong states.

`example` is a component despite being private and never published, because **the deploy needs something to
fire on**. Without it a demo-only change produces no release and the site silently freezes. It also fixes the
inversion above: the demo now shows what was released rather than what was merged.

**`release.yml` runs the test graph, then release-please, then the publishes, then the deploy — in one run.**
Two things about that shape are deliberate and look like mistakes:

- **Publishing does not trigger on a tag.** release-please tags with `GITHUB_TOKEN`, and GitHub refuses to
  trigger workflows from events pushed with it. A `push: tags` trigger would silently never fire — no error,
  no run. This was the single largest correctness risk in the design.
- **The tests run *before* release-please**, which is the reverse of every upstream example. The action tags
  unconditionally, so the usual order leaves a git tag and a public GitHub Release for a version that never
  reached npm. Here a tag only exists for a green commit. The price is that a red `main` also stops the
  release PR updating, which is correct.

The three called workflows keep their own files on `workflow_call` + `workflow_dispatch`. The manual trigger
is not decoration: a publish that fails *after* the tag exists cannot be retried by re-running `release.yml`,
because release-please reports `release_created: false` the second time and every publish job skips.

**`bump-minor-pre-major: true`**, so a breaking change gives `0.3.0` rather than `1.0.0`. This project's
README leads with "it is an experiment"; 1.0.0 is a claim it should make deliberately, via an explicit
`Release-As:` footer, not as a side effect of typing `!`.

## Consequences

**The commit type now decides whether a change ships**, and this repository's history makes that a real trap.
`chore: drop the ripgrep fork` moved the `.wasm` by ~342 KB and silently fixed the `^`-anchoring bug — under
release-please it would release nothing. So two conventions are now written down: artefact-changing
maintenance is `fix(search):`, and anything a visitor can see on the demo is `fix(example):`, never `docs:`.

**Neither is enforced, and both fail silently** — the symptom is a missing release, not a red build. That
makes three unenforced conventions in this repository, alongside §2.3's "update the site when you fix a
defect". Recording that honestly is the point of this paragraph: the count is going up, and the next one
should be resisted or automated.

**The human-only guarantee survives, but its mechanism moved.** §6.1 used to be enforced by denying `git tag`
and `git push --tags`. The release act is now a PR merge, so the deny-list gained `gh pr merge`,
`gh release create`, `gh workflow run` and `gh api`. Commit subjects are also new authority — an agent typing
`feat!:` moves a published version number — which is why `bump-minor-pre-major` matters beyond taste.

**Two config details were established by dry run, not by reading**, and both had silent failure modes:

- The `rust` strategy only looks for a `Cargo.lock` **inside the package directory**, and this workspace keeps
  one at the root. The `extra-files` route fails invisibly: `jsonpath-plus` disables filter expressions, so
  `$.package[?(@.name=='search')].version` matched nothing and wrote nothing. The `cargo-workspace` plugin
  does the job properly.
- `example` had no prior tag, so release-please took its first-release path and produced **`1.0.0`** —
  a demo a major version ahead of the library it demonstrates. Fixed with `initial-version: "0.1.0"`.

**`main` is now checked once instead of twice.** `test-and-lint.yml` lost its `push: main` trigger; it used
to run there *and* inside `deploy-pages.yml`, in two concurrency groups that could not cancel each other.

**`NPM_TOKEN` stays**, with `provenance: true` added and the publish action moved to v3. npm's trusted
publishing would remove the credential entirely and is the obviously better end state — but it binds a
package to one workflow filename, which would break the `workflow_dispatch` retry path, and stacking a second
new authentication mechanism onto the largest release this repository has ever cut would make a failure
ambiguous between them. Deferred as backlog item 20, deliberately.

## Rejected alongside

| Rejected | Why |
|---|---|
| Independent versions for `search` and `netgrep` | `workspace:*` pins exactly, so a lone `search` release reaches nobody; release-please's `node-workspace` plugin cannot propagate the bump because `search` is Rust-versioned |
| A PAT or GitHub App token so tag pushes trigger the existing workflows | Adds a long-lived credential and leaves the publish-order race intact; publishing in-run needs neither |
| Keeping `deploy-pages.yml` on `push: main` alongside the release trigger | The demo would go back to showing code no one can install |
| Renovate or Dependabot, on the grounds that "we have a bot now" | Still refused by §6.2. release-please reacts to changes already merged; a dependency bot proposes changes nobody asked for, which on a repository maintained in bursts becomes ignorable noise |
| Requiring a human review on the release PR | Belt and braces on a one-maintainer repository; the deny-list already covers the agent case |
