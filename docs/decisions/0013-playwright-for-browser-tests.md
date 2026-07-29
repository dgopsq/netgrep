# 0013 — Playwright runs the browser tests; ChromeDriver is gone

**Status:** Accepted (2026-07-29).

## Context

netgrep shipped two kinds of test, and the split between them was upside down.

| | Ran in | Covered |
|---|---|---|
| `packages/search/tests/search.rs` (2 tests) | headless Chrome, via `wasm-pack test` → ChromeDriver | `search_bytes` — pure bytes in, bool out |
| `packages/netgrep/src/**/*.spec.ts` (24 tests) | Node | the streaming loop, batching, caching, and the real engine |

So the only thing that reached a real browser was the part with nothing browser-specific about it, while the
part that is *only* ever used in a browser was tested where browsers do not exist.

**The browser harness was also broken on contributors' machines.** `wasm-pack test --chrome --headless`
downloads the *latest* ChromeDriver, which cannot drive an older installed Chrome — observed here as
ChromeDriver 151 against Chrome 150, `invalid session id`, driver killed with signal 9. It further
**overrides** `CHROMEDRIVER`, so exporting a matching driver and re-running changed nothing; the documented
workaround was to bypass `wasm-pack` and invoke the test runner by hand with three environment variables
(former `docs/BACKLOG.md` item 2).

Pinning the pair in CI was tried and reverted. `browser-actions/setup-chrome` installs a driver into the tool
cache, but the browser ChromeDriver actually launches is the runner's *system* Chrome — pinning one half
creates the very mismatch it was meant to prevent.

The failure is structural: **the browser and the thing driving it were versioned independently**, by two
different mechanisms, neither pinned by this repository.

Meanwhile the integration suite could not test the loader at all. `pkg/`'s real `init()` fetches
`index_bg.wasm` over HTTP relative to `import.meta.url`, which has no meaning under Node, so the suite read
the bytes off disk and called `initSync`. The loader is not a hypothetical risk: under
[0005](0005-esm-only-distribution.md) the `bundler` target failed *silently* under Vite and every search
returned `false`.

## Decision

**Playwright drives a real browser; ChromeDriver and `wasm-pack test` are removed.**

`vitest.config.ts` declares two projects:

| Project | Environment | Suite |
|---|---|---|
| `unit` | Node | `Netgrep.spec.ts` — mocks `fetch` *and* the engine, so a browser would add nothing |
| `browser` | Playwright Chromium, headless | `Netgrep.integration.spec.ts` — the real WASM, the real streaming loop |

Playwright downloads a Chromium pinned to its own package version, which is pinned in the lockfile. Browser
and driver ship as one unit and cannot drift — locally or in CI. CI gains one step,
`pnpm exec playwright install --with-deps chromium`, and loses the ChromeDriver caveat entirely.

**The Rust tests became native.** `tests/search.rs` dropped `run_in_browser` and `wasm-bindgen-test` and is
now a plain `cargo test` (`pnpm test:rust`, formerly `pnpm test:wasm`). It needs no browser, and runs in
milliseconds.

**The integration suite now instantiates through the real, fetch-based `init()`.** The `initSync`-from-disk
accommodation is gone — the suite loads the published artefact the way a consumer does.

## Consequences

**Good:**
- `pnpm test` works on a fresh machine. The version mismatch it used to hit is now unrepresentable.
- Browser coverage went up, not down: 2 assertions about pure byte logic were replaced by 17 tests driving
  the real engine through the real streaming loop — including the loader, which nothing previously exercised.
- One fewer toolchain in the test path. No ChromeDriver, no `wasm-bindgen-test`, no `WASM_BINDGEN_TEST_ONLY_WEB`.
- The Rust tests got faster and can run with no network and no browser at all.

**Costs:**
- A ~180 MB Chromium download on first run, and two new devDependencies (`@vitest/browser-playwright`,
  `playwright`). CI pays the download on every run; it is not cached.
- `pnpm test` now boots a browser, so it is slower than an all-Node run — a few seconds.
- Nothing runs `wasm-bindgen`-generated glue under a *non*-Chromium engine. That was already true; ChromeDriver
  was Chrome-only too. Playwright makes firefox and webkit a config line if that ever matters.
- `optimizeDeps.exclude: ['@netgrep/search']` is load-bearing in the browser project. Vite's pre-bundling
  would rewrite the module into `.vite/deps/`, and the loader resolves the binary relative to its own module
  URL — a moved module fetches the `.wasm` from a directory that has none.
- A missing `pkg/` fails during Vite's transform, before any test module or `vi.mock` factory is evaluated, so
  the actionable "run `pnpm build:wasm`" message lives in `vitest.global-setup.ts` rather than in the test.

**Deliberately not done:** moving the unit suite into the browser. It mocks the engine and `fetch`, so a
browser buys it nothing but startup time. Keeping it in Node also preserves the documented property that unit
tests pass on a checkout that has never run `pnpm build:wasm` (`AGENTS.md` §2.2).
