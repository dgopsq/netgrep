

![Header](https://github.com/dgopsq/netgrep/blob/main/assets/header.jpg)

# netgrep

Netgrep is an **experimental** porting of [ripgrep](https://github.com/BurntSushi/ripgrep) on WASM using the HTTP protocol. The scope of this project is to provide a viable alternative to index-based search engines for applications with a small files-based database. It uses [a fork of the original `ripgrep` repository](https://github.com/dgopsq/ripgrep) with just enough changes to make it runnable on WASM. 

At the moment Netgrep is just going to tell wether a pattern is present on a remote file leveraging the `ripgrep` core search engine. This happens **while the file is being downloaded** in order to maximise the performance. 

> **Note**
> Searching for posts on a blog created through a Static Site Generator is an interesting use-case for this experiment. Netgrep could easily be used to create a real-time search engine from the raw posts files!

> **Warning**
> At the moment this library is exported only as an ESM, thus a bundler like [Webpack](https://webpack.js.org/) is required to use it. 

## Usage

> **Note**
> This short tutorial assumes that **Webpack 5** is the bundler used in the application where `netgrep` will be integrated. A complete example is available [in the `example` package](https://github.com/dgopsq/netgrep/tree/main/packages/example).

First of all install the module:

```bash
# Using yarn
yarn add @netgrep/netgrep

# Using npm
npm install @netgrep/netgrep
```

The [`asyncWebAssembbly` experiment flag](https://webpack.js.org/configuration/experiments/) shuld be enabled inside the `webpack.config.js`:

```js
module.exports = {
  //...
  experiments: {
    // ...
    asyncWebAssembly: true,
  },
};
```

Then it will be possible to execute `netgrep` directly while the bundled WASM file will be loaded asynchronously in the background:

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

// There is a convenience method to do batched searches
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
// execute a callback everytime a search completes.
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