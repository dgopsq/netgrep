

![Header](https://github.com/dgopsq/netgrep/blob/main/assets/header.jpg)

# netgrep

Netgrep is an **experimental** porting of [ripgrep](https://github.com/BurntSushi/ripgrep) on WASM using the HTTP protocol. The scope of this project is to provide a viable alternative to index-based search engines for applications with a small files-based database. It is built on the `grep-matcher`, `grep-regex` and `grep-searcher` crates published from the `ripgrep` repository, used unmodified from crates.io. 

At the moment Netgrep is just going to tell whether a pattern is present on a remote file leveraging the `ripgrep` core search engine. This happens **while the file is being downloaded** in order to maximize the performance. 

> **Note**
> Searching for posts on a blog created through a Static Site Generator is an interesting use-case for this experiment. Netgrep could easily be used to create a real-time search engine from the raw post files. A live example for this behavior can be found on [my blog](https://diegopasquali.com/search) (you can take a look at the [source code](https://github.com/dgopsq/writings)).

> **Warning**
> This library is distributed as **ESM only** and targets the browser. There is no CommonJS `require` entry
> point and no Node.js support — it needs `fetch` with a readable response body stream. Since `0.2.0` no
> bundler *configuration* is required; see below.

## Usage

> **Note**
> A complete example is available [in the `example` package](https://github.com/dgopsq/netgrep/tree/main/packages/example).

First of all install the module:

```bash
# Using pnpm
pnpm add @netgrep/netgrep

# Using npm
npm install @netgrep/netgrep
```

No bundler configuration is required. `netgrep` loads its WebAssembly through a standard
`new URL('…', import.meta.url)` reference, which Vite, webpack 5, Rollup, esbuild, Parcel and Bun all
understand out of the box.

> **Upgrading from 0.1.x?** Delete the `experiments.asyncWebAssembly` flag from your webpack config — it is
> no longer needed. Nothing else changes; the API is identical.

The WASM file is fetched in the background as soon as the module is imported, and the first search waits for
it automatically:

```ts
import { Netgrep } from '@netgrep/netgrep';

// Create a Netgrep instance, here it's
// possible to pass an initial configuration.
const NG = new Netgrep();

// Execute a Netgrep search on the url using 
// the given pattern.
NG.search("url", "pattern")
  .then((output) => {
    console.log('The pattern has matched', output.result)
  });

// It's possible to pass custom metadata during
// the search. These will be returned back in the result
// for convenience.
NG.search("url", "pattern", { post })
  .then((output) => {
    console.log('The pattern has matched', output.result)
    console.log('Metadata', output.metadata)
  });

// There is a convenient method to do batched searches
// to multiple urls. Using `searchBatch` the resulting `Promise`
// will resolve only after the completion of all the searches.
NG.searchBatch([
  { url: 'url1' },
  { url: 'url2' },
  { url: 'url3' }
], "pattern")
  .then((outputs) => {
    outputs.forEach((output) => {
      console.log(`The pattern has matched for ${output.url}`, output.result)
    });
  });

// If you want to avoid waiting for the completion of
// all the searches, the method `searchBatchWithCallback` will
// execute a callback every time a search completes.
NG.searchBatchWithCallback([
  { url: 'url1' },
  { url: 'url2' },
  { url: 'url3' }
], "pattern", (output) => {
  console.log(`The pattern has matched for ${output.url}`, output.result)
});
```

## License

Netgrep is under the [MIT license](https://github.com/dgopsq/netgrep/blob/main/LICENSE).
