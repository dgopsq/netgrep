

# Netgrep

Netgrep is an **experimental** porting of [ripgrep](https://github.com/BurntSushi/ripgrep) on WASM using the HTTP protocol. The scope of this project is to provide a viable alternative to index-based search engines for applications with a small-to-medium database.

At the moment Netgrep is just going to tell wether a pattern is present on a remote file leveraging the `ripgrep` core search engine. This happens **while the file is being downloaded** in order to maximise the performance. 

> **Note**
> Searching for posts on a blog created through a Static Site Generator is interesting use-case for this experiment. Netgrep could easily be used to create a real-time search engine from the raw posts files!

## Usage

A complete example is available [here](https://github.com/dgopsq/netgrep/tree/main/packages/example) using [Vite](https://vitejs.dev/) + [React](https://reactjs.org/). 

> **Warning**
> It's important to use a bundler that supports `wasm-pack` generated modules. The Vite plugin [vite-plugin-wasm](https://github.com/Menci/vite-plugin-wasm) allows exactly that!

```ts
import { Netgrep } from 'netgrep';

// Create a Netgrep instance, here it's
// possible to pass an initial configuration.
const NG = new Netgrep();

// Execute a Netgrep search on the url using 
// the given pattern.
NG.search("url", "pattern").then(console.log);
```