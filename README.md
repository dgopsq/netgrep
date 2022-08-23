

# Netgrep

Netgrep is an **experimental** porting of [ripgrep](https://github.com/BurntSushi/ripgrep) on WASM using the HTTP protocol.

## Usage

A complete example is available [here](https://github.com/dgopsq/netgrep/tree/main/packages/example) using [Vite](https://vitejs.dev/) + [React](https://reactjs.org/). 

> **Warning**
> It's important to use a bundler that supports `wasm-pack` generated modules. The Vite plugin [vite-plugin-wasm](https://github.com/Menci/vite-plugin-wasm) allows exactly that!

```ts
// Create a Netgrep instance, here it's
// possible to pass an initial configuration.
const NG = new Netgrep();

// Execute a Netgrep search on the url using 
// the given pattern.
NG.search("url", "pattern").then(console.log);
```