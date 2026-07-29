# Netgrep demo

The public demo for `@netgrep/netgrep`, live at **<https://dgopsq.github.io/netgrep/>**.

Vite + React + Tailwind v4 + shadcn/ui. It searches 56 Sherlock Holmes short stories (2.6 MB) and shows each
file resolving individually, as it downloads. See the [main README](https://github.com/dgopsq/netgrep) for
what netgrep is, and [decision 0017](../../docs/decisions/0017-example-as-hosted-demo.md) for why this app
looks the way it does.

It runs against the **local workspace source**, not a published release, so changes to `packages/netgrep` or
`packages/search` show up here after a rebuild.

## Running it

From the root of the repository:

```bash
pnpm install
pnpm build:wasm   # builds packages/search/pkg/
pnpm build        # builds packages/netgrep/dist/  <- this app imports it
pnpm dev
```

**Both build steps are required**, and the second is easy to miss: this app imports `@netgrep/netgrep`, which
resolves to the workspace package and points at the gitignored `packages/netgrep/dist/`. Without it Vite
fails to resolve the import. `pnpm bootstrap` covers the install and the WASM, but not `pnpm build`.

The dev server runs at <http://localhost:5173/netgrep/> — under the same base path as production,
deliberately, so a base-path mistake fails here rather than only after deploying.

## Deployment

`.github/workflows/deploy-pages.yml`, on every push to `main`, gated on the full `test-and-lint.yml` graph.
Nothing is deployed from a red build.

## Things worth knowing before editing

**The memory cache is switched off**, in `src/hooks/use-corpus-search.ts`. That is deliberate and
load-bearing: two of the library's documented P1 defects exist only when it is on, and both make this page
return confidently wrong answers. The comment there explains it — do not "optimise" it back on.

**`src/lib/story-url.ts` is the only module allowed to know the base path.** The site is served from
`/netgrep/`, so a root-relative `/stories/x.txt` silently 404s and the page then looks like a corpus that
simply matches nothing.

**`src/data/stories.ts` is generated.** Titles are read out of each file's own header block. After adding or
removing a file in `public/stories/`:

```bash
pnpm --filter @netgrep/example manifest
```

**The corpus is deliberately only the individual stories.** The complete-canon dumps, the omnibus collections
and the novels were removed: they were supersets of the 56 remaining files and 84% of the bytes, so nearly
every query matched all of them and the result list said nothing.

This is a demo, not a test. Correctness is established by `pnpm test`, `pnpm test:rust` and
`pnpm verify:pack`; CI only checks that this app typechecks and builds.
