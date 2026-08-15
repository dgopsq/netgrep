import type { Plugin } from 'vite';

/**
 * Start the WebAssembly download alongside the JavaScript that needs it.
 *
 * The engine is instantiated at module load, but the `.wasm` URL exists only
 * inside the wasm-bindgen glue — so the browser discovers it one serial round
 * trip behind the entry graph. A preload hint moves it up beside
 * `modulepreload` without changing what runs.
 *
 * ⚠️ `crossorigin` is load-bearing: the glue fetches in `cors` mode, and a hint
 * without it is keyed as no-cors, matched by nothing, and downloaded twice.
 *
 * Demo page only — `/docs` touches neither the library nor the engine. Build
 * only: dev serves the wasm unhashed, with no bundle to find its name in.
 */
export function wasmPreloadPlugin(): Plugin {
  let base = '/';

  return {
    name: 'netgrep-wasm-preload',
    apply: 'build',

    configResolved(config) {
      base = config.base;
    },

    transformIndexHtml: {
      order: 'post',

      handler(html, ctx) {
        if (ctx.path.startsWith('/docs')) return html;

        const wasm = Object.keys(ctx.bundle ?? {}).find((name) =>
          name.endsWith('.wasm'),
        );

        // Loud rather than silent: if the engine stops being emitted as an
        // asset the hint would vanish with no test failing.
        if (!wasm) {
          throw new Error(
            'netgrep-wasm-preload: no .wasm in the bundle — this plugin is ' +
              'obsolete or looking in the wrong place. Do not delete it to go green.',
          );
        }

        return {
          html,
          tags: [
            {
              tag: 'link',
              injectTo: 'head',
              attrs: {
                rel: 'preload',
                as: 'fetch',
                type: 'application/wasm',
                href: `${base}${wasm}`,
                crossorigin: true,
              },
            },
          ],
        };
      },
    },
  };
}
