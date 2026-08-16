# Runtimes

netgrep runs in a browser, in Node, in Deno and in Cloudflare Workers. The two functions are identical in
all four — same arguments, same results, same one-chunk memory — because only the *loading* of the
WebAssembly differs, and the package picks that per runtime through a conditional import. There is nothing
to configure and no runtime to name: `import { grep, matches } from '@netgrep/netgrep'` is the whole of it
everywhere.

What is left is a handful of per-runtime facts a caller still has to know, one per section below. They are
short, and each of them is the thing that goes wrong first.

## Browser

Nothing to do. The browser is the default, [Getting started](01-getting-started.md) is written against it,
and the [demo](https://netgrep.diegopasquali.com/) is it running. The binary is fetched in the background
the moment the module is imported, and the first search waits for it.

## Node

**Node 18.19+ or 20.6+** — the package declares `^18.19.0 || >=20.6.0` in `engines` — and **ESM only**:
there is no `require` entry point. The floor is not `fetch`'s, which arrived in 18.0: Node reads the binary
off disk rather than fetching it, and resolves its path with a **synchronous, unflagged
`import.meta.resolve`**, which is exactly the pair of versions where that became available. Below the floor
the failure is loud and early — the boot throws while the module is evaluating, so the `import` fails rather
than the first search.

**The URL must be absolute, and this is the one that catches browser code moved to a script.** `fetch` in a
browser resolves a relative path against the document; Node has no document to resolve against, so
`'/logs/app.log'` is not a URL at all and `fetch` throws before a byte moves. The same string that works in
a page cannot work here.

```ts
// grep-log.mjs — run with: node grep-log.mjs
import { grep } from '@netgrep/netgrep';

// Absolute. A leading slash is a path, and there is no page to resolve it against.
const url = 'https://netgrep.diegopasquali.com/logs/apache.txt';

for await (const hit of grep(url, 'jk2_init')) {
  console.log(`${hit.lineNumber}\t${hit.line}`);
}
```

That is the demo's 8.7 MB Apache log, and the lines start printing while it is still downloading. Stopping
early is `break`, as everywhere else — see [Cancelling](05-cancelling.md).

Bun resolves the same `node` condition and would probably work unchanged. It has not been run, so it is not
claimed.

## Deno

Deno needs no boot of its own: its `fetch` reads the `file:` URL the default loader builds for the binary,
so it takes byte for byte the path the browser takes. The script is the Node one above, unchanged — same
file, same import, same output. Only the command differs, and it needs **two** permissions rather than one:

```bash
deno run --allow-net --allow-read grep-log.mjs
```

`--allow-net` is the search. `--allow-read` is the **boot** — nothing in your code opens a file, but Deno
resolving that `file:` URL is a read and is checked as one. Loading the engine is a filesystem operation
wearing a `fetch`'s clothes.

**Without `--allow-read` the failure contains none of your code.** The import *succeeds*, because this boot
fails into a rejected promise rather than throwing during evaluation; then an uncaught
`NotCapable: requires read access` arrives from inside `ext:deno_fetch`, over a stack that ends in
netgrep's own files under `node_modules` and holds no frame you wrote. It reads like a fault in the
runtime. It is a missing flag.

## Cloudflare Workers

Nothing to configure. Wrangler resolves the `.wasm` import from inside the package and **inlines the binary
into the deployed script**; no compatibility flag is involved, `nodejs_compat` included, because this boot
touches no `node:` API.

```ts
// src/index.ts — wrangler deploy
import { matches } from '@netgrep/netgrep';

export default {
  async fetch(request: Request): Promise<Response> {
    const log = new URL(request.url).searchParams.get('log');

    if (log === null) return new Response('missing ?log', { status: 400 });

    return Response.json({ found: await matches(log, 'ECONNREFUSED') });
  },
};
```

The log can be 200 MB. The isolate holds one chunk of it at a time and answers as soon as the first match
arrives rather than after the last byte, and no request pays for the WebAssembly: it is compiled when the
isolate starts, not fetched per call.

**That inlining is the cost, and it is charged at deploy.** A Worker importing netgrep bundles to
**about 1156 KiB, 493 KiB gzipped** — measured with `wrangler deploy --dry-run`, and almost all of it the
regex engine's Unicode tables. It counts against the Worker script-size limit, so check both figures against
the one your plan allows before adopting: a handler that was a few KiB becomes most of a megabyte.

## Cross-origin permission is a browser rule

Needing `Access-Control-Allow-Origin` from the file's host is the browser's rule, and off the browser it
does not exist — Node, Deno and a Worker will read a URL whose host sends no such header at all. Whatever
authorization the *host* demands still applies and still has to be passed in.
[Getting started](01-getting-started.md) covers both halves; this is only the note that one of the costs it
lists stops applying here.
