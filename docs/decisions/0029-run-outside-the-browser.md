# 0029 — netgrep runs outside the browser, and the API does not move

**Status: ACCEPTED (2026-08-16).** Reverses the *Node.js support* non-goal recorded in
[`ARCHITECTURE.md`](../ARCHITECTURE.md) and **supersedes in part**
[0005](0005-esm-only-distribution.md), whose consequences list "no Node.js consumption" — ESM-only and
everything else in that record still hold. Amends `ARCHITECTURE.md`'s account of the removed
`initSync`-from-disk accommodation rather than overturning it. Cites
[0002](0002-search-while-downloading.md) and [0027](0027-streaming-matching-lines.md) without touching
either.

Argued in [#60](https://github.com/dgopsq/netgrep/issues/60) before any code, as AGENTS.md §1 requires,
and then in a written design that corrected the issue on six points. The record ships in the same pull
request as the mechanism, because a record on `main` announcing Node support while `README.md` still
denies it is a contradiction rather than a sequencing detail.

## Context

**The non-goal was a statement about the loader, and it read as a statement about the project.** Nothing
in the engine or the streaming path is browser-specific: `packages/search/src/lib.rs` imports
`wasm_bindgen::prelude::*` and nothing else — no `web_sys`, no `js_sys`, no clock, no filesystem — and the
TypeScript touches exactly two web APIs, `fetch` and a stream reader, both built into Node 18+, Deno and
Workers. There is no `TextDecoder`, `window`, `document` or `Blob` on the runtime path, because the
decoding happens in Rust. One line stood in the way: `wasmReady.ts` called `init()`, which resolves
`index_bg.wasm` relative to its own module URL and fetches it.

**The case for the server is stronger than the case for the tab, and it is the issue's, not this
record's.** netgrep was built for one situation — *a URL, and no shell on the machine that holds the
file* — and that situation is more common on a server than in a browser. Edge functions, serverless
handlers and the sandboxes that generated code runs in can all make network requests and mostly cannot
run programs. Three costs also change sign:

- **The cross-origin gate disappears.** Needing `Access-Control-Allow-Origin` from the file's host is a
  browser rule. It is the single limitation that most often makes a given file unreachable, and off the
  browser it does not exist. Whatever authorization the host itself demands still does.
- **The download becomes a load-time compile.** The ~1.17 MB of WebAssembly is fetched once per page
  load in a browser. In a Worker it is bundled into the deployed script and compiled when the isolate
  starts; no request pays for it.
- **Constant memory stops being an elegance and becomes the difference between slow and impossible.**
  Many of these environments cap a request at 128 MB. Reading a 240 MB log into a string to search it
  does not get slow there, it fails, and netgrep holds one 64 KB block plus the incomplete trailing line
  however large the file is ([0024](0024-remove-the-in-memory-cache.md), [0027](0027-streaming-matching-lines.md)).

**And what netgrep does in Node today is worse than not working.** The boot happens at module load, so
the rejected `fetch` has nobody attached to it: `import('@netgrep/netgrep')` produces an **unhandled
rejection at import time**, which under Node's default since v15 terminates the process. The failure is
not a search that returns nothing. It is the host going down before any consumer code runs — which is
also the fact that decides the design below.

### The measurement

These are runs, not estimates. macOS arm64, Node 24.18.0, Deno 2.3.3, wrangler 4.123.0. The same probe
in each runtime: a **7.7 MB body of 200,001 lines** served over real HTTP, matches seeded at line 137 and
at the last line, searched through the real `grep` and `matches` against the real engine.

| Runtime | Boot | `grep` line numbers | true positive | true negative |
|---|---|---|---|---|
| Node 24.18.0 | `initSync({module: readFileSync(…)})` | `[137, 200001]` | `true` | `false` |
| Deno 2.3.3 | **unchanged** eager `init()` | `[137, 200001]` | `true` | `false` |
| workerd, real `wrangler dev` | `import wasm` + `initSync` at global scope | `[137, 200001]` | `true` | `false` |

A true positive **and** a true negative in each, because [0005](0005-esm-only-distribution.md)'s failure
mode was a broken build answering `false` — indistinguishable from "no matches" — and only the pair
excludes it. The line numbers are what prove the real engine ran rather than a stub.

Two figures beyond the table. **Node's heap grew by −0.3 MB across the whole search**, so the property
the 128 MB argument rests on survives off the browser and is not being asserted from the browser's
behaviour. And `wrangler deploy --dry-run` bundled to **1156.12 KiB / gzip 493.25 KiB**: the size *is*
the evidence, because it is only reached if the `.wasm` was resolved from inside a dependency and inlined
into the script rather than silently dropped. The deployed Worker then answered
`{"hits":[137,200001],"truePositive":true,"trueNegative":false}` under real workerd.

**Deno needed no boot module at all.** Its `fetch` reads the `file:` URL the default loader builds, so
the path it takes is byte for byte the browser's. The issue listed it as "possibly nothing"; it is
nothing, and that is a run rather than a reading of the docs.

## Decision

**One conditional internal specifier, `#wasm-boot`, and three boot modules behind it.** `grep.ts`,
`matches.ts`, `streamBlocks.ts`, `decodeBlock.ts` and every data type are untouched. `wasmReady.ts`
becomes a one-line re-export, which keeps the name every entry point already imports and keeps its
comment as the place the scheme is explained.

`imports` rather than `exports` because it resolves by condition from *inside* the package: the public
entry point stays single, and a consumer never names a runtime.

| Condition | Module | What it does |
|---|---|---|
| `netgrep-source` | `src/lib/boot/fetch.ts` | The source-running builds — `tsc` and the Vitest `unit` project — reach source instead of `dist/` |
| `types` | `dist/lib/boot/fetch.d.ts` | One declaration for all three: the modules are interchangeable by construction, each exporting `wasmReady: Promise<unknown>` and nothing else |
| `workerd` | `dist/lib/boot/workerd.js` | `import wasm from '@netgrep/search/pkg/index_bg.wasm'`, then `initSync` |
| `deno` | `dist/lib/boot/fetch.js` | Today's loader, unchanged |
| `node` | `dist/lib/boot/node.js` | `initSync({module: readFileSync(fileURLToPath(import.meta.resolve(…)))})` |
| `default` | `dist/lib/boot/fetch.js` | The browser, and anything else with a streaming `fetch` |

**The boot stays eager in every runtime, and that is the load-bearing choice.** Node's read is
synchronous, so there is no top-level await and the module finishes booting before anything can import
it. Workers instantiate an already-compiled module, which is not network I/O and is therefore allowed at
global scope where a `fetch` is not. Nobody loses the import-time head start, no runtime gets a different
contract from the others, and — see below — no new export enters the API.

**Condition order is not cosmetic, and a wrong order misroutes silently.** That is the 0005 failure
shape: not a crash, but a search answering `false` because the engine was never instantiated. The rules,
in the order they appear in the manifest:

- **`netgrep-source` first** — it is opt-in, set only by this repository's own `customConditions`, and it
  must beat every runtime condition or a source build resolves into `dist/`.
- **`workerd` before `default`** — Workers also match `browser` in some resolvers, and the default loader
  fetches at global scope, which workerd forbids.
- **`deno` before `node`** — Deno matches both under npm compatibility, and listing it explicitly keeps
  it on the path the table above verified rather than on Node's disk read.
- **`default` last** — it is the catch-all and shadows everything after it.

**Bun matches `node` and would probably work for free. It is not claimed anywhere, because it has not
been run.**

### Why not a caller-supplied module

The issue proposed keeping the eager call and adding an optional, idempotent way to hand the
WebAssembly in — additive, small, and the obvious shape. **It cannot work, and the reason is timing
rather than taste.** The boot happens at module load, so any opt-in API is offered to a caller who does
not exist yet: in Node the unhandled rejection has already taken the process down before the first line
of consumer code runs, and in Workers the default loader has already performed I/O at global scope. An
option that is only reachable after the failure is not an option.

It would also have cost a third export against a deliberately two-function API, which is the surface
AGENTS.md §1 exists to defend and which [0027](0027-streaming-matching-lines.md) *narrowed* while it
widened. Conditional resolution needs no new export at all: four runtimes, same two functions, same
results.

## Consequences

**`@netgrep/netgrep` gains an `exports` map, which forbids deep imports.** `@netgrep/netgrep/dist/lib/…`
stops resolving. That is breaking in the strict sense and is named here rather than discovered: those
paths were never API, and almost certainly nobody imports them. Incidentally it also **enables package
self-reference** — `import '@netgrep/netgrep'` from inside the package was `ERR_MODULE_NOT_FOUND` without
an `exports` field, which is how the probes found it.

**`@netgrep/search` must keep `pkg/index_bg.wasm` reachable as an unrestricted subpath, and nothing in
that package says so.** The Node and Workers boots both resolve it as a subpath, which works *precisely
because* no `exports` map restricts that package. Adding one later — a reasonable-looking tidy-up — would
break both runtimes, and the coupling is invisible from `packages/search/package.json` — a manifest that
is plain JSON and cannot carry the warning inline. Recording it here is half the mitigation;
`verify-pack`, which walks every `imports` and `exports` target, is the other half.

**The `unit` project's no-build promise survives, through one alias.** `#wasm-boot` names `./dist/…`, and
AGENTS.md §2.2 promises `pnpm test:unit` runs with no `pnpm build:wasm` and no `pnpm build`. Vite does not
read tsconfig's `customConditions`, so `vitest.config.ts` aliases the specifier to the source boot module
for the projects that run from source. This is the one place the design adds friction rather than
removing it.

**`tsc` needs `customConditions: ["netgrep-source"]`, or a clean clone does not build.** Without it the
compiler resolves `#wasm-boot` into `dist/`, which does not exist before the build it is part of. Both
`tsconfig.json` and `tsconfig.lib.json` set it.

**The browser suite is unchanged, and that is what distinguishes this from the accommodation that was
removed.** `ARCHITECTURE.md` records an `initSync`-from-disk path deleted for hiding the real loader from
the test suite — the loader that failed silently under Vite in [0005](0005-esm-only-distribution.md). The
objection was to a *test* accommodation, not to a shipped entry point. The browser suite still loads
`pkg/` through the real fetch-based `init()` over HTTP, and the Node path is exercised separately against
the built package, so both loaders now ship and both are tested by the runtime that receives them.

**Four runtimes now have to stay green, and only two of them are cheap.** The `node` leg runs the built
package, because what it tests is which boot the condition map selects — aliasing it would test the
browser's loader under Node and prove nothing. The `deno` leg is a smoke script. The `workerd` leg needs
`@cloudflare/vitest-pool-workers` and lands separately; until it does, the Workers claim rests on the
run recorded above rather than on CI.

## Rejected alongside

| Refused | Why |
|---|---|
| A CLI | Running in Node does not make this a `ripgrep` replacement, and there is a much better one already |
| Filesystem search | The input stays a URL. Reading local paths is a different tool |
| A second wasm-pack build | `--target web` plus `initSync` covers all four runtimes; a `--target nodejs` build recreates exactly the drift `ARCHITECTURE.md` warns about |
| Any change to the API | Same two functions, same results. This record widens *where* they run, not what they return |
| A fallback for runtimes without streaming `fetch` | Unchanged from [0002](0002-search-while-downloading.md) — searching while downloading is the project |
| An `exports` map on `@netgrep/search` | It would restrict the `pkg/index_bg.wasm` subpath the Node and Workers boots depend on, and `pkg/` is regenerated by every build, so hand-authored entries are something `post_build.js` would have to defend |
| A lazy boot, or a `ready()` / `configure()` export | The eager boot is what every runtime keeps, and the absence of a new export is what lets a two-function surface survive a four-runtime widening |
